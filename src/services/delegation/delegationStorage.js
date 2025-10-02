import { encryptData, decryptData, secureStorage } from '../../utils/encryption.js';
import { validateDelegation } from '../../utils/validators.js';
import { DELEGATION_CONFIG } from '../../utils/constants.js';

function safeBase64Encode(str) {
  try {
    if (typeof Buffer !== 'undefined') {
      // Node.js & bundlers
      return Buffer.from(str, 'utf-8').toString('base64');
    } else if (typeof btoa !== 'undefined') {
      // Browser safe UTF-8 → Base64
      return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
    } else {
      throw new Error('No base64 encoder available');
    }
  } catch (e) {
    // Fallback: timestamp + random
    return `${Date.now()}${Math.floor(Math.random() * 1e9)}`;
  }
}


// Storage keys and data types
const STORAGE_KEYS = {
  DELEGATIONS: 'encrypted_delegations',
  DELEGATION_INDEX: 'delegation_index',
  DELEGATION_METADATA: 'delegation_metadata',
  CLEANUP_SCHEDULE: 'cleanup_schedule'
};

const DELEGATION_STATUS = {
  CREATED: 'created',
  ACTIVE: 'active',
  REDEEMED: 'redeemed',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  FAILED: 'failed'
};

const SEARCH_FILTERS = {
  STATUS: 'status',
  TYPE: 'type',
  DELEGATOR: 'delegator',
  DELEGATE: 'delegate',
  DATE_RANGE: 'dateRange',
  AMOUNT_RANGE: 'amountRange',
  TOKEN: 'token'
};

/**
 * Delegation Storage Service
 * Handles secure storage, indexing, and retrieval of delegation data
 */
class DelegationStorageService {
  constructor() {
    this.delegations = new Map();
    this.delegationIndex = new Map();
    this.metadata = {
      totalDelegations: 0,
      activeDelegations: 0,
      totalValueLocked: 0, // use Number for persistence safety
      lastCleanup: null
    };
    this.cleanupTimer = null;
    this.initialized = false;
  }

  /**
   * Initialize the storage service
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Load existing data from secure storage
      await this.loadStoredData();
      
      // Start cleanup scheduler
      this.scheduleCleanup();
      
      this.initialized = true;
      console.log('DelegationStorageService initialized');
    } catch (error) {
      console.error('Failed to initialize DelegationStorageService:', error);
      throw new Error(`Storage initialization failed: ${error.message}`);
    }
  }

  /**
   * Store a new delegation with encryption
   */
  async storeDelegation(delegationData, options = {}) {
    if (!this.initialized) {
      throw new Error('Storage service not initialized');
    }

    // Validate delegation data
    const validation = validateDelegation(delegationData);
    if (!validation.isValid) {
      throw new Error(`Invalid delegation data: ${validation.errors.join(', ')}`);
    }

    const {
      encryptSensitiveData = true,
      updateIndex = true,
      ttl = DELEGATION_CONFIG.DEFAULT_STORAGE_TTL
    } = options;

    try {
      const delegationId = this.generateDelegationId(delegationData);
      const timestamp = Date.now();

      // Prepare delegation record
      const delegationRecord = {
        id: delegationId,
        data: delegationData,
        metadata: {
          createdAt: timestamp,
          updatedAt: timestamp,
          status: DELEGATION_STATUS.CREATED,
          accessCount: 0,
          lastAccessed: timestamp,
          ttl: ttl,
          expiresAt: timestamp + ttl,
          encrypted: encryptSensitiveData,
          version: '1.0'
        },
        searchableFields: this.extractSearchableFields(delegationData)
      };

      // Encrypt sensitive data if requested
      if (encryptSensitiveData) {
        const sensitiveFields = this.identifySensitiveFields(delegationData);
        delegationRecord.encryptedFields = {};
        
        for (const field of sensitiveFields) {
          if (delegationData[field]) {
            delegationRecord.encryptedFields[field] = await encryptData(
              delegationData[field],
              'DELEGATION_DATA'
            );
            // Remove from plaintext data
            delete delegationRecord.data[field];
          }
        }
      }

      // Store in memory
      this.delegations.set(delegationId, delegationRecord);

      // Update index if requested
      if (updateIndex) {
        this.updateDelegationIndex(delegationId, delegationRecord);
      }

      // Update metadata
      this.updateMetadata('add', delegationRecord);

      // Persist to secure storage
      await this.persistToSecureStorage();

      console.log(`Delegation ${delegationId} stored successfully`);
      return {
        success: true,
        delegationId,
        storedAt: timestamp
      };

    } catch (error) {
      console.error('Failed to store delegation:', error);
      throw new Error(`Delegation storage failed: ${error.message}`);
    }
  }

