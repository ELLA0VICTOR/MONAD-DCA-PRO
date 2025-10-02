import { 
    Implementation, 
    toMetaMaskSmartAccount,
    createDelegation,
    redeemDelegations
  } from '@metamask/delegation-toolkit';
  import { createAccount, privateKeyToAccount } from 'viem/accounts';
  import { getAddress, keccak256, toHex, encodePacked } from 'viem';
  import { 
    MONAD_CONFIG, 
    SMART_ACCOUNT_CONFIG, 
    CONTRACTS, 
    ERROR_CODES,
    GAS_LIMITS 
  } from '../../utils/constants.js';
  import { monadClient } from '../monad/monadClient.js';
  import { gasEstimator } from '../monad/gasEstimator.js';
  import { encryptPrivateKey, decryptPrivateKey, secureStorage } from '../../utils/encryption.js';
  
  // ===== SMART ACCOUNT TYPES =====
  
  /**
   * Smart account configuration types
   */
  export const ACCOUNT_TYPES = {
    HYBRID: 'Hybrid',        // Supports EOA + passkeys
    PASSKEY: 'Passkey',      // Passkey only
    EOA: 'EOA'               // EOA only (for testing)
  };
  
  /**
   * Account deployment states
   */
  export const DEPLOYMENT_STATE = {
    NOT_DEPLOYED: 'not_deployed',
    DEPLOYING: 'deploying',
    DEPLOYED: 'deployed',
    FAILED: 'failed'
  };
  
  // ===== SMART ACCOUNT FACTORY CLASS =====
  
  /**
   * Factory for creating and managing MetaMask Smart Accounts
   */
  export class SmartAccountFactory {
    constructor(client = monadClient) {
      this.client = client;
      this.deployedAccounts = new Map();
      this.pendingDeployments = new Map();
      this.accountCache = new Map();
      
      // Account creation configuration
      this.config = {
        defaultImplementation: ACCOUNT_TYPES.HYBRID,
        deploySalt: SMART_ACCOUNT_CONFIG.deploySalt,
        maxRetries: 3,
        deploymentTimeout: 60000, // 60 seconds
      };
    }
    
    /**
     * Create a new smart account with deterministic address
     * @param {object} options - Account creation options
     * @returns {Promise<object>} Smart account instance
     */
    async createSmartAccount(options = {}) {
      const {
        implementation = ACCOUNT_TYPES.HYBRID,
        owner = null,
        privateKey = null,
        deploySalt = null,
        autoEncrypt = true,
        encryptionPassword = null
      } = options;
      
      try {
        // Generate or use provided owner account
        let ownerAccount;
        let generatedPrivateKey = null;
        
        if (privateKey) {
          // Use provided private key
          ownerAccount = privateKeyToAccount(privateKey);
          generatedPrivateKey = privateKey;
        } else if (owner) {
          // Use provided owner account
          ownerAccount = owner;
        } else {
          // Generate new random account
          ownerAccount = createAccount();
          generatedPrivateKey = ownerAccount.privateKey;
        }
        
        // Validate owner account
        if (!ownerAccount.address) {
          throw new Error('Invalid owner account');
        }
        
        // Calculate deterministic salt
        const salt = deploySalt || this.generateDeterministicSalt(ownerAccount.address);
        
        // Create smart account configuration
        const smartAccountConfig = {
          client: this.client.publicClient,
          implementation: Implementation[implementation],
          deployParams: SMART_ACCOUNT_CONFIG.deployParamsTemplate(ownerAccount.address),
          deploySalt: salt,
          signer: { account: ownerAccount }
        };
        
        // Create MetaMask Smart Account
        const smartAccount = await toMetaMaskSmartAccount(smartAccountConfig);
        
        // Enhanced account object
        const enhancedAccount = {
          // Core account data
          address: smartAccount.address,
          implementation,
          owner: ownerAccount.address,
          deploySalt: salt,
          
          // Account instance
          account: smartAccount,
          ownerAccount,
          
          // Deployment state
          deploymentState: DEPLOYMENT_STATE.NOT_DEPLOYED,
          deploymentTxHash: null,
          
          // Configuration
          supportsPasskeys: implementation === ACCOUNT_TYPES.HYBRID || implementation === ACCOUNT_TYPES.PASSKEY,
          supportsEOA: implementation === ACCOUNT_TYPES.HYBRID || implementation === ACCOUNT_TYPES.EOA,
          
          // Metadata
          createdAt: Date.now(),
          lastUsed: null,
          
          // Private key handling
          privateKey: generatedPrivateKey,
          isEncrypted: false,
        };
        
        // Encrypt private key if requested and available
        if (autoEncrypt && generatedPrivateKey && encryptionPassword) {
          try {
            const encryptedKey = await encryptPrivateKey(generatedPrivateKey, encryptionPassword);
            
            // Store encrypted key
            const storageKey = `smart_account_${smartAccount.address.toLowerCase()}`;
            secureStorage.store(storageKey, encryptedKey, 86400000); // 24 hours
            
            // Remove plain text private key
            enhancedAccount.privateKey = null;
            enhancedAccount.isEncrypted = true;
            enhancedAccount.encryptionStorageKey = storageKey;
            
          } catch (error) {
            console.warn('Failed to encrypt private key:', error.message);
          }
        }
        
        // Cache the account
        this.accountCache.set(smartAccount.address.toLowerCase(), enhancedAccount);
        
        // Check deployment status
        await this.checkDeploymentStatus(enhancedAccount);
        
        return enhancedAccount;
        
      } catch (error) {
        throw new Error(`Smart account creation failed: ${error.message}`);
      }
    }
    
    /**
     * Deploy smart account on first transaction
     * @param {object} smartAccount - Smart account object
     * @param {object} firstTransaction - First transaction to execute
     * @returns {Promise<string>} Deployment transaction hash
     */
    async deploySmartAccount(smartAccount, firstTransaction = null) {
      if (!smartAccount || !smartAccount.account) {
        throw new Error('Valid smart account is required');
      }
      
      const accountAddress = smartAccount.address.toLowerCase();
      
      // Check if already deployed or deploying
      if (smartAccount.deploymentState === DEPLOYMENT_STATE.DEPLOYED) {
        throw new Error('Account is already deployed');
      }
      
      if (smartAccount.deploymentState === DEPLOYMENT_STATE.DEPLOYING) {
        // Wait for pending deployment
        return await this.waitForDeployment(accountAddress);
      }
      
      try {
        // Mark as deploying
        smartAccount.deploymentState = DEPLOYMENT_STATE.DEPLOYING;
        this.pendingDeployments.set(accountAddress, Date.now());
        
        // Set account on wallet client
        this.client.setAccount(smartAccount.ownerAccount);
        
        // Prepare deployment transaction
        let deploymentTx;
        
        if (firstTransaction) {
          // Deploy with first transaction (more gas efficient)
          deploymentTx = {
            account: smartAccount.account,
            calls: [firstTransaction],
            ...await this.getOptimalGasParams()
          };
        } else {
          // Simple deployment transaction
          deploymentTx = {
            account: smartAccount.account,
            calls: [{
              to: smartAccount.address,
              data: '0x',
              value: 0n
            }],
            ...await this.getOptimalGasParams()
          };
        }
        
        // Send deployment transaction
        const txHash = await this.client.sendTransaction(deploymentTx);
        
        // Update account state
        smartAccount.deploymentTxHash = txHash;
        
        // Wait for deployment confirmation
        const receipt = await this.client.waitForTransaction(txHash);
        
        if (receipt.status === 'success') {
          smartAccount.deploymentState = DEPLOYMENT_STATE.DEPLOYED;
          this.deployedAccounts.set(accountAddress, smartAccount);
          
          console.log(`Smart account deployed: ${smartAccount.address}`);
        } else {
          smartAccount.deploymentState = DEPLOYMENT_STATE.FAILED;
          throw new Error('Deployment transaction failed');
        }
        
        // Clean up pending state
        this.pendingDeployments.delete(accountAddress);
        
        return txHash;
        
      } catch (error) {
        // Update state on failure
        smartAccount.deploymentState = DEPLOYMENT_STATE.FAILED;
        this.pendingDeployments.delete(accountAddress);
        
        throw new Error(`Smart account deployment failed: ${error.message}`);
      }
    }
    
    /**
     * Check if smart account is deployed on-chain
     * @param {object} smartAccount - Smart account object
     * @returns {Promise<boolean>} True if deployed
     */
    async checkDeploymentStatus(smartAccount) {
      if (!smartAccount || !smartAccount.address) {
        return false;
      }
      
      try {
        // Check if contract exists at address
        const code = await this.client.publicClient.getBytecode({
          address: smartAccount.address
        });
        
        const isDeployed = code && code !== '0x';
        
        // Update account state
        if (isDeployed) {
          smartAccount.deploymentState = DEPLOYMENT_STATE.DEPLOYED;
          this.deployedAccounts.set(smartAccount.address.toLowerCase(), smartAccount);
        } else {
          smartAccount.deploymentState = DEPLOYMENT_STATE.NOT_DEPLOYED;
        }
        
        return isDeployed;
        
      } catch (error) {
        console.warn('Failed to check deployment status:', error.message);
        return false;
      }
    }
    
    /**
     * Get smart account by address
     * @param {string} address - Account address
     * @returns {object|null} Smart account object or null
     */
    getSmartAccount(address) {
      if (!address) return null;
      
      const key = address.toLowerCase();
      return this.accountCache.get(key) || this.deployedAccounts.get(key) || null;
    }
    
    /**
     * Import existing smart account
     * @param {string} address - Smart account address
     * @param {string} ownerPrivateKey - Owner private key
     * @param {object} options - Import options
     * @returns {Promise<object>} Imported smart account
     */
    async importSmartAccount(address, ownerPrivateKey, options = {}) {
      const {
        implementation = ACCOUNT_TYPES.HYBRID,
        autoEncrypt = true,
        encryptionPassword = null
      } = options;
      
      if (!address || !ownerPrivateKey) {
        throw new Error('Address and owner private key are required');
      }
      
      try {
        // Validate address
        const validAddress = getAddress(address);
        
        // Create owner account from private key
        const ownerAccount = privateKeyToAccount(ownerPrivateKey);
        
        // Check if account is deployed
        const isDeployed = await this.checkAccountDeployment(validAddress);
        
        if (!isDeployed) {
          throw new Error('Smart account not found at address');
        }
        
        // Create smart account configuration
        const smartAccountConfig = {
          client: this.client.publicClient,
          implementation: Implementation[implementation],
          deployParams: SMART_ACCOUNT_CONFIG.deployParamsTemplate(ownerAccount.address),
          deploySalt: SMART_ACCOUNT_CONFIG.deploySalt,
          signer: { account: ownerAccount }
        };
        
        // Create MetaMask Smart Account instance
        const smartAccount = await toMetaMaskSmartAccount(smartAccountConfig);
        
        // Verify address matches
        if (smartAccount.address.toLowerCase() !== validAddress.toLowerCase()) {
          throw new Error('Imported account address does not match expected address');
        }
        
        // Create enhanced account object
        const enhancedAccount = {
          address: validAddress,
          implementation,
          owner: ownerAccount.address,
          deploySalt: SMART_ACCOUNT_CONFIG.deploySalt,
          account: smartAccount,
          ownerAccount,
          deploymentState: DEPLOYMENT_STATE.DEPLOYED,
          deploymentTxHash: null,
          supportsPasskeys: implementation === ACCOUNT_TYPES.HYBRID || implementation === ACCOUNT_TYPES.PASSKEY,
          supportsEOA: implementation === ACCOUNT_TYPES.HYBRID || implementation === ACCOUNT_TYPES.EOA,
          createdAt: Date.now(),
          lastUsed: null,
          privateKey: ownerPrivateKey,
          isEncrypted: false,
          isImported: true
        };
        
        // Encrypt private key if requested
        if (autoEncrypt && encryptionPassword) {
          try {
            const encryptedKey = await encryptPrivateKey(ownerPrivateKey, encryptionPassword);
            const storageKey = `smart_account_${validAddress.toLowerCase()}`;
            
            secureStorage.store(storageKey, encryptedKey, 86400000);
            
            enhancedAccount.privateKey = null;
            enhancedAccount.isEncrypted = true;
            enhancedAccount.encryptionStorageKey = storageKey;
            
          } catch (error) {
            console.warn('Failed to encrypt imported private key:', error.message);
          }
        }
        
        // Cache the account
        this.accountCache.set(validAddress.toLowerCase(), enhancedAccount);
        this.deployedAccounts.set(validAddress.toLowerCase(), enhancedAccount);
        
        return enhancedAccount;
        
      } catch (error) {
        throw new Error(`Smart account import failed: ${error.message}`);
      }
    }
    
    /**
     * Decrypt private key for transaction signing
     * @param {object} smartAccount - Smart account object
     * @param {string} password - Decryption password
     * @returns {Promise<string>} Decrypted private key
     */
    async decryptAccountPrivateKey(smartAccount, password) {
      if (!smartAccount.isEncrypted || !smartAccount.encryptionStorageKey) {
        throw new Error('Account private key is not encrypted');
      }
      
      try {
        // Retrieve encrypted data
        const encryptedData = secureStorage.retrieve(smartAccount.encryptionStorageKey);
        
        if (!encryptedData) {
          throw new Error('Encrypted private key not found in storage');
        }
        
        // Decrypt private key
        const decryptedKey = await decryptPrivateKey(encryptedData, password);
        
        return decryptedKey;
        
      } catch (error) {
        throw new Error(`Private key decryption failed: ${error.message}`);
      }
    }
    
    /**
     * Generate deterministic salt for account deployment
     * @param {string} ownerAddress - Owner address
     * @param {string} entropy - Additional entropy (optional)
     * @returns {string} Deterministic salt
     */
    generateDeterministicSalt(ownerAddress, entropy = '') {
      const data = encodePacked(
        ['address', 'string'],
        [ownerAddress, entropy,]
      );
      
      return keccak256(data);
    }
    
    /**
     * Get optimal gas parameters for deployment
     * @returns {Promise<object>} Gas parameters
     */
    async getOptimalGasParams() {
      try {
        const gasEstimate = await gasEstimator.estimateOperationGas('ACCOUNT_DEPLOYMENT');
        
        return {
          gas: BigInt(gasEstimate.standard.gasLimit),
          gasPrice: BigInt(gasEstimate.standard.gasPrice),
          maxFeePerGas: BigInt(gasEstimate.fast.gasPrice),
          maxPriorityFeePerGas: MONAD_CONFIG.baseFee / 10n, // 10% of base fee
        };
        
      } catch (error) {
        // Fallback gas parameters
        return {
          gas: BigInt(GAS_LIMITS.accountDeployment),
          gasPrice: MONAD_CONFIG.baseFee,
          maxFeePerGas: MONAD_CONFIG.baseFee * 2n,
          maxPriorityFeePerGas: MONAD_CONFIG.baseFee / 10n,
        };
      }
    }
    
    /**
     * Wait for pending deployment to complete
     * @param {string} accountAddress - Account address
     * @returns {Promise<string>} Deployment transaction hash
     */
    async waitForDeployment(accountAddress, timeout = 60000) {
      const startTime = Date.now();
      const pollInterval = 2000; // 2 seconds
      
      return new Promise((resolve, reject) => {
        const checkDeployment = async () => {
          try {
            const account = this.getSmartAccount(accountAddress);
            
            if (!account) {
              reject(new Error('Account not found'));
              return;
            }
            
            if (account.deploymentState === DEPLOYMENT_STATE.DEPLOYED) {
              resolve(account.deploymentTxHash);
              return;
            }
            
            if (account.deploymentState === DEPLOYMENT_STATE.FAILED) {
              reject(new Error('Deployment failed'));
              return;
            }
            
            // Check timeout
            if (Date.now() - startTime > timeout) {
              reject(new Error('Deployment timeout'));
              return;
            }
            
            // Continue polling
            setTimeout(checkDeployment, pollInterval);
            
          } catch (error) {
            reject(error);
          }
        };
        
        checkDeployment();
      });
    }
    
    /**
     * Check if account is deployed at address
     * @param {string} address - Account address
     * @returns {Promise<boolean>} True if deployed
     */
    async checkAccountDeployment(address) {
      try {
        const code = await this.client.publicClient.getBytecode({ address });
        return code && code !== '0x';
      } catch (error) {
        return false;
      }
    }
    
    /**
     * List all cached accounts
     * @returns {object[]} Array of smart account objects
     */
    listAccounts() {
      return Array.from(this.accountCache.values());
    }
    
    /**
     * Remove account from cache
     * @param {string} address - Account address
     * @returns {boolean} True if removed
     */
    removeAccount(address) {
      if (!address) return false;
      
      const key = address.toLowerCase();
      const removed = this.accountCache.delete(key);
      this.deployedAccounts.delete(key);
      
      // Clean up encrypted storage if exists
      const storageKey = `smart_account_${key}`;
      secureStorage.remove(storageKey);
      
      return removed;
    }
    
    /**
     * Clean up expired accounts and pending deployments
     */
    cleanup() {
      const now = Date.now();
      const maxAge = 86400000; // 24 hours
      
      // Clean up old accounts
      for (const [address, account] of this.accountCache.entries()) {
        if (now - account.createdAt > maxAge && !account.lastUsed) {
          this.removeAccount(address);
        }
      }
      
      // Clean up failed deployments
      for (const [address, timestamp] of this.pendingDeployments.entries()) {
        if (now - timestamp > 300000) { // 5 minutes
          this.pendingDeployments.delete(address);
          const account = this.getSmartAccount(address);
          if (account) {
            account.deploymentState = DEPLOYMENT_STATE.FAILED;
          }
        }
      }
    }
  }
  
  // ===== SINGLETON INSTANCE =====
  
  /**
   * Default smart account factory instance
   */
  export const smartAccountFactory = new SmartAccountFactory();
  
  // ===== UTILITY FUNCTIONS =====
  
  /**
   * Create a new smart account with defaults
   * @param {object} options - Creation options
   * @returns {Promise<object>} Smart account object
   */
  export const createNewSmartAccount = async (options = {}) => {
    return await smartAccountFactory.createSmartAccount({
      implementation: ACCOUNT_TYPES.HYBRID,
      autoEncrypt: true,
      ...options
    });
  };
  
  /**
   * Import smart account from private key
   * @param {string} address - Account address
   * @param {string} privateKey - Owner private key
   * @param {string} password - Encryption password
   * @returns {Promise<object>} Imported smart account
   */
  export const importSmartAccountWithKey = async (address, privateKey, password) => {
    return await smartAccountFactory.importSmartAccount(address, privateKey, {
      autoEncrypt: true,
      encryptionPassword: password
    });
  };
  
  /**
   * Check if address is a deployed smart account
   * @param {string} address - Address to check
   * @returns {Promise<boolean>} True if smart account
   */
  export const isSmartAccount = async (address) => {
    return await smartAccountFactory.checkAccountDeployment(address);
  };
  
  // ===== EXPORTS =====
  export default {
    SmartAccountFactory,
    smartAccountFactory,
    ACCOUNT_TYPES,
    DEPLOYMENT_STATE,
    createNewSmartAccount,
    importSmartAccountWithKey,
    isSmartAccount
  };