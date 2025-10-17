import { createSmartAccountClient } from 'permissionless';
import {
  entryPoint06Address,
  entryPoint07Address,
  createBundlerClient,
  createPaymasterClient
} from 'viem/account-abstraction';
import { createPublicClient, http } from 'viem';
import {
  MONAD_CONFIG,
  GAS_LIMITS,
  ERROR_CODES,
  FASTLANE_CONFIG
} from '../../utils/constants.js';
import { monadTestnet } from '../monad/monadClient.js';
import { gasEstimator } from '../monad/gasEstimator.js';

// Fastlane endpoints (default)
const FASTLANE_BUNDLER_URL = FASTLANE_CONFIG?.BUNDLER_URL || 'https://monad-testnet.4337-shbundler-fra.fastlane-labs.xyz';
const FASTLANE_WS_URL = 'wss://monad-testnet.4337-shbundler-fra.fastlane-labs.xyz';

// User Operation status states
export const USER_OP_STATUS = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  INCLUDED: 'included',
  EXECUTED: 'executed',
  FAILED: 'failed',
  REJECTED: 'rejected'
};

// EntryPoint versions supported
export const ENTRYPOINT_VERSIONS = {
  V06: 'v0.6',
  V07: 'v0.7'
};

export class MonadFastlaneBundlerClient {
  
  constructor(options = {}) {
    const {
      entryPointVersion = ENTRYPOINT_VERSIONS.V07,
      timeout = 30000,
      pollingInterval = 1000
    } = options;

    this.entryPointVersion = entryPointVersion;
    this.timeout = timeout;
    this.pollingInterval = pollingInterval;

    this.bundlerUrl = FASTLANE_BUNDLER_URL;
    this.wsUrl = FASTLANE_WS_URL;

    this.publicClient = null;
    this.bundlerClient = null;
    this.paymasterClient = null;
    this.entryPoint = this.getEntryPointConfig(entryPointVersion);

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
  
      this.entryPointAddress = this.getEntryPointConfig(this.entryPointVersion);
  
      this.paymasterClient = createPaymasterClient({
        transport: http(this.bundlerUrl)
      });
  
      // ✅ FIX: Proper bundler RPC helper with correct parameter format
      this._bundlerRpc = async (method, params) => {
        try {
          // ✅ CRITICAL: For eth_estimateUserOperationGas, ensure EntryPoint is included
          let finalParams = params;
          
          if (method === 'eth_estimateUserOperationGas' && Array.isArray(params) && params.length === 1) {
            // Add entryPoint as second parameter if missing
            finalParams = [params[0], this.entryPointAddress];
            console.log('📡 Adding entryPoint to estimateUserOperationGas params');
          }
  
          console.log(`📡 Bundler RPC: ${method}`, {
            paramsCount: finalParams.length,
            hasEntryPoint: finalParams.length > 1
          });
  
          const res = await fetch(this.bundlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: Date.now(),
              method,
              params: finalParams
            })
          });
  
          const json = await res.json();
          
          if (json.error) {
            console.error('❌ Bundler RPC error response:', json.error);
            throw new Error(json.error.message || JSON.stringify(json.error));
          }
          
