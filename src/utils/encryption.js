// ===== ENCRYPTION CONSTANTS =====
import { privateKeyToAccount } from "viem/accounts";
import { signMessage } from "viem/accounts";

const ENCRYPTION_CONFIG = {
    algorithm: 'AES-GCM',
    keyLength: 256,
    ivLength: 12, // 96 bits for AES-GCM
    tagLength: 128, // 128 bits authentication tag
    iterations: 100000, // PBKDF2 iterations
    salt: 'monad-dca-pro-salt-v1', // Static salt for key derivation
    keyUsages: ['encrypt', 'decrypt']
  };
  
  const SUPPORTED_DATA_TYPES = {
    PRIVATE_KEY: 'private_key',
    DELEGATION_SIGNATURE: 'delegation_signature',
    USER_PREFERENCES: 'user_preferences',
    STRATEGY_CONFIG: 'strategy_config'
  };
  
  // ===== UTILITY FUNCTIONS =====
  
  /**
   * Convert string to ArrayBuffer
   * @param {string} str - String to convert
   * @returns {ArrayBuffer} ArrayBuffer representation
   */
  const stringToArrayBuffer = (str) => {
    return new TextEncoder().encode(str);
  };
  
  /**
   * Convert ArrayBuffer to string
   * @param {ArrayBuffer} buffer - ArrayBuffer to convert
   * @returns {string} String representation
   */
  const arrayBufferToString = (buffer) => {
    return new TextDecoder().decode(buffer);
  };
  
  /**
   * Convert ArrayBuffer to base64 string
   * @param {ArrayBuffer} buffer - ArrayBuffer to convert
   * @returns {string} Base64 string
   */
  const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };
  
  /**
   * Convert base64 string to ArrayBuffer
   * @param {string} base64 - Base64 string
   * @returns {ArrayBuffer} ArrayBuffer representation
   */
  const base64ToArrayBuffer = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  };
  
  /**
   * Generate cryptographically secure random bytes
   * @param {number} length - Number of bytes to generate
   * @returns {ArrayBuffer} Random bytes
   */
  const generateRandomBytes = (length) => {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return array.buffer;
  };
  
  // ===== KEY DERIVATION =====
  
  /**
   * Derive encryption key from password using PBKDF2
   * @param {string} password - User password
   * @param {string} salt - Salt for key derivation (optional)
   * @returns {Promise<CryptoKey>} Derived encryption key
   */
  export const deriveKeyFromPassword = async (password, salt = ENCRYPTION_CONFIG.salt) => {
    if (!password || typeof password !== 'string') {
      throw new Error('Password must be a non-empty string');
    }
    
    try {
      // Import password as key material
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        stringToArrayBuffer(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );
      
      // Derive actual encryption key
      const key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: stringToArrayBuffer(salt),
          iterations: ENCRYPTION_CONFIG.iterations,
          hash: 'SHA-256'
        },
        keyMaterial,
        {
          name: ENCRYPTION_CONFIG.algorithm,
          length: ENCRYPTION_CONFIG.keyLength
        },
        false,
        ENCRYPTION_CONFIG.keyUsages
      );
      
      return key;
      
    } catch (error) {
      throw new Error(`Key derivation failed: ${error.message}`);
    }
  };
  
  /**
   * Generate random encryption key
   * @returns {Promise<CryptoKey>} Random encryption key
   */
  export const generateRandomKey = async () => {
    try {
      const key = await crypto.subtle.generateKey(
        {
          name: ENCRYPTION_CONFIG.algorithm,
          length: ENCRYPTION_CONFIG.keyLength
        },
        false, // Not extractable
        ENCRYPTION_CONFIG.keyUsages
      );
      
      return key;
      
    } catch (error) {
      throw new Error(`Random key generation failed: ${error.message}`);
    }
  };
  
  // ===== ENCRYPTION/DECRYPTION =====
  
  /**
   * Encrypt data using AES-GCM
   * @param {string|object} data - Data to encrypt
   * @param {CryptoKey} key - Encryption key
   * @param {string} dataType - Type of data being encrypted
   * @returns {Promise<object>} Encrypted data with metadata
   */
  export const encryptData = async (data, key, dataType = SUPPORTED_DATA_TYPES.USER_PREFERENCES) => {
    if (!data) {
      throw new Error('Data to encrypt is required');
    }
    
    if (!key || key.constructor.name !== 'CryptoKey') {
      throw new Error('Valid CryptoKey is required');
    }
    
    if (!Object.values(SUPPORTED_DATA_TYPES).includes(dataType)) {
      throw new Error(`Unsupported data type: ${dataType}`);
    }
    
    try {
      // Convert data to string if it's an object
      const dataString = typeof data === 'string' 
         ? data
         : JSON.stringify(data, (key, value) =>
             typeof value === 'bigint' ? value.toString() : value
        );
      const dataBuffer = stringToArrayBuffer(dataString);
      
      // Generate random IV
      const iv = generateRandomBytes(ENCRYPTION_CONFIG.ivLength);
      
      // Encrypt data
      const encryptedBuffer = await crypto.subtle.encrypt(
        {
          name: ENCRYPTION_CONFIG.algorithm,
          iv: iv
        },
        key,
        dataBuffer
      );
      
      // Return encrypted data with metadata
      return {
        data: arrayBufferToBase64(encryptedBuffer),
        iv: arrayBufferToBase64(iv),
        dataType,
        algorithm: ENCRYPTION_CONFIG.algorithm,
        timestamp: Date.now(),
        version: '1.0'
      };
      
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  };
  
  /**
   * Decrypt data using AES-GCM
   * @param {object} encryptedData - Encrypted data object from encryptData
   * @param {CryptoKey} key - Decryption key
   * @returns {Promise<string|object>} Decrypted data
   */
  export const decryptData = async (encryptedData, key) => {
    if (!encryptedData || typeof encryptedData !== 'object') {
      throw new Error('Valid encrypted data object is required');
    }
    
    if (!key || key.constructor.name !== 'CryptoKey') {
      throw new Error('Valid CryptoKey is required');
    }
    
    // Validate encrypted data structure
    if (!encryptedData.data || !encryptedData.iv) {
      throw new Error('Invalid encrypted data structure');
    }
    
    try {
      // Convert base64 data back to ArrayBuffers
      const encryptedBuffer = base64ToArrayBuffer(encryptedData.data);
      const iv = base64ToArrayBuffer(encryptedData.iv);
      
      // Decrypt data
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: ENCRYPTION_CONFIG.algorithm,
          iv: iv
        },
        key,
        encryptedBuffer
      );
      
      // Convert back to string
      const decryptedString = arrayBufferToString(decryptedBuffer);
      
      // Try to parse as JSON if it looks like an object
      if (decryptedString.startsWith('{') || decryptedString.startsWith('[')) {
        try {
          return JSON.parse(decryptedString, (key, value) =>{
            if (typeof value === 'string' && /^\d+$/.test(value)) {
               // looks like an integer string → revive as BigInt
               try{
                return BigInt(value);
               } catch{
                return value;
               }
              }
              return value;   
          });
        } catch {
          // If JSON parsing fails, return as string
          return decryptedString;
        }
      }
      
      return decryptedString;
      
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  };
  
  // ===== SECURE STORAGE HELPERS =====
  
  /**
   * Securely store encrypted data in memory
   * In-memory storage for sensitive data (no localStorage)
   */
  class SecureMemoryStorage {
    constructor() {
      this.storage = new Map();
      this.expiration = new Map();
    }
    
    /**
     * Store encrypted data with expiration
     * @param {string} key - Storage key
     * @param {object} encryptedData - Encrypted data from encryptData
     * @param {number} ttlMs - Time to live in milliseconds (default: 1 hour)
     */
    store(key, encryptedData, ttlMs = 3600000) {
      if (!key || !encryptedData) {
        throw new Error('Key and encrypted data are required');
      }
      
      const expirationTime = Date.now() + ttlMs;
      this.storage.set(key, encryptedData);
      this.expiration.set(key, expirationTime);
      
      // Set cleanup timeout
      setTimeout(() => {
        this.remove(key);
      }, ttlMs);
    }
    
    /**
     * Retrieve encrypted data
     * @param {string} key - Storage key
     * @returns {object|null} Encrypted data or null if not found/expired
     */
    retrieve(key) {
      if (!this.storage.has(key)) {
        return null;
      }
      
      const expirationTime = this.expiration.get(key);
      if (Date.now() > expirationTime) {
        this.remove(key);
        return null;
      }
      
      return this.storage.get(key);
    }
    
    /**
     * Remove data from storage
     * @param {string} key - Storage key
     */
    remove(key) {
      this.storage.delete(key);
      this.expiration.delete(key);
    }
    
    /**
     * Clear all stored data
     */
    clear() {
      this.storage.clear();
      this.expiration.clear();
    }
    
    /**
     * Get all non-expired keys
     * @returns {string[]} Array of valid keys
     */
    getKeys() {
      const now = Date.now();
      const validKeys = [];
      
      for (const [key, expirationTime] of this.expiration.entries()) {
        if (now <= expirationTime) {
          validKeys.push(key);
        } else {
          this.remove(key);
        }
      }
      
      return validKeys;
    }
  }
  
  // Global secure storage instance
  export const secureStorage = new SecureMemoryStorage();
  
  // ===== HIGH-LEVEL ENCRYPTION FUNCTIONS =====
  
  /**
   * Encrypt and store sensitive data
   * @param {string} storageKey - Key for storage
   * @param {string|object} data - Data to encrypt
   * @param {string} password - Encryption password
   * @param {string} dataType - Type of data
   * @param {number} ttlMs - Time to live in milliseconds
   * @returns {Promise<boolean>} Success status
   */
  export const encryptAndStore = async (storageKey, data, password, dataType, ttlMs = 3600000) => {
    try {
      // Derive encryption key from password
      const key = await deriveKeyFromPassword(password);
      
      // Encrypt data
      const encryptedData = await encryptData(data, key, dataType);
      
      // Store encrypted data
      secureStorage.store(storageKey, encryptedData, ttlMs);
      
      return true;
      
    } catch (error) {
      console.error('Encrypt and store failed:', error);
      return false;
    }
  };
  
  /**
   * Retrieve and decrypt stored data
   * @param {string} storageKey - Key for storage
   * @param {string} password - Decryption password
   * @returns {Promise<any|null>} Decrypted data or null if failed
   */
  export const retrieveAndDecrypt = async (storageKey, password) => {
    try {
      // Retrieve encrypted data
      const encryptedData = secureStorage.retrieve(storageKey);
      if (!encryptedData) {
        return null;
      }
      
      // Derive decryption key from password
      const key = await deriveKeyFromPassword(password);
      
      // Decrypt data
      const decryptedData = await decryptData(encryptedData, key);
      
      return decryptedData;
      
    } catch (error) {
      console.error('Retrieve and decrypt failed:', error);
      return null;
    }
  };
  
  // ===== PRIVATE KEY SPECIFIC FUNCTIONS =====
  
  /**
   * Encrypt private key with additional security measures
   * @param {string} privateKey - Private key to encrypt (with or without 0x prefix)
   * @param {string} password - Encryption password
   * @returns {Promise<object>} Encrypted private key data
   */
  export const encryptPrivateKey = async (privateKey, password) => {
    if (!privateKey || !password) {
      throw new Error('Private key and password are required');
    }
    
    // Validate private key format
    const cleanKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    if (!cleanKey.match(/^0x[a-fA-F0-9]{64}$/)) {
      throw new Error('Invalid private key format');
    }
    
    try {
      // Use stronger key derivation for private keys
      const salt = `${ENCRYPTION_CONFIG.salt}-private-key-${Date.now()}`;
      const key = await deriveKeyFromPassword(password, salt);
      
      // Encrypt with additional metadata
      const encryptedData = await encryptData(cleanKey, key, SUPPORTED_DATA_TYPES.PRIVATE_KEY);
      
      // Add salt to encrypted data for decryption
      encryptedData.salt = salt;
      encryptedData.keyType = 'private_key';
      
      return encryptedData;
      
    } catch (error) {
      throw new Error(`Private key encryption failed: ${error.message}`);
    }
  };
  
  /**
   * Decrypt private key
   * @param {object} encryptedPrivateKey - Encrypted private key data
   * @param {string} password - Decryption password
   * @returns {Promise<string>} Decrypted private key
   */
  export const decryptPrivateKey = async (encryptedPrivateKey, password) => {
    if (!encryptedPrivateKey || !password) {
      throw new Error('Encrypted private key data and password are required');
    }
    
    if (encryptedPrivateKey.dataType !== SUPPORTED_DATA_TYPES.PRIVATE_KEY) {
      throw new Error('Invalid private key data type');
    }
    
    try {
      // Use the same salt that was used for encryption
      const salt = encryptedPrivateKey.salt || ENCRYPTION_CONFIG.salt;
      const key = await deriveKeyFromPassword(password, salt);
      
      // Decrypt private key
      const decryptedKey = await decryptData(encryptedPrivateKey, key);
      
      // Validate decrypted private key
      if (!decryptedKey || !decryptedKey.match(/^0x[a-fA-F0-9]{64}$/)) {
        throw new Error('Decryption produced invalid private key');
      }
      
      return decryptedKey;
      
    } catch (error) {
      throw new Error(`Private key decryption failed: ${error.message}`);
    }
  };
  
  // ===== SIGNATURE VERIFICATION =====
  
  /**
   * Create encrypted signature for delegation
   * @param {string} message - Message to sign
   * @param {string} privateKey - Private key for signing
   * @param {string} password - Password for encryption
   * @returns {Promise<object>} Encrypted signature data
   */
  export const createEncryptedSignature = async (message, privateKey, password) => {
    if (!message || !privateKey || !password) {
      throw new Error('Message, private key, and password are required');
    }
    
    try {
      // 1. Create account from the private key
      const account = privateKeyToAccount(privateKey);

      // 2. Sign the message using viem
      const signature = await signMessage({
        account,
        message
      });
      // 3. Build the signature data
      const signatureData = {
        message,
        timestamp: Date.now(),
        signer: account.address,
        signature
      }
      
      // Encrypt signature data
      const key = await deriveKeyFromPassword(password);
      const encryptedSignature = await encryptData(
        signatureData, 
        key, 
        SUPPORTED_DATA_TYPES.DELEGATION_SIGNATURE
      );
      
      return encryptedSignature;
      
    } catch (error) {
      throw new Error(`Encrypted signature creation failed: ${error.message}`);
    }
  };
  
  // ===== EXPORTS =====
  export default {
    // Key functions
    deriveKeyFromPassword,
    generateRandomKey,
    
    // Encryption functions
    encryptData,
    decryptData,
    
    // Storage
    secureStorage,
    encryptAndStore,
    retrieveAndDecrypt,
    
    // Private key functions
    encryptPrivateKey,
    decryptPrivateKey,
    
    // Signature functions
    createEncryptedSignature,
    
    // Constants
    SUPPORTED_DATA_TYPES
  };