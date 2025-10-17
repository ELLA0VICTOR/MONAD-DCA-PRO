import { 
  Implementation, 
  toMetaMaskSmartAccount,
} from '@metamask/delegation-toolkit';
import { getAddress, keccak256, encodePacked } from 'viem';
import { 
  MONAD_CONFIG, 
  SMART_ACCOUNT_CONFIG, 
  CONTRACTS, 
  GAS_LIMITS 
} from '../../utils/constants.js';
import { monadClient } from '../monad/monadClient.js';
import { gasEstimator } from '../monad/gasEstimator.js';

// ===== SMART ACCOUNT TYPES =====

export const ACCOUNT_TYPES = {
  HYBRID: 'Hybrid',        // Supports EOA + passkeys
  PASSKEY: 'Passkey',      // Passkey only
  EOA: 'EOA'               // EOA only (for testing)
};

export const DEPLOYMENT_STATE = {
  NOT_DEPLOYED: 'not_deployed',
  DEPLOYING: 'deploying',
  DEPLOYED: 'deployed',
  FAILED: 'failed'
};

// ===== SMART ACCOUNT FACTORY CLASS =====

/**
 * Factory for creating and managing MetaMask Smart Accounts
 * Now uses EOA from wagmi instead of password-based creation
 */
export class SmartAccountFactory {
  constructor(client = monadClient) {
    this.client = client;
    this.deployedAccounts = new Map();
    this.pendingDeployments = new Map();
    this.accountCache = new Map();
    this.deploymentCache = new Map();
    
    this.config = {
      defaultImplementation: ACCOUNT_TYPES.HYBRID,
      deploySalt: SMART_ACCOUNT_CONFIG.deploySalt,
      maxRetries: 3,
      deploymentTimeout: 60000,
    };
  }
  /**
 * Create a new smart account linked to EOA
 * @param {object} eoaAccount - Viem account from wagmi (JSON-RPC account)
 * @param {object} walletClient - Wallet client for signing (REQUIRED for JSON-RPC accounts)
 * @param {object} options - Creation options
 * @returns {Promise<object>} Smart account instance
 */
async createSmartAccount(eoaAccount, walletClient = null, options = {}) {
  const {
    implementation = ACCOUNT_TYPES.HYBRID,
    deploySalt = null,
  } = options;
  
  try {
    // Validate EOA account
    if (!eoaAccount || !eoaAccount.address) {
      throw new Error('Valid EOA account is required');
    }
    
    console.log('🔧 Creating smart account with EOA:', eoaAccount.address);
    console.log('🔧 Account type:', eoaAccount.type);
    
    // Calculate deterministic salt
    const salt = deploySalt || this.generateDeterministicSalt(eoaAccount.address);
    
    // ✅ FIXED: Proper signer configuration based on account type
    let signerConfig;
    
    if (eoaAccount.type === 'json-rpc') {
      // JSON-RPC accounts (MetaMask) - MUST use walletClient
      if (!walletClient) {
        throw new Error('walletClient is required for JSON-RPC accounts');
      }
      
      console.log('📝 Using wallet client signer for JSON-RPC account');
      
      // ✅ According to MetaMask docs: just pass { walletClient } directly
      signerConfig = { walletClient };
      
    } else {
      // Local accounts (private key) - use account directly
      console.log('🔑 Using local account signer');
      signerConfig = { account: eoaAccount };
    }
    
    // Create smart account configuration
    const smartAccountConfig = {
      client: this.client.publicClient,
      implementation: Implementation[implementation],
      deployParams: SMART_ACCOUNT_CONFIG.deployParamsTemplate(eoaAccount.address),
      deploySalt: salt,
      signer: signerConfig // ✅ Now correctly formatted
    };
    
    console.log('⚙️ Smart account config prepared');
    console.log('⚙️ Signer type:', eoaAccount.type === 'json-rpc' ? 'walletClient' : 'account');
    
    // Create MetaMask Smart Account
    const smartAccount = await toMetaMaskSmartAccount(smartAccountConfig);
    
    console.log('✅ MetaMask smart account created:', smartAccount.address);
    
    // Enhanced account object
    const enhancedAccount = {
      // Core account data
      address: smartAccount.address,
      implementation,
      owner: eoaAccount.address,
      deploySalt: salt,
      
      // Account instance
      account: smartAccount,
      ownerAccount: eoaAccount,
      
      // Deployment state
      deploymentState: DEPLOYMENT_STATE.NOT_DEPLOYED,
      deploymentTxHash: null,
      
      // Configuration
      supportsPasskeys: implementation === ACCOUNT_TYPES.HYBRID || implementation === ACCOUNT_TYPES.PASSKEY,
      supportsEOA: implementation === ACCOUNT_TYPES.HYBRID || implementation === ACCOUNT_TYPES.EOA,
      
      // Metadata
      createdAt: Date.now(),
      lastUsed: null,
    };
    
    // Cache the account
    this.accountCache.set(smartAccount.address.toLowerCase(), enhancedAccount);
    
    // Check deployment status
    await this.checkDeploymentStatus(enhancedAccount);
    
    // Store in localStorage linked to EOA
    this.storeAccountForEOA(eoaAccount.address, enhancedAccount);
    
    console.log('💾 Account cached and stored');
    
    return enhancedAccount;
    
  } catch (error) {
    console.error('❌ Smart account creation failed:', error);
    throw new Error(`Smart account creation failed: ${error.message}`);
  }
}
  /**
   * Deploy smart account on-chain
   * @param {object} smartAccount - Smart account object
   * @param {object} firstTransaction - Optional first transaction
   * @returns {Promise<string>} Deployment transaction hash
   */