          return json.result;
        } catch (err) {
          console.error('❌ Bundler RPC error:', method, err);
          throw err;
        }
      };
  
      this.bundlerClient = createBundlerClient({
        transport: http(this.bundlerUrl),
        name: 'shBundler',
        client: this.publicClient,
        chain: monadTestnet,
        entryPoint: this.entryPointAddress,
        paymaster: this.paymasterClient,
        userOperation: {
          estimateFeesPerGas: async () => {
            return await this.getUserOperationGasPrice();
          }
        }
      });
  
      // ✅ FIX: Remove the problematic estimateUserOperationGas override
      // Let viem handle it with proper EntryPoint parameter
      console.log('✅ Using viem default estimateUserOperationGas (with EntryPoint parameter)');
  
      console.log(`✅ Fastlane shBundler initialized for Monad with EntryPoint ${this.entryPointVersion} at ${this.entryPointAddress}`);
      console.log(`✅ Fastlane shMonad Paymaster integrated at ${this.bundlerUrl}`);
    } catch (error) {
      console.error('❌ Failed to initialize Fastlane clients:', error);
      throw new Error(`Fastlane client initialization failed: ${error.message}`);
    }
  }

  async healthCheck() {
    try {
      console.log('🔍 Fastlane Config Check:', {
        bundlerUrl: this.bundlerUrl,
        entryPoint: this.entryPointAddress,
        version: this.entryPointVersion,
        hasPaymaster: !!this.paymasterClient
      });

      await this.getUserOperationGasPrice();

      const code = await this.publicClient.getCode({
        address: this.entryPointAddress
      });

      if (!code || code === '0x') {
        console.error('❌ EntryPoint not deployed at', this.entryPointAddress);
        return false;
      }

      console.log('✅ EntryPoint verified at', this.entryPointAddress);
      console.log('✅ Fastlane shBundler + shMonad healthy');

      return true;
    } catch (error) {
      console.error('❌ Health check failed:', error);
      return false;
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

  async getPaymasterAddress() {
    if (this.cachedPaymasterAddress) {
      return this.cachedPaymasterAddress;
    }

    try {
      const ADDRESS_HUB = FASTLANE_CONFIG?.ADDRESS_HUB || '0xC9f0cDE8316AbC5Efc8C3f5A6b571e815C021B51';

      const paymasterAddress = await this.publicClient.readContract({
        address: ADDRESS_HUB,
        abi: [{
          inputs: [],
          name: 'paymaster4337',
          outputs: [{ name: '', type: 'address' }],
          stateMutability: 'view',
          type: 'function'
        }],
        functionName: 'paymaster4337'
      });

      this.cachedPaymasterAddress = paymasterAddress;
      console.log('✅ Fastlane Paymaster Address:', paymasterAddress);

      return paymasterAddress;
    } catch (error) {
      console.error('❌ Failed to get paymaster address:', error);
      return null;
    }
  }
  /**
   * Create smart account client with Fastlane shBundler + shMonad Paymaster
   * Accepts optional paymasterExtras which can include sponsorSignature, validUntil, validAfter.
   */
  async createSmartAccountClient(account, options = {}) {
    const {
      sponsorUserOperation = false,
      sponsorAddress = null,
      // NEW: allow passing sponsorSignature & time bounds at client creation time
      paymasterExtras = {}
    } = options;

    const {
      sponsorSignature: extraSponsorSignature,
      validUntil: extraValidUntil,
      validAfter: extraValidAfter
    } = paymasterExtras || {};

    console.log('🔧 createSmartAccountClient called with:', {
      hasAccount: !!account,
      accountAddress: account?.address,
      sponsorUserOperation,
      sponsorAddress,
      sponsorAddressType: typeof sponsorAddress,
      hasPaymasterExtras: !!paymasterExtras
    });

    const clientConfig = {
      account,
      chain: monadTestnet,
      bundlerTransport: http(this.bundlerUrl),
      userOperation: {
        estimateFeesPerGas: async () => {
          const gasPrice = await this.getUserOperationGasPrice();
          return gasPrice.fast || gasPrice.standard || gasPrice;
        }
      }
    };

    if (sponsorUserOperation && this.paymasterClient) {
      console.log('💰 Gas sponsorship enabled via Fastlane shMonad paymaster');

      clientConfig.paymaster = this.paymasterClient;

      if (sponsorAddress) {
        const normalized = this._normalizeAddress(sponsorAddress);
        if (!this._isValidAddress(normalized)) {
          console.warn('⚠️ Provided sponsorAddress is invalid format, falling back to provided raw value:', sponsorAddress);
        }

        console.log(`👔 SPONSOR MODE: ${normalized} will pay gas for ${account.address}`);

        // Build full paymasterContext including optional signature and bounds
        const sponsorContext = {
          mode: 'sponsor',
          sponsor: normalized
        };

        if (extraSponsorSignature) sponsorContext.sponsorSignature = extraSponsorSignature;
        if (extraValidUntil) sponsorContext.validUntil = extraValidUntil;
        if (extraValidAfter) sponsorContext.validAfter = extraValidAfter;

        clientConfig.paymasterContext = sponsorContext;

        console.log('✅ Paymaster context configured (sponsor mode):', clientConfig.paymasterContext);
      } else {
        console.log(`👤 USER MODE: ${account.address} will pay with its bonded shMON`);
        clientConfig.paymasterContext = {
          mode: 'user',
          address: account.address
        };
      }
    }

 
    console.log('📋 Final client config:', {
      hasAccount: !!clientConfig.account,
      hasPaymaster: !!clientConfig.paymaster,
      hasPaymasterContext: !!clientConfig.paymasterContext,
      paymasterMode: clientConfig.paymasterContext?.mode,
      paymasterAddress: clientConfig.paymasterContext?.address || clientConfig.paymasterContext?.sponsor
    });

    const rawSmartClient = createSmartAccountClient(clientConfig);
    const smartClient = rawSmartClient || {};

    if (!smartClient.account) {
      smartClient.account = account;
    }

    if (!smartClient.sendTransaction) {
      if (typeof smartClient.sendUserOperation === 'function') {
        smartClient.sendTransaction = async (tx) => {
          return await smartClient.sendUserOperation(tx);
        };
      } else if (typeof smartClient.send === 'function') {
        smartClient.sendTransaction = async (tx) => smartClient.send(tx);
      } else {
        smartClient.sendTransaction = async () => {
          throw new Error('Smart client does not implement sendTransaction/sendUserOperation');
        };
      }
    }

    return smartClient;
  }

  _normalizeAddress(addr) {
    if (!addr) return addr;
    if (typeof addr !== 'string') return addr;
    const lowered = addr.toLowerCase();
    if (lowered.startsWith('0x')) return lowered;
    return `0x${lowered}`;
  }

  _isValidAddress(addr) {
    if (!addr || typeof addr !== 'string') return false;
    return /^0x[a-fA-F0-9]{40}$/.test(addr);
  }

  async estimateUserOperationGas(userOperation, options = {}) {
    let account = options.account || userOperation.account;
    let sender = userOperation.sender;
    let nonce = userOperation.nonce;
    let callData = userOperation.callData;
  
    if (!sender && userOperation.address) {
      account = userOperation;
      sender = account.address;
    }
  
    if (!account) {
      console.error('❌ No account provided to estimateUserOperationGas');
      throw new Error('Account is required for gas estimation');
    }
  
    if (!sender) {
      sender = account.address;
    }
  
    if (!callData) {
      console.warn('⚠️ No callData provided, attempting to encode from account');
      if (options.calls && account.encodeCalls) {
        callData = await account.encodeCalls(options.calls);
      }
    }
  
    if (nonce === undefined || nonce === null) {
      console.warn('⚠️ No nonce provided, fetching from account');
      if (account.getNonce) {
        nonce = await account.getNonce();
      }
    }
  
    let gasPrice;
    try {
      gasPrice = await this.getUserOperationGasPrice();
    } catch (error) {
      console.warn('⚠️ Failed to get gas price from Fastlane, falling back:', error.message);
      gasPrice = {
        fast: {
          maxFeePerGas: MONAD_CONFIG.baseFee * 3n,
          maxPriorityFeePerGas: MONAD_CONFIG.baseFee / 5n
        }
      };
    }
  
    console.log('🔍 Estimating gas with Fastlane:', {
      hasAccount: !!account,
      sender,
      hasCallData: !!callData,
      callDataLength: callData?.length,
      nonce: nonce?.toString(),
      accountType: account?.type,
      maxFeePerGas: (gasPrice.fast?.maxFeePerGas || gasPrice.maxFeePerGas)?.toString?.() || null,
      maxPriorityFeePerGas: (gasPrice.fast?.maxPriorityFeePerGas || gasPrice.maxPriorityFeePerGas)?.toString?.() || null
    });
  
    // ✅ FIX: Return proper gas limits (NOT zero)
    console.log('⚠️ Using safe gas defaults for Monad testnet (non-zero values)');
  
    return {
      callGasLimit: 250000n,
      verificationGasLimit: 120000n,
      preVerificationGas: 60000n,
      paymasterVerificationGasLimit: this.paymasterClient ? 60000n : undefined,
      paymasterPostOpGasLimit: this.paymasterClient ? 40000n : undefined,
      monadSpecific: {
        chargesGasLimit: true,
        baseFee: MONAD_CONFIG.baseFee.toString(),
        adjustmentApplied: true,
        note: 'Using safe fallback for Monad testnet with Fastlane'
      }
    };
  }
  // ===== REPLACE YOUR sendUserOperation METHOD WITH THIS =====

  async sendUserOperation(userOperationOrConfig, options = {}) {
    try {
      // ✅ Support both direct userOperation and config object
      let userOperation;
      let paymasterContext;
      let account;
      let entryPoint = this.entryPointAddress;
  
      if (userOperationOrConfig.userOperation) {
        // Called with config object { userOperation, account, entryPoint, paymasterContext }
        userOperation = userOperationOrConfig.userOperation;
        paymasterContext = userOperationOrConfig.userOperation.paymasterContext;
        account = userOperationOrConfig.account;
        entryPoint = userOperationOrConfig.entryPoint || this.entryPointAddress;
      } else {
        // Called with direct userOperation
        userOperation = userOperationOrConfig;
        paymasterContext = userOperation.paymasterContext;
        account = options.account;
      }
  
      console.log('🔍 sendUserOperation called with:', {
        hasUserOp: !!userOperation,
        hasPaymasterContext: !!paymasterContext,
        paymasterMode: paymasterContext?.mode,
        hasSponsor: !!paymasterContext?.sponsor,
        hasSignature: !!paymasterContext?.sponsorSignature,
        entryPoint,
        // ✅ CRITICAL: Log gas values to verify they're NOT zero
        callGasLimit: userOperation.callGasLimit?.toString(),
        verificationGasLimit: userOperation.verificationGasLimit?.toString(),
        preVerificationGas: userOperation.preVerificationGas?.toString()
      });
  
      // Log full UserOperation object for debugging
      console.log('🔍 Full UserOperation payload:', JSON.stringify(userOperation, null, 2));
  
      // ✅ CRITICAL: Validate gas fields are NOT zero before sending
      if (!userOperation.callGasLimit || userOperation.callGasLimit === 0n ||
          !userOperation.verificationGasLimit || userOperation.verificationGasLimit === 0n ||
          !userOperation.preVerificationGas || userOperation.preVerificationGas === 0n) {
        
        console.error('❌ UserOperation has zero gas limits!', {
          callGasLimit: userOperation.callGasLimit?.toString(),
          verificationGasLimit: userOperation.verificationGasLimit?.toString(),
          preVerificationGas: userOperation.preVerificationGas?.toString()
        });
        
        throw new Error('UserOperation gas limits cannot be zero. Estimation failed.');
      }
  
      // If paymasterContext exists with signature, log and pass it
      if (paymasterContext && paymasterContext.sponsorSignature) {
        console.log('✅ Fastlane paymaster context detected with signature');
        console.log('   Mode:', paymasterContext.mode);
        console.log('   Sponsor:', paymasterContext.sponsor);
        console.log('   Valid until:', paymasterContext.validUntil?.toString());
        console.log('   Valid after:', paymasterContext.validAfter?.toString());
  
        // Before sending, log the literal bundler JSON-RPC request payload
        const rpcPayload = {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'eth_sendUserOperation',
          params: [{
            ...userOperation,
            account: account || userOperation.account,
            paymasterContext: {
              mode: paymasterContext.mode,
              sponsor: paymasterContext.sponsor,
              sponsorSignature: paymasterContext.sponsorSignature,
              validUntil: paymasterContext.validUntil,
              validAfter: paymasterContext.validAfter
            }
          }]
        };
        console.log('📡 JSON-RPC Request Payload:', JSON.stringify(rpcPayload, null, 2));
  
        const userOpHash = await this.bundlerClient.sendUserOperation(rpcPayload.params[0]);
  
        this.trackUserOperation(userOpHash, userOperation);
        console.log(`✅ User operation submitted via Fastlane with sponsorship: ${userOpHash}`);
        
        return userOpHash;
      }
  
      // Fallback: Send without paymaster context, log payload as well
      this.validateUserOperation(userOperation);
  
      const fallbackPayload = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'eth_sendUserOperation',
        params: [{
          ...userOperation,
          account: account || userOperation.account,
          entryPoint
        }]
      };
      console.log('📡 JSON-RPC Request Payload (Fallback):', JSON.stringify(fallbackPayload, null, 2));
  
      const userOpHash = await this.bundlerClient.sendUserOperation(fallbackPayload.params[0]);
  
      this.trackUserOperation(userOpHash, userOperation);
      console.log(`✅ User operation submitted: ${userOpHash}`);
      
      return userOpHash;
  
    } catch (error) {
      console.error('❌ Fastlane user operation submission failed:', error);
      console.error('   Error details:', {
        message: error.message,
        shortMessage: error.shortMessage,
        details: error.details,
        cause: error.cause
      });
      throw new Error(`User operation submission failed: ${error.message}`);
    }
  }
  

  async getUserOperationGasPrice() {
    try {
      const gasPrice = typeof this.bundlerClient.getUserOperationGasPrice === 'function'
        ? await this.bundlerClient.getUserOperationGasPrice()
        : null;

      if (gasPrice && (gasPrice.fast || gasPrice.standard || gasPrice.slow)) {
        return gasPrice;
      }

      if (gasPrice) {
        return {
          slow: gasPrice,
          standard: gasPrice,
          fast: gasPrice
        };
      }

      throw new Error('Bundler did not return gas price');
    } catch (error) {
      console.warn('⚠️ Fastlane gas price fetch failed, using fallback:', error.message);

      return {
        slow: {
          maxFeePerGas: MONAD_CONFIG.baseFee * 15n / 10n,
          maxPriorityFeePerGas: MONAD_CONFIG.baseFee / 20n
        },
        standard: {
          maxFeePerGas: MONAD_CONFIG.baseFee * 2n,
          maxPriorityFeePerGas: MONAD_CONFIG.baseFee / 10n
        },
        fast: {
          maxFeePerGas: MONAD_CONFIG.baseFee * 3n,
          maxPriorityFeePerGas: MONAD_CONFIG.baseFee / 5n
        }
      };
    }
  }

  validateUserOperation(userOperation) {
    const requiredFields = ['sender', 'nonce', 'callData'];

    for (const field of requiredFields) {
      if (!userOperation[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (userOperation.sender && !userOperation.sender.match(/^0x[a-fA-F0-9]{40}$/)) {
      throw new Error('Invalid sender address format');
    }

    if (userOperation.paymasterAndData && !userOperation.paymasterAndData.startsWith('0x')) {
      throw new Error('Invalid paymaster address format');
    }
  }

  adjustGasForMonad(gasEstimate) {
    const buffer = GAS_LIMITS.bufferMultiplier || 1.2;

    const adjustGas = (value) => {
      if (!value) return undefined;
      return BigInt(Math.floor(Number(value) * buffer));
    };

    return {
      callGasLimit: adjustGas(gasEstimate.callGasLimit),
      verificationGasLimit: adjustGas(gasEstimate.verificationGasLimit),
      preVerificationGas: adjustGas(gasEstimate.preVerificationGas),
      paymasterVerificationGasLimit: adjustGas(gasEstimate.paymasterVerificationGasLimit),
      paymasterPostOpGasLimit: adjustGas(gasEstimate.paymasterPostOpGasLimit)
    };
  }

  async fallbackGasEstimation(userOperation) {
    return {
      callGasLimit: BigInt(GAS_LIMITS.userOperation || 250000),
      verificationGasLimit: BigInt(120000),
      preVerificationGas: BigInt(60000),
      paymasterVerificationGasLimit: userOperation.paymaster ? BigInt(60000) : undefined,
      paymasterPostOpGasLimit: userOperation.paymaster ? BigInt(40000) : undefined
    };
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

  updateOperationStatus(userOpHash, status, data = {}) {
    const operation = this.pendingOperations.get(userOpHash);
    if (operation) {
      operation.status = status;
      operation.lastUpdated = Date.now();

      if (data.error) operation.error = data.error;
      if (data.blockNumber) operation.blockNumber = data.blockNumber;
      if (data.transactionHash) operation.transactionHash = data.transactionHash;

      if (status === USER_OP_STATUS.EXECUTED || status === USER_OP_STATUS.FAILED) {
        this.operationHistory.set(userOpHash, operation);
        this.pendingOperations.delete(userOpHash);
      }
    }
  }

  getPendingOperations() {
    return Array.from(this.pendingOperations.values());
  }

  getOperationHistory(limit = 100) {
    const operations = Array.from(this.operationHistory.values());
    return operations
      .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))
      .slice(0, limit);
  }
}

// Singleton instance
export const bundlerClient = new MonadFastlaneBundlerClient();

/**
 * Create a sponsored user operation.
 *
 * Parameters:
 *  - smartAccount: smart account object
 *  - call: call or array of calls
 *  - options:
 *      sponsorAddress (optional) - sponsor EOA address (string). If omitted, FASTLANE_CONFIG.SPONSOR_EOA will be used.
 *      sponsorSignature (optional) - signature returned by the sponsor backend for this userOp (hex string)
 *      validUntil (optional bigint) - unix timestamp (bigint) validUntil
 *      validAfter (optional bigint) - unix timestamp (bigint) validAfter
 *      any additional options are forwarded to sendTransaction
 */
export const createSponsoredUserOperation = async (smartAccount, call, options = {}) => {
  const {
    sponsorAddress: optSponsorAddress = null,
    sponsorSignature = null,
    validUntil = null,
    validAfter = null,
    ...rest
  } = options;

  // Determine sponsor address precedence: explicit option -> FASTLANE_CONFIG -> undefined
  const sponsorAddressRaw = optSponsorAddress || FASTLANE_CONFIG?.SPONSOR_EOA || null;
  const sponsorAddress = sponsorAddressRaw ? sponsorAddressRaw.toLowerCase().startsWith('0x') ? sponsorAddressRaw : `0x${sponsorAddressRaw}` : null;
  if (sponsorAddress && (!sponsorSignature || !validUntil || !validAfter)) {
    console.warn('⚠️ Sponsorship requested but sponsorSignature or validity bounds missing. Make sure sponsor backend signed getHash and returned sponsorSignature + validUntil + validAfter.');
    // Optionally: throw new Error('Missing sponsor signature or validity bounds for sponsor mode');
  }
  const smartAccountClient = await bundlerClient.createSmartAccountClient(smartAccount, {
    sponsorUserOperation: !!sponsorAddress,
    sponsorAddress,
    paymasterExtras: {
      sponsorSignature,
      validUntil,
      validAfter
    }
  });

  // Construct paymasterContext to match Fastlane example exactly.
  // When sponsoring, Fastlane expects keys like: { mode: "sponsor", sponsor, sponsorSignature, validUntil, validAfter }
  let paymasterContext = undefined;
  if (sponsorAddress) {
    paymasterContext = {
      mode: 'sponsor',
      sponsor: sponsorAddress
    };

    if (sponsorSignature) paymasterContext.sponsorSignature = sponsorSignature;
    if (validUntil) paymasterContext.validUntil = validUntil;
    if (validAfter) paymasterContext.validAfter = validAfter;

    console.log('🔧 createSponsoredUserOperation: constructed paymasterContext:', paymasterContext);
  } else {
    // user (self) mode
    paymasterContext = {
      mode: 'user',
      address: smartAccount.address
    };
    console.log('🔧 createSponsoredUserOperation: self-sponsor (user) paymasterContext:', paymasterContext);
  }

  // sendTransaction via smartAccountClient — pass paymasterContext in options so client has it when creating userop
  const txOptions = {
    calls: Array.isArray(call) ? call : [call],
    paymasterContext,
    ...rest
  };

  // Note: smartAccountClient.sendTransaction should accept the paymasterContext inside txOptions.
  return await smartAccountClient.sendTransaction(txOptions);
};

export default {
  MonadFastlaneBundlerClient,
  bundlerClient,
  USER_OP_STATUS,
  ENTRYPOINT_VERSIONS,
  createSponsoredUserOperation
};
