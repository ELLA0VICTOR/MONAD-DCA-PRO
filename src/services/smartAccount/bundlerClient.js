import { createSmartAccountClient } from 'permissionless';
import {
  entryPoint06Address,
  entryPoint07Address,
  createBundlerClient,
} from 'viem/account-abstraction';
import { createPublicClient, http } from 'viem';
import {
  MONAD_CONFIG,
  GAS_LIMITS,
  ALCHEMY_CONFIG
} from '../../utils/constants.js';
import { monadTestnet } from '../monad/monadClient.js';

export const USER_OP_STATUS = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  INCLUDED: 'included',
  EXECUTED: 'executed',
  FAILED: 'failed',
  REJECTED: 'rejected'
};

export const ENTRYPOINT_VERSIONS = {
  V06: 'v0.6',
  V07: 'v0.7'
};

/**
 * Alchemy Bundler Client with Gas Manager Integration
 */
export class AlchemyBundlerClient {
  
  constructor(options = {}) {
    const {
      entryPointVersion = ENTRYPOINT_VERSIONS.V07,
      timeout = 30000,
      pollingInterval = 1000
    } = options;

    this.entryPointVersion = entryPointVersion;
    this.timeout = timeout;
    this.pollingInterval = pollingInterval;
    this.bundlerUrl = `https://monad-testnet.g.alchemy.com/v2/${ALCHEMY_CONFIG.API_KEY}`;

    this.publicClient = null;
    this.bundlerClient = null;
    this.entryPointAddress = this.getEntryPointConfig(entryPointVersion);

    this.pendingOperations = new Map();
    this.operationHistory = new Map();

    this.initializeClients();
  }

  initializeClients() {
    try {
      this.publicClient = createPublicClient({
        chain: monadTestnet,
        transport: http(monadTestnet.rpcUrls.default.http[0])
      });
  
      // ✅ Basic bundler client (no paymaster - we'll handle that manually)
      this.bundlerClient = createBundlerClient({
        transport: http(this.bundlerUrl),
        client: this.publicClient,
        chain: monadTestnet,
      });
  
      console.log(`✅ Alchemy Bundler initialized with EntryPoint ${this.entryPointVersion}`);
      console.log(`✅ Gas Manager Policy: ${ALCHEMY_CONFIG.POLICY_ID}`);
    } catch (error) {
      console.error('❌ Failed to initialize Alchemy clients:', error);
      throw new Error(`Alchemy client initialization failed: ${error.message}`);
    }
  }

  getEntryPointConfig(version) {
    switch (version) {
      case ENTRYPOINT_VERSIONS.V07:
        return entryPoint07Address;
      case ENTRYPOINT_VERSIONS.V06:
        return entryPoint06Address;
      default:
        return entryPoint07Address;
    }
  }