  /**
 * Deploy smart account on-chain
 * Uses Pimlico bundler (UserOperation) instead of sendTransaction.
 */
async deploySmartAccount(smartAccount, firstTransaction = null) {
  if (!smartAccount || !smartAccount.account) {
    throw new Error('Valid smart account is required');
  }

  const accountAddress = smartAccount.address.toLowerCase();

  // Prevent duplicate deployments
  if (smartAccount.deploymentState === DEPLOYMENT_STATE.DEPLOYED) {
    throw new Error('Account already deployed');
  }

  try {
    console.log('🚀 [Deploy] Starting deployment via Pimlico bundler for:', smartAccount.address);

    smartAccount.deploymentState = DEPLOYMENT_STATE.DEPLOYING;
    this.pendingDeployments.set(accountAddress, Date.now());

    // ✅ Dynamically import Pimlico bundler
    const { bundlerClient } = await import('../smartAccount/bundlerClient.js');

    // Prepare minimal deployment call
    const call = firstTransaction || {
      to: smartAccount.address,
      data: '0x',
      value: 0n
    };

    // ✅ Create smart account client with Pimlico integration
    const smartAccountClient = bundlerClient.createSmartAccountClient(smartAccount.account, {
      sponsorUserOperation: true
    });

    console.log('📦 Sending deployment UserOperation...');

    // ✅ Send deployment as a UserOperation (replaces sendTransaction)
    const userOpHash = await smartAccountClient.sendUserOperation({
      calls: [call]
    });

    console.log('🧾 Waiting for UserOperation receipt...');
    const receipt = await bundlerClient.waitForUserOperationReceipt(userOpHash);

    if (!receipt?.success) {
      smartAccount.deploymentState = DEPLOYMENT_STATE.FAILED;
      throw new Error('Deployment UserOperation failed');
    }

    // ✅ Update deployment metadata
    smartAccount.deploymentTxHash = receipt.receipt?.transactionHash || null;
    smartAccount.deploymentState = DEPLOYMENT_STATE.DEPLOYED;

    // ✅ Cache + store for persistence
    this.deployedAccounts.set(accountAddress, smartAccount);
    this.storeAccountForEOA(smartAccount.owner, smartAccount);
    this.pendingDeployments.delete(accountAddress);

    console.log(`✅ Smart account deployed via Pimlico: ${smartAccount.address}`);
    return smartAccount.deploymentTxHash;
  } catch (error) {
    console.error('❌ Smart account deployment failed:', error);
    smartAccount.deploymentState = DEPLOYMENT_STATE.FAILED;
    this.pendingDeployments.delete(accountAddress);
    throw new Error(`Smart account deployment failed: ${error.message}`);
  }
}

  
  /**
   * Check if smart account is deployed on-chain
   */
  async checkDeploymentStatus(smartAccount) {
    if (!smartAccount || !smartAccount.address) {
      return false;
    }
    
    try {
      const code = await this.client.publicClient.getBytecode({
        address: smartAccount.address
      });
      
      const isDeployed = code && code !== '0x';
      
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
   * Load all smart accounts for a specific EOA
   * @param {string} eoaAddress - EOA address
   * @returns {object[]} Array of smart accounts
   */
  loadAccountsForEOA(eoaAddress) {
    if (!eoaAddress) return [];
    
    try {
      const storageKey = `smart_accounts_${eoaAddress.toLowerCase()}`;
      const stored = localStorage.getItem(storageKey);
      
      if (!stored) return [];
      
      const accounts = JSON.parse(stored);
      return accounts.map(acc => ({
        address: acc.address,
        deploymentTxHash: acc.deploymentTxHash,
        createdAt: acc.createdAt,
        deploymentState: acc.deploymentState || DEPLOYMENT_STATE.NOT_DEPLOYED
      }));
      
    } catch (error) {
      console.error('Failed to load accounts for EOA:', error);
      return [];
    }
  }
  
  /**
   * Store smart account linked to EOA in localStorage
   */
  storeAccountForEOA(eoaAddress, smartAccount) {
    if (!eoaAddress || !smartAccount) return;
    
    try {
      const storageKey = `smart_accounts_${eoaAddress.toLowerCase()}`;
      const existing = this.loadAccountsForEOA(eoaAddress);
      
      // Check if account already exists
      const index = existing.findIndex(
        acc => acc.address.toLowerCase() === smartAccount.address.toLowerCase()
      );
      
      const accountData = {
        address: smartAccount.address,
        deploymentTxHash: smartAccount.deploymentTxHash,
        createdAt: smartAccount.createdAt,
        deploymentState: smartAccount.deploymentState
      };
      
      if (index >= 0) {
        existing[index] = accountData;
      } else {
        existing.push(accountData);
      }
      
      localStorage.setItem(storageKey, JSON.stringify(existing));
      
    } catch (error) {
      console.error('Failed to store account for EOA:', error);
    }
  }
  
  /**
   * Remove smart account from EOA's list
   */
  removeAccountFromEOA(eoaAddress, smartAccountAddress) {
    if (!eoaAddress || !smartAccountAddress) return false;
    
    try {
      const storageKey = `smart_accounts_${eoaAddress.toLowerCase()}`;
      const existing = this.loadAccountsForEOA(eoaAddress);
      
      const filtered = existing.filter(
        acc => acc.address.toLowerCase() !== smartAccountAddress.toLowerCase()
      );
      
      localStorage.setItem(storageKey, JSON.stringify(filtered));
      
      // Also remove from cache
      this.accountCache.delete(smartAccountAddress.toLowerCase());
      this.deployedAccounts.delete(smartAccountAddress.toLowerCase());
      
      return true;
      
    } catch (error) {
      console.error('Failed to remove account from EOA:', error);
      return false;
    }
  }
  
  /**
   * Get smart account by address
   */
  getSmartAccount(address) {
    if (!address) return null;
    const key = address.toLowerCase();
    return this.accountCache.get(key) || this.deployedAccounts.get(key) || null;
  }
  
  /**
   * Generate deterministic salt for account deployment
   */
  generateDeterministicSalt(ownerAddress, entropy = '') {
    const data = encodePacked(
      ['address', 'string'],
      [ownerAddress, entropy]
    );
    return keccak256(data);
  }
  
  /**
   * Get optimal gas parameters for deployment
   */
  async getOptimalGasParams() {
    try {
      const gasEstimate = await gasEstimator.estimateOperationGas('ACCOUNT_DEPLOYMENT');
      
      return {
        gas: BigInt(gasEstimate.standard.gasLimit),
        // ✅ Monad uses fixed gasPrice (legacy mode)
        gasPrice: BigInt(gasEstimate.standard.gasPrice || MONAD_CONFIG.baseFee),
       
      };
      
    } catch (error) {
      console.warn('⚠️ Gas estimation failed, falling back to defaults:', error.message);
      return {
        gas: BigInt(GAS_LIMITS.accountDeployment),
        gasPrice: MONAD_CONFIG.baseFee,
      
      };
    }
  }
  
  /**
   * Wait for pending deployment to complete
   */
  async waitForDeployment(accountAddress, timeout = 60000) {
    const startTime = Date.now();
    const pollInterval = 2000;
    
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
          
          if (Date.now() - startTime > timeout) {
            reject(new Error('Deployment timeout'));
            return;
          }
          
          setTimeout(checkDeployment, pollInterval);
          
        } catch (error) {
          reject(error);
        }
      };
      
      checkDeployment();
    });
  }

  /**
 * Check if account is deployed at address (cached for 5 minutes)
 */
  async checkAccountDeployment(address) {
    if (!address) return false;
    // ✅ Initialize cache if not exists

    if (!this.deploymentCache) this.deploymentCache = new Map();
    if (!this.deploymentLocks) this.deploymentLocks = new Set();
    // Check cache first
    const cached = this.deploymentCache.get(address);
    if (cached && Date.now() - cached.timestamp < 300000) {
      return cached.data;
    }
    // Prevent duplicate concurrent calls

    if (this.deploymentLocks.has(address)) return cached?.data || false;
    this.deploymentLocks.add(address);
    try {
      const code = await this.client.publicClient.getBytecode({ address });
      const deployed = code && code !== "0x";
      // ✅ Store in cache with timestamp

      this.deploymentCache.set(address, { data: deployed, timestamp: Date.now() });
      return deployed;
    } catch (error) {
      console.warn(`[SmartAccountFactory] checkAccountDeployment failed for ${address}:`, error);
      return cached?.data || false;
    } finally {
      this.deploymentLocks.delete(address);
    }
  }

  /**
   * List all cached accounts
   */
  listAccounts() {
    return Array.from(this.accountCache.values());
  }
  
  /**
   * Clean up expired accounts and pending deployments
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 86400000; // 24 hours
    
    for (const [address, account] of this.accountCache.entries()) {
      if (now - account.createdAt > maxAge && !account.lastUsed) {
        this.accountCache.delete(address);
      }
    }
    
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

export const smartAccountFactory = new SmartAccountFactory();

// ===== UTILITY FUNCTIONS =====

/**
 * Create a new smart account with EOA
 */
export const createNewSmartAccount = async (eoaAccount, walletClient, options = {}) => {
  // ✅ FIXED: Pass walletClient as second parameter
  return await smartAccountFactory.createSmartAccount(eoaAccount, walletClient, {
    implementation: ACCOUNT_TYPES.HYBRID,
    ...options
  });
};

/**
 * Check if address is a deployed smart account
 */
export const isSmartAccount = async (address) => {
  return await smartAccountFactory.checkAccountDeployment(address);
};

/**
 * Load smart accounts for EOA
 */
export const loadSmartAccountsForEOA = (eoaAddress) => {
  return smartAccountFactory.loadAccountsForEOA(eoaAddress);
};

// ===== EXPORTS =====
export default {
  SmartAccountFactory,
  smartAccountFactory,
  ACCOUNT_TYPES,
  DEPLOYMENT_STATE,
  createNewSmartAccount,
  isSmartAccount,
  loadSmartAccountsForEOA
};