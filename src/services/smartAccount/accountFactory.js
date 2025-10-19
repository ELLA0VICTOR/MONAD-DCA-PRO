import { 
  Implementation, 
  toMetaMaskSmartAccount,
} from '@metamask/delegation-toolkit';
import { getAddress, keccak256, encodePacked } from 'viem';
import { 
  ALCHEMY_CONFIG,
  SMART_ACCOUNT_CONFIG, 
  CONTRACTS 
} from '../../utils/constants.js';
import { monadClient } from '../monad/monadClient.js';

// Smart account types
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

/**
 * ✅ SIMPLIFIED Smart Account Factory
 * Following the guide - deployment happens on first tx automatically!
 */
export class SmartAccountFactory {
  constructor(client = monadClient) {
    this.client = client;
    this.deployedAccounts = new Map();
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
      
      const salt = deploySalt || this.generateDeterministicSalt(eoaAccount.address);
      
      let signerConfig;
      
      if (eoaAccount.type === 'json-rpc') {
        if (!walletClient) {
          throw new Error('walletClient is required for JSON-RPC accounts');
        }
        console.log('📝 Using wallet client signer for JSON-RPC account');
        // the 'signer' param supplied to toMetaMaskSmartAccount
        // should include the walletClient for signing
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

      // --- CRITICAL FIX: Attach walletClient to enhancedAccount + underlying account
      // This ensures downstream code (swapExecutor, bundlerClient, etc.) can
      // detect and use the walletClient to trigger the wallet/sign popup.
      if (walletClient) {
        try {
          enhancedAccount.walletClient = walletClient;
          // attach to underlying toolkit account object (if it exists)
          if (enhancedAccount.account) {
            enhancedAccount.account.walletClient = walletClient;
          }
          // helpful debug flag
          enhancedAccount.hasSigner = true;
          console.log('🔗 walletClient attached to smart account (for signing).');
        } catch (attachErr) {
          console.warn('⚠️ Failed to attach walletClient to smart account object:', attachErr);
          enhancedAccount.hasSigner = false;
        }
      } else {
        // If created with local account signer, reflect that too
        enhancedAccount.hasSigner = !!(eoaAccount && eoaAccount.privateKey) || false;
      }
      
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
   * ✅ SIMPLIFIED Deploy using Alchemy Gas Manager
   * Just like the guide says - use bundlerClient.sendUserOperation!
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
      console.log('🚀 Starting deployment via Alchemy bundler for:', smartAccount.address);

      smartAccount.deploymentState = DEPLOYMENT_STATE.DEPLOYING;

      // ✅ Import clients
      const { createBundlerClient, createPaymasterClient } = await import('viem/account-abstraction');
      const { http, createPublicClient } = await import('viem');
      const { monadTestnet } = await import('../monad/monadClient.js');

      // Prepare deployment call
      const call = firstTransaction || {
        to: smartAccount.address,
        data: '0x',
        value: 0n
      };

      console.log('🔧 Preparing user operation with Alchemy Gas Manager...');

      // ✅ Create clients
      const publicClient = createPublicClient({
        chain: monadTestnet,
        transport: http(monadTestnet.rpcUrls.default.http[0])
      });

      const bundlerClient = createBundlerClient({
        client: publicClient,
        transport: http(`https://monad-testnet.g.alchemy.com/v2/${ALCHEMY_CONFIG.API_KEY}`),
      });

      const paymasterClient = createPaymasterClient({
        transport: http(`https://monad-testnet.g.alchemy.com/v2/${ALCHEMY_CONFIG.API_KEY}`),
      });

      console.log('📤 Sending user operation to Alchemy bundler...');

      // ✅ THIS IS THE KEY - Just like the guide!
      const userOpHash = await bundlerClient.sendUserOperation({
        account: smartAccount.account,
        calls: [call],
        paymaster: paymasterClient,
        paymasterContext: {
          policyId: ALCHEMY_CONFIG.POLICY_ID
        }
      });

      console.log('✅ User operation submitted:', userOpHash);

      // Wait for receipt
      console.log('⏳ Waiting for user operation receipt...');

      const receipt = await bundlerClient.waitForUserOperationReceipt({
        hash: userOpHash
      });

      console.log('📄 Receipt received:', receipt);

      if (!receipt.success) {
        smartAccount.deploymentState = DEPLOYMENT_STATE.FAILED;
        throw new Error('User operation execution failed');
      }

      // Extract transaction hash
      const txHash = receipt.receipt?.transactionHash || userOpHash;

      // Update deployment metadata
      smartAccount.deploymentTxHash = txHash;
      smartAccount.deploymentState = DEPLOYMENT_STATE.DEPLOYED;

      // Cache + store
      this.deployedAccounts.set(accountAddress, smartAccount);
      this.storeAccountForEOA(smartAccount.owner, smartAccount);

      console.log(`✅ Smart account deployed via Alchemy: ${smartAccount.address}`);
      console.log(`✅ Transaction hash: ${txHash}`);
      
      return txHash;
      
    } catch (error) {
      console.error('❌ Smart account deployment failed:', error);
      
      smartAccount.deploymentState = DEPLOYMENT_STATE.FAILED;
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
      console.warn(`checkAccountDeployment failed for ${address}:`, error);
      return cached?.data || false;
    } finally {
      this.deploymentLocks.delete(address);
    }
  }

  listAccounts() {
    return Array.from(this.accountCache.values());
  }
}

// Singleton instance
export const smartAccountFactory = new SmartAccountFactory();

// Utility functions
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

export default {
  SmartAccountFactory,
  smartAccountFactory,
  ACCOUNT_TYPES,
  DEPLOYMENT_STATE,
  createNewSmartAccount,
  isSmartAccount,
  loadSmartAccountsForEOA
};