  /**
   * ✅ CRITICAL: Alchemy Gas Manager API call
   * This requests gas sponsorship and returns paymaster signature
   */
  async requestGasAndPaymasterData(userOperation, entryPoint) {
    try {
      console.log('💰 Requesting gas sponsorship from Alchemy Gas Manager...');
  
      // ✅ Format nonce properly
      const nonceHex = typeof userOperation.nonce === 'bigint' 
        ? `0x${userOperation.nonce.toString(16)}`
        : userOperation.nonce;
  
      // ✅ Build minimal payload - let Alchemy estimate gas
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'alchemy_requestGasAndPaymasterAndData',
        params: [
          {
            policyId: ALCHEMY_CONFIG.POLICY_ID,
            entryPoint: entryPoint || this.entryPointAddress,
            dummySignature: userOperation.signature || ('0x' + '00'.repeat(65)),
            userOperation: {
              sender: userOperation.sender,
              nonce: nonceHex,
              callData: userOperation.callData,
              // ✅ DON'T include gas fields - let Alchemy calculate them
            }
          }
        ]
      };
  
      console.log('📤 Alchemy request payload:', {
        policyId: ALCHEMY_CONFIG.POLICY_ID,
        entryPoint: entryPoint || this.entryPointAddress,
        sender: userOperation.sender,
        nonce: nonceHex,
        callDataLength: userOperation.callData?.length
      });
  
      const response = await fetch(this.bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
  
      const data = await response.json();
  
      console.log('📥 Alchemy full response:', JSON.stringify(data, null, 2));
  
      if (!response.ok || data.error) {
        console.error('❌ Alchemy API error response:', data);
        
        const errorMsg = data.error?.message || 
                        data.error?.data?.message || 
                        `HTTP ${response.status}`;
        
        throw new Error(`Alchemy API error: ${errorMsg}`);
      }
  
      console.log('✅ Gas Manager response received:', {
        hasResult: !!data.result,
        hasPaymaster: !!(data.result?.paymaster || data.result?.paymasterAndData),
        callGasLimit: data.result?.callGasLimit,
        verificationGasLimit: data.result?.verificationGasLimit
      });
  
      return data.result;
  
    } catch (error) {
      console.error('❌ requestGasAndPaymasterData failed:', error);
      throw error;
    }
  }

  
  /**
   * Create smart account client for sending UserOps
   */
  async createSmartAccountClient(account) {
    console.log('🔧 Creating smart account client for:', account.address);
  
    const smartClient = createSmartAccountClient({
      account,
      chain: monadTestnet,
      bundlerTransport: http(this.bundlerUrl),
      entryPoint: this.entryPointAddress,
    });
  
    return smartClient;
  }

  /**
   * Get current gas prices from Alchemy
   */
  async getUserOperationGasPrice() {
    try {
      const response = await fetch(this.bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'rundler_maxPriorityFeePerGas',
          params: []
        })
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }

      const maxPriorityFee = BigInt(data.result);
      const baseFee = MONAD_CONFIG.baseFee || 1n;

      return {
        slow: {
          maxFeePerGas: baseFee * 15n / 10n,
          maxPriorityFeePerGas: maxPriorityFee / 2n
        },
        standard: {
          maxFeePerGas: baseFee * 2n,
          maxPriorityFeePerGas: maxPriorityFee
        },
        fast: {
          maxFeePerGas: baseFee * 3n,
          maxPriorityFeePerGas: maxPriorityFee * 15n / 10n
        }
      };
    } catch (error) {
      console.warn('⚠️ Gas price fetch failed, using fallback:', error.message);
      return {
        slow: { maxFeePerGas: 150000000000n, maxPriorityFeePerGas: 10000000000n },
        standard: { maxFeePerGas: 200000000000n, maxPriorityFeePerGas: 20000000000n },
        fast: { maxFeePerGas: 300000000000n, maxPriorityFeePerGas: 30000000000n }
      };
    }
  }

  async healthCheck() {
    try {
      const gasPrice = await this.getUserOperationGasPrice();
      
      const code = await this.publicClient.getCode({
        address: this.entryPointAddress
      });

      if (!code || code === '0x') {
        console.error('❌ EntryPoint not deployed at', this.entryPointAddress);
        return false;
      }

      console.log('✅ Alchemy Bundler + Gas Manager healthy');
      return true;
    } catch (error) {
      console.error('❌ Health check failed:', error);
      return false;
    }
  }

  trackUserOperation(userOpHash, userOperation) {
    this.pendingOperations.set(userOpHash, {
      hash: userOpHash,
      userOperation,
      status: USER_OP_STATUS.SUBMITTED,
      submittedAt: Date.now()
    });

    setTimeout(() => {
      this.pendingOperations.delete(userOpHash);
    }, 3600000);
  }
}

export const bundlerClient = new AlchemyBundlerClient();

export default {
  AlchemyBundlerClient,
  bundlerClient,
  USER_OP_STATUS,
  ENTRYPOINT_VERSIONS
};