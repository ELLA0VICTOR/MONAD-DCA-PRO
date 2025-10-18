import { 
  Implementation, 
  toMetaMaskSmartAccount,
} from '@metamask/delegation-toolkit';
import { getAddress, keccak256, encodePacked } from 'viem';
import { 
  MONAD_CONFIG, 
  SMART_ACCOUNT_CONFIG, 
  CONTRACTS, 
  GAS_LIMITS,
  ALCHEMY_CONFIG 
} from '../../utils/constants.js';
import { monadClient } from '../monad/monadClient.js';
import { gasEstimator } from '../monad/gasEstimator.js';

// ===== SMART ACCOUNT TYPES =====

export const ACCOUNT_TYPES = {
  HYBRID: 'Hybrid',
  PASSKEY: 'Passkey',
  EOA: 'EOA'
};

export const DEPLOYMENT_STATE = {
  NOT_DEPLOYED: 'not_deployed',
  DEPLOYING: 'deploying',
  DEPLOYED: 'deployed',
  FAILED: 'failed'
};

// ===== SMART ACCOUNT FACTORY CLASS =====

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

  async createSmartAccount(eoaAccount, walletClient = null, options = {}) {
    const {
      implementation = ACCOUNT_TYPES.HYBRID,
      deploySalt = null,
    } = options;
    
    try {
      if (!eoaAccount || !eoaAccount.address) {
        throw new Error('Valid EOA account is required');
      }
      
      console.log('🔧 Creating smart account with EOA:', eoaAccount.address);
      console.log('🔧 Account type:', eoaAccount.type);
      
      const salt = deploySalt || this.generateDeterministicSalt(eoaAccount.address);
      
      let signerConfig;
      
      if (eoaAccount.type === 'json-rpc') {
        if (!walletClient) {
          throw new Error('walletClient is required for JSON-RPC accounts');
        }
        
        console.log('📝 Using wallet client signer for JSON-RPC account');
        signerConfig = { walletClient };
        
      } else {
        console.log('🔑 Using local account signer');
        signerConfig = { account: eoaAccount };
      }
      
      const smartAccountConfig = {
        client: this.client.publicClient,
        implementation: Implementation[implementation],
        deployParams: SMART_ACCOUNT_CONFIG.deployParamsTemplate(eoaAccount.address),
        deploySalt: salt,
        signer: signerConfig
      };
      
      console.log('⚙️ Smart account config prepared');
      
      const smartAccount = await toMetaMaskSmartAccount(smartAccountConfig);
      
      console.log('✅ MetaMask smart account created:', smartAccount.address);
      
      const enhancedAccount = {
        address: smartAccount.address,
        implementation,
        owner: eoaAccount.address,
        deploySalt: salt,
        account: smartAccount,
        ownerAccount: eoaAccount,
        deploymentState: DEPLOYMENT_STATE.NOT_DEPLOYED,
        deploymentTxHash: null,
        supportsPasskeys: implementation === ACCOUNT_TYPES.HYBRID || implementation === ACCOUNT_TYPES.PASSKEY,
        supportsEOA: implementation === ACCOUNT_TYPES.HYBRID || implementation === ACCOUNT_TYPES.EOA,
        createdAt: Date.now(),
        lastUsed: null,
      };
      
      this.accountCache.set(smartAccount.address.toLowerCase(), enhancedAccount);
      await this.checkDeploymentStatus(enhancedAccount);
      this.storeAccountForEOA(eoaAccount.address, enhancedAccount);
      
      console.log('💾 Account cached and stored');
      
      return enhancedAccount;
      
    } catch (error) {
      console.error('❌ Smart account creation failed:', error);
      throw new Error(`Smart account creation failed: ${error.message}`);
    }
  }

  /**
   * ✅ Deploy using Alchemy Gas Manager (simplified - no sponsor signatures)
   */
  async deploySmartAccount(smartAccount, firstTransaction = null) {
    if (!smartAccount || !smartAccount.account) {
      throw new Error('Valid smart account is required');
    }

    const accountAddress = smartAccount.address.toLowerCase();

    if (smartAccount.deploymentState === DEPLOYMENT_STATE.DEPLOYED) {
      throw new Error('Account already deployed');
    }

    try {
      console.log('🚀 [Deploy] Starting deployment via Alchemy bundler for:', smartAccount.address);

      smartAccount.deploymentState = DEPLOYMENT_STATE.DEPLOYING;
      this.pendingDeployments.set(accountAddress, Date.now());

      // ✅ Import Alchemy bundler
      const { bundlerClient } = await import('../smartAccount/bundlerClient.js');

      // Prepare minimal deployment call
      const call = firstTransaction || {
        to: smartAccount.address,
        data: '0x',
        value: 0n
      };

      console.log('🔧 Step 1: Preparing user operation with Alchemy Gas Manager...');

      // ✅ Create smart account client with Alchemy sponsorship
      const smartAccountClient = await bundlerClient.createSmartAccountClient(smartAccount.account, {
        sponsorUserOperation: true // Enable Alchemy Gas Manager
      });

      // ✅ Prepare and send the user operation with paymasterContext
      console.log('📤 Sending user operation to Alchemy bundler...');

      const userOpHash = await smartAccountClient.sendUserOperation({
        calls: [call],
        paymasterContext: {
          policyId: ALCHEMY_CONFIG.POLICY_ID
        }
      });

      console.log('✅ User operation submitted:', userOpHash);

      // ✅ Wait for user operation receipt
      console.log('⏳ Waiting for user operation receipt...');

      const receipt = await smartAccountClient.waitForUserOperationReceipt({
        hash: userOpHash
      });

      console.log('📄 Receipt received:', receipt);

      if (!receipt.success) {
        smartAccount.deploymentState = DEPLOYMENT_STATE.FAILED;
        throw new Error('User operation execution failed');
      }

      // ✅ Extract transaction hash from receipt
      const txHash = receipt.receipt?.transactionHash || userOpHash;

      // ✅ Update deployment metadata
      smartAccount.deploymentTxHash = txHash;
      smartAccount.deploymentState = DEPLOYMENT_STATE.DEPLOYED;

      // ✅ Cache + store for persistence
      this.deployedAccounts.set(accountAddress, smartAccount);
      this.storeAccountForEOA(smartAccount.owner, smartAccount);
      this.pendingDeployments.delete(accountAddress);

      console.log(`✅ Smart account deployed via Alchemy: ${smartAccount.address}`);
      console.log(`✅ Transaction hash: ${txHash}`);
      
      return txHash;
      
    } catch (error) {
      console.error('❌ Smart account deployment failed:', error);
      console.error('Error details:', {
        message: error.message,
        cause: error.cause,
        stack: error.stack?.split('\n').slice(0, 3)
      });
      
      smartAccount.deploymentState = DEPLOYMENT_STATE.FAILED;
      this.pendingDeployments.delete(accountAddress);
      throw new Error(`Smart account deployment failed: ${error.message}`);
    }
  }

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

  storeAccountForEOA(eoaAddress, smartAccount) {
    if (!eoaAddress || !smartAccount) return;
    
    try {
      const storageKey = `smart_accounts_${eoaAddress.toLowerCase()}`;
      const existing = this.loadAccountsForEOA(eoaAddress);
      
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

  removeAccountFromEOA(eoaAddress, smartAccountAddress) {
    if (!eoaAddress || !smartAccountAddress) return false;
    
    try {
      const storageKey = `smart_accounts_${eoaAddress.toLowerCase()}`;
      const existing = this.loadAccountsForEOA(eoaAddress);
      
      const filtered = existing.filter(
        acc => acc.address.toLowerCase() !== smartAccountAddress.toLowerCase()
      );
      
      localStorage.setItem(storageKey, JSON.stringify(filtered));
      
      this.accountCache.delete(smartAccountAddress.toLowerCase());
      this.deployedAccounts.delete(smartAccountAddress.toLowerCase());
      
      return true;
      
    } catch (error) {
      console.error('Failed to remove account from EOA:', error);
      return false;
    }
  }

  getSmartAccount(address) {
    if (!address) return null;
    const key = address.toLowerCase();
    return this.accountCache.get(key) || this.deployedAccounts.get(key) || null;
  }

  generateDeterministicSalt(ownerAddress, entropy = '') {
    const data = encodePacked(
      ['address', 'string'],
      [ownerAddress, entropy]
    );
    return keccak256(data);
  }

  async getOptimalGasParams() {
    try {
      const gasEstimate = await gasEstimator.estimateOperationGas('ACCOUNT_DEPLOYMENT');
      
      return {
        gas: BigInt(gasEstimate.standard.gasLimit),
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

  async checkAccountDeployment(address) {
    if (!address) return false;

    if (!this.deploymentCache) this.deploymentCache = new Map();
    if (!this.deploymentLocks) this.deploymentLocks = new Set();

    const cached = this.deploymentCache.get(address);
    if (cached && Date.now() - cached.timestamp < 300000) {
      return cached.data;
    }

    if (this.deploymentLocks.has(address)) return cached?.data || false;
    this.deploymentLocks.add(address);

    try {
      const code = await this.client.publicClient.getBytecode({ address });
      const deployed = code && code !== "0x";

      this.deploymentCache.set(address, { data: deployed, timestamp: Date.now() });
      return deployed;
    } catch (error) {
      console.warn(`[SmartAccountFactory] checkAccountDeployment failed for ${address}:`, error);
      return cached?.data || false;
    } finally {
      this.deploymentLocks.delete(address);
    }
  }

  listAccounts() {
    return Array.from(this.accountCache.values());
  }

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

export const createNewSmartAccount = async (eoaAccount, walletClient, options = {}) => {
  return await smartAccountFactory.createSmartAccount(eoaAccount, walletClient, {
    implementation: ACCOUNT_TYPES.HYBRID,
    ...options
  });
};

export const isSmartAccount = async (address) => {
  return await smartAccountFactory.checkAccountDeployment(address);
};

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