  /**
   * Retrieve delegation by ID with decryption
   */
  async getDelegation(delegationId, options = {}) {
    if (!this.initialized) {
      throw new Error('Storage service not initialized');
    }

    const {
      includeMetadata = false,
      incrementAccessCount = true,
      decryptData = true
    } = options;

    try {
      const delegationRecord = this.delegations.get(delegationId);
      
      if (!delegationRecord) {
        return {
          success: false,
          error: 'Delegation not found'
        };
      }

      // Check expiration
      if (Date.now() > delegationRecord.metadata.expiresAt) {
        await this.expireDelegation(delegationId);
        return {
          success: false,
          error: 'Delegation expired'
        };
      }

      // Prepare result
      const result = {
        id: delegationId,
        data: { ...delegationRecord.data }
      };

      // Decrypt encrypted fields if needed
      if (decryptData && delegationRecord.encryptedFields) {
        for (const [field, encryptedValue] of Object.entries(delegationRecord.encryptedFields)) {
          try {
            result.data[field] = await decryptData(encryptedValue, 'DELEGATION_DATA');
          } catch (decryptError) {
            console.error(`Failed to decrypt field ${field}:`, decryptError);
            // Continue without this field rather than failing entirely
          }
        }
      }

      // Include metadata if requested
      if (includeMetadata) {
        result.metadata = { ...delegationRecord.metadata };
      }

      // Update access tracking
      if (incrementAccessCount) {
        delegationRecord.metadata.accessCount++;
        delegationRecord.metadata.lastAccessed = Date.now();
        await this.persistToSecureStorage();
      }

      return {
        success: true,
        delegation: result
      };

    } catch (error) {
      console.error('Failed to retrieve delegation:', error);
      throw new Error(`Delegation retrieval failed: ${error.message}`);
    }
  }

  /**
   * Update delegation status and data
   */
  async updateDelegation(delegationId, updates, options = {}) {
    if (!this.initialized) {
      throw new Error('Storage service not initialized');
    }

    const { validateUpdates = true, persistImmediately = true } = options;

    try {
      const delegationRecord = this.delegations.get(delegationId);
      
      if (!delegationRecord) {
        throw new Error('Delegation not found');
      }

      // Check if delegation can be updated
      if (delegationRecord.metadata.status === DELEGATION_STATUS.EXPIRED) {
        throw new Error('Cannot update expired delegation');
      }

      // Validate updates if requested
      if (validateUpdates && updates.data) {
        const mergedData = { ...delegationRecord.data, ...updates.data };
        const validation = validateDelegation(mergedData);
        if (!validation.isValid) {
          throw new Error(`Invalid update data: ${validation.errors.join(', ')}`);
        }
      }

      const timestamp = Date.now();

      // Apply updates
      if (updates.data) {
        Object.assign(delegationRecord.data, updates.data);
      }

      if (updates.status) {
        const oldStatus = delegationRecord.metadata.status;
        const newStatus = updates.status;
        this.updateMetadata('statusChange', delegationRecord, oldStatus, newStatus);
        delegationRecord.metadata.status = newStatus;

      }

      // Update metadata
      delegationRecord.metadata.updatedAt = timestamp;

      // Re-encrypt sensitive fields if data changed
      if (updates.data && delegationRecord.metadata.encrypted) {
        await this.reencryptSensitiveFields(delegationRecord);
      }

      // Update index
      this.updateDelegationIndex(delegationId, delegationRecord);

      // Persist if requested
      if (persistImmediately) {
        await this.persistToSecureStorage();
      }

      return {
        success: true,
        updatedAt: timestamp
      };

    } catch (error) {
      console.error('Failed to update delegation:', error);
      throw new Error(`Delegation update failed: ${error.message}`);
    }
  }

  /**
   * Search delegations with filters
   */
  async searchDelegations(filters = {}, options = {}) {
    if (!this.initialized) {
      throw new Error('Storage service not initialized');
    }

    const {
      limit = 100,
      offset = 0,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      includeExpired = false,
      decryptResults = false
    } = options;

    try {
      let results = Array.from(this.delegations.values());

      // Apply filters
      results = this.applyFilters(results, filters);

      // Exclude expired if requested
      if (!includeExpired) {
        const now = Date.now();
        results = results.filter(record => record.metadata.expiresAt > now);
      }

      // Sort results
      results = this.sortResults(results, sortBy, sortOrder);

      // Apply pagination
      const total = results.length;
      results = results.slice(offset, offset + limit);

      // Prepare final results
      const finalResults = [];
      for (const record of results) {
        const result = {
          id: record.id,
          data: { ...record.data },
          metadata: { ...record.metadata }
        };

        // Decrypt if requested
        if (decryptResults && record.encryptedFields) {
          for (const [field, encryptedValue] of Object.entries(record.encryptedFields)) {
            try {
              result.data[field] = await decryptData(encryptedValue, 'DELEGATION_DATA');
            } catch (error) {
              console.error(`Failed to decrypt field ${field}:`, error);
            }
          }
        }

        finalResults.push(result);
      }

      return {
        success: true,
        results: finalResults,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total
        }
      };

    } catch (error) {
      console.error('Failed to search delegations:', error);
      throw new Error(`Delegation search failed: ${error.message}`);
    }
  }

  /**
   * Delete delegation and cleanup
   */
  async deleteDelegation(delegationId, options = {}) {
    if (!this.initialized) {
      throw new Error('Storage service not initialized');
    }

    const { secureWipe = true, updateIndex = true } = options;

    try {
      const delegationRecord = this.delegations.get(delegationId);
      
      if (!delegationRecord) {
        return {
          success: false,
          error: 'Delegation not found'
        };
      }

      // Secure wipe encrypted data
      if (secureWipe && delegationRecord.encryptedFields) {
        for (const field of Object.keys(delegationRecord.encryptedFields)) {
          delegationRecord.encryptedFields[field] = null;
        }
      }

      // Remove from storage
      this.delegations.delete(delegationId);

      // Update index
      if (updateIndex) {
        this.removeFromIndex(delegationId);
      }

      // Update metadata
      this.updateMetadata('remove', delegationRecord);

      // Persist changes
      await this.persistToSecureStorage();

      return {
        success: true,
        deletedAt: Date.now()
      };

    } catch (error) {
      console.error('Failed to delete delegation:', error);
      throw new Error(`Delegation deletion failed: ${error.message}`);
    }
  }

  /**
   * Get storage statistics and metadata
   */
  getStorageStats() {
    return {
      ...this.metadata,
      memoryUsage: {
        delegationsCount: this.delegations.size,
        indexSize: this.delegationIndex.size,
        estimatedMemoryKB: Math.round((JSON.stringify([...this.delegations.values()]).length) / 1024)
      },
      status: {
        initialized: this.initialized,
        lastCleanup: this.metadata.lastCleanup,
        nextCleanup: this.cleanupTimer ? new Date(Date.now() + DELEGATION_CONFIG.CLEANUP_INTERVAL) : null
      }
    };
  }

  /**
   * Manual cleanup of expired delegations
   */
  async cleanup(options = {}) {
    const { force = false, maxAge = DELEGATION_CONFIG.MAX_DELEGATION_AGE } = options;
    
    try {
      const now = Date.now();
      const expiredIds = [];
      const oldIds = [];

      for (const [id, record] of this.delegations.entries()) {
        // Mark expired delegations
        if (now > record.metadata.expiresAt) {
          expiredIds.push(id);
        }
        
        // Mark old delegations for cleanup
        if (force || (now - record.metadata.createdAt > maxAge)) {
          oldIds.push(id);
        }
      }

      // Remove expired and old delegations
      const toRemove = [...new Set([...expiredIds, ...oldIds])];
      
      for (const id of toRemove) {
        await this.deleteDelegation(id, { secureWipe: true });
      }

      this.metadata.lastCleanup = now;
      await this.persistToSecureStorage();

      console.log(`Cleanup completed: removed ${toRemove.length} delegations`);
      
      return {
        success: true,
        removed: toRemove.length,
        expired: expiredIds.length,
        old: oldIds.filter(id => !expiredIds.includes(id)).length
      };

    } catch (error) {
      console.error('Cleanup failed:', error);
      throw new Error(`Cleanup failed: ${error.message}`);
    }
  }

  // --- PRIVATE HELPER METHODS ---

  generateDelegationId(delegationData) {
    const key = `${delegationData.delegator}-${delegationData.delegate}-${Date.now()}-${Math.random()}`;
    const encoded = safeBase64Encode(key);
    return `del_${encoded.replace(/[^a-zA-Z0-9]/g, '').substring(0, 32)}`;
  }
  
  

  extractSearchableFields(delegationData) {
    return {
      delegator: delegationData.delegator?.toLowerCase(),
      delegate: delegationData.delegate?.toLowerCase(),
      type: delegationData.type,
      tokens: delegationData.caveats?.map(c => c.tokens).flat().filter(Boolean),
      amount: delegationData.caveats?.find(c => c.type === 'spending_limit')?.terms?.amount
    };
  }

  identifySensitiveFields(delegationData) {
    return ['signature', 'salt', 'nonce', 'privateData'];
  }

  updateDelegationIndex(id, record) {
    const fields = record.searchableFields;
    
    // Index by delegator
    if (fields.delegator) {
      if (!this.delegationIndex.has(`delegator:${fields.delegator}`)) {
        this.delegationIndex.set(`delegator:${fields.delegator}`, new Set());
      }
      this.delegationIndex.get(`delegator:${fields.delegator}`).add(id);
    }

    // Index by delegate
    if (fields.delegate) {
      if (!this.delegationIndex.has(`delegate:${fields.delegate}`)) {
        this.delegationIndex.set(`delegate:${fields.delegate}`, new Set());
      }
      this.delegationIndex.get(`delegate:${fields.delegate}`).add(id);
    }

    // Index by type
    if (fields.type) {
      if (!this.delegationIndex.has(`type:${fields.type}`)) {
        this.delegationIndex.set(`type:${fields.type}`, new Set());
      }
      this.delegationIndex.get(`type:${fields.type}`).add(id);
    }
  }

  removeFromIndex(id) {
    for (const [key, idSet] of this.delegationIndex.entries()) {
      idSet.delete(id);
      if (idSet.size === 0) {
        this.delegationIndex.delete(key);
      }
    }
  }

  updateMetadata(action, record, oldStatus = null, newStatus = null) {
    switch (action) {
      case 'add':
        this.metadata.totalDelegations++;
        if (record.metadata.status === DELEGATION_STATUS.ACTIVE) {
          this.metadata.activeDelegations++;
        }
        break;
  
      case 'remove':
        this.metadata.totalDelegations = Math.max(0, this.metadata.totalDelegations - 1);
        if (record.metadata.status === DELEGATION_STATUS.ACTIVE) {
          this.metadata.activeDelegations = Math.max(0, this.metadata.activeDelegations - 1);
        }
        break;
  
      case 'statusChange':
        // oldStatus: previous value, newStatus: target value
        if (oldStatus === DELEGATION_STATUS.ACTIVE && newStatus !== DELEGATION_STATUS.ACTIVE) {
          this.metadata.activeDelegations = Math.max(0, this.metadata.activeDelegations - 1);
        } else if (oldStatus !== DELEGATION_STATUS.ACTIVE && newStatus === DELEGATION_STATUS.ACTIVE) {
          this.metadata.activeDelegations++;
        }
        break;
    }
  }
  

  applyFilters(results, filters) {
    return results.filter(record => {
      // Status filter
      if (filters.status && record.metadata.status !== filters.status) {
        return false;
      }

      // Type filter
      if (filters.type && record.searchableFields.type !== filters.type) {
        return false;
      }

      // Delegator filter
      if (filters.delegator && record.searchableFields.delegator !== filters.delegator.toLowerCase()) {
        return false;
      }

      // Delegate filter
      if (filters.delegate && record.searchableFields.delegate !== filters.delegate.toLowerCase()) {
        return false;
      }

      // Date range filter
      if (filters.dateRange) {
        const createdAt = record.metadata.createdAt;
        if (filters.dateRange.start && createdAt < filters.dateRange.start) {
          return false;
        }
        if (filters.dateRange.end && createdAt > filters.dateRange.end) {
          return false;
        }
      }

      // Token filter
      if (filters.token && !record.searchableFields.tokens?.includes(filters.token.toLowerCase())) {
        return false;
      }

      return true;
    });
  }

  sortResults(results, sortBy, sortOrder) {
    return results.sort((a, b) => {
      let valueA, valueB;

      switch (sortBy) {
        case 'createdAt':
          valueA = a.metadata.createdAt;
          valueB = b.metadata.createdAt;
          break;
        case 'updatedAt':
          valueA = a.metadata.updatedAt;
          valueB = b.metadata.updatedAt;
          break;
        case 'accessCount':
          valueA = a.metadata.accessCount;
          valueB = b.metadata.accessCount;
          break;
        default:
          valueA = a.metadata.createdAt;
          valueB = b.metadata.createdAt;
      }

      if (sortOrder === 'asc') {
        return valueA - valueB;
      } else {
        return valueB - valueA;
      }
    });
  }

  async reencryptSensitiveFields(delegationRecord) {
    if (!delegationRecord.encryptedFields) return;

    const sensitiveFields = this.identifySensitiveFields(delegationRecord.data);
    
    for (const field of sensitiveFields) {
      if (delegationRecord.data[field]) {
        delegationRecord.encryptedFields[field] = await encryptData(
          delegationRecord.data[field],
          'DELEGATION_DATA'
        );
        delete delegationRecord.data[field];
      }
    }
  }

  async expireDelegation(delegationId) {
    const delegationRecord = this.delegations.get(delegationId);
    if (delegationRecord) {
      delegationRecord.metadata.status = DELEGATION_STATUS.EXPIRED;
      this.updateMetadata('statusChange', delegationRecord, DELEGATION_STATUS.EXPIRED);
      await this.persistToSecureStorage();
    }
  }

  scheduleCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(error => {
        console.error('Scheduled cleanup failed:', error);
      });
    }, DELEGATION_CONFIG.CLEANUP_INTERVAL);
  }

  async loadStoredData() {
    try {
      // Try to load existing delegations from secure storage
      const storedData = secureStorage.get(STORAGE_KEYS.DELEGATIONS);
      if (storedData) {
        const parsedData = JSON.parse(storedData);
        this.delegations = new Map(parsedData.delegations || []);
        this.delegationIndex = new Map(parsedData.index || []);
        this.metadata = { ...this.metadata, ...parsedData.metadata };
      }
    } catch (error) {
      console.warn('Could not load stored delegation data:', error);
      // Continue with empty state
    }
  }

  async persistToSecureStorage() {
    try {
      // Convert delegationIndex Sets -> arrays for serialization
      const serializableIndex = Array.from(this.delegationIndex.entries()).map(([k, v]) => [k, Array.from(v)]);
      const dataToStore = {
        delegations: Array.from(this.delegations.entries()), // [id, record]
        index: serializableIndex,
        metadata: this.metadata
      };
      const payload = JSON.stringify(dataToStore);
       // secureStorage may be sync or async depending on implementation — support both 
      const setResult = secureStorage.set(STORAGE_KEYS.DELEGATIONS, payload, DELEGATION_CONFIG.DEFAULT_STORAGE_TTL);
      if (setResult instanceof Promise) {
        await setResult;
      }
    

    } catch (error) {
      console.error('Failed to persist delegation data:', error);
          // Don't throw to avoid breaking runtime paths — best-effort persist
    }
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.delegations.clear();
    this.delegationIndex.clear();
    this.initialized = false;
  }
}

// Create singleton instance
const delegationStorage = new DelegationStorageService();

// Helper functions for common operations
export const storeDelegation = (delegationData, options) => 
  delegationStorage.storeDelegation(delegationData, options);

export const getDelegation = (delegationId, options) => 
  delegationStorage.getDelegation(delegationId, options);

export const updateDelegation = (delegationId, updates, options) => 
  delegationStorage.updateDelegation(delegationId, updates, options);

export const searchDelegations = (filters, options) => 
  delegationStorage.searchDelegations(filters, options);

export const deleteDelegation = (delegationId, options) => 
  delegationStorage.deleteDelegation(delegationId, options);

export const getStorageStats = () => 
  delegationStorage.getStorageStats();

export const cleanupDelegations = (options) => 
  delegationStorage.cleanup(options);

// Export main class and singleton
export { 
  DelegationStorageService, 
  delegationStorage,
  DELEGATION_STATUS,
  SEARCH_FILTERS 
};