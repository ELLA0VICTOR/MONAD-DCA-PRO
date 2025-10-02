import { 
  createSmartAccountClient,
  ENTRYPOINT_ADDRESS_V06,
  ENTRYPOINT_ADDRESS_V07
} from 'permissionless';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { createPublicClient, http, parseAbi, getAddress, maxUint256 } from 'viem';
import { entryPoint07Address } from 'viem/account-abstraction';
import { 
  MONAD_CONFIG, 
  CONTRACTS, 
  GAS_LIMITS, 
  ERROR_CODES 
} from '../../utils/constants.js';
import { monadTestnet } from '../monad/monadClient.js';
import { gasEstimator } from '../monad/gasEstimator.js';

// ===== PIMLICO CONFIGURATION FOR MONAD =====

/**
 * Get Pimlico URL for Monad testnet
 * Note: Replace with actual Monad chain ID when available
 */
const getPimlicoUrl = (apiKey) => {
  // For now using a placeholder chain ID - update when Monad's actual chain ID is confirmed
  const monadChainId = monadTestnet.id || 'monad-testnet'; 
  return `https://api.pimlico.io/v2/10143/rpc?apikey=${apiKey}`;
};

/**
 * User Operation status states
 */
export const USER_OP_STATUS = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  INCLUDED: 'included',
  EXECUTED: 'executed',
  FAILED: 'failed',
  REJECTED: 'rejected'
};

/**
 * EntryPoint versions supported
 */
export const ENTRYPOINT_VERSIONS = {
  V06: 'v0.6',
  V07: 'v0.7'
};

// ===== PIMLICO BUNDLER CLIENT CLASS =====

/**
 * Pimlico-powered bundler client for Monad testnet
 */
export class MonadPimlicoBundlerClient {
  constructor(options = {}) {
    const {
      apiKey = process.env.VITE_PIMLICO_API_KEY,
      entryPointVersion = ENTRYPOINT_VERSIONS.V07,
      timeout = 30000,
      pollingInterval = 1000
    } = options;
    
    if (!apiKey) {
      throw new Error('Pimlico API key is required');
    }
    
    this.apiKey = apiKey;
    this.entryPointVersion = entryPointVersion;
    this.timeout = timeout;
    this.pollingInterval = pollingInterval;
    
    // Set up URLs
    this.pimlicoUrl = getPimlicoUrl(apiKey);
    
    // Initialize clients
    this.publicClient = null;
    this.pimlicoClient = null;
    this.entryPoint = this.getEntryPointConfig(entryPointVersion);
    
    // Operation tracking
    this.pendingOperations = new Map();
    this.operationHistory = new Map();
    
    // Initialize clients
    this.initializeClients();
  }
  
  /**
   * Initialize Pimlico and public clients
   */
  initializeClients() {
    try {
      // Create public client for blockchain queries
      this.publicClient = createPublicClient({
        chain: monadTestnet,
        transport: http(monadTestnet.rpcUrls.default.http[0]) // Use default RPC for public queries
      });
      
      // Create Pimlico client (handles both bundler and paymaster)
      this.pimlicoClient = createPimlicoClient({
        transport: http(this.pimlicoUrl, {
          timeout: this.timeout
        }),
        entryPoint: this.entryPoint
      });
      
      console.log(`Pimlico client initialized for Monad with EntryPoint ${this.entryPointVersion}`);
      
    } catch (error) {
      console.error('Failed to initialize Pimlico clients:', error);
      throw new Error(`Pimlico client initialization failed: ${error.message}`);
    }
  }
  
  /**
   * Get EntryPoint configuration for version
   * @param {string} version - EntryPoint version
   * @returns {object} EntryPoint configuration
   */
  getEntryPointConfig(version) {
    switch (version) {
      case ENTRYPOINT_VERSIONS.V07:
        return {
          address: entryPoint07Address,
          version: "0.7"
        };
      case ENTRYPOINT_VERSIONS.V06:
        return {
          address: ENTRYPOINT_ADDRESS_V06,
          version: "0.6"
        };
      default:
        return {
          address: entryPoint07Address,
          version: "0.7"
        };
    }
  }
  
  /**
   * Create smart account client with Pimlico integration
   * @param {object} account - Smart account instance
   * @param {object} options - Additional options
   * @returns {object} Smart account client
   */
  createSmartAccountClient(account, options = {}) {
    const { sponsorUserOperation = true } = options;
    
    const clientConfig = {
      account,
      chain: monadTestnet,
      bundlerTransport: http(this.pimlicoUrl),
      userOperation: {
        estimateFeesPerGas: async () => {
          return (await this.pimlicoClient.getUserOperationGasPrice()).fast;
        },
      },
    };
    
    // Add paymaster support if requested
    if (sponsorUserOperation) {
      clientConfig.paymaster = this.pimlicoClient;
    }
    
    return createSmartAccountClient(clientConfig);
  }
  
  /**
   * Estimate gas for user operation using Pimlico
   * @param {object} userOperation - User operation parameters
   * @param {object} options - Additional options
   * @returns {Promise<object>} Gas estimates
   */
  async estimateUserOperationGas(userOperation, options = {}) {
    if (!userOperation) {
      throw new Error('User operation is required');
    }
    
    try {
      // Validate user operation structure
      this.validateUserOperation(userOperation);
      
      // Use Pimlico to estimate gas
      const gasEstimate = await this.pimlicoClient.estimateUserOperationGas({
        userOperation,
        entryPoint: this.entryPoint.address
      });
      
      // Apply Monad-specific adjustments
      const monadAdjustedGas = this.adjustGasForMonad(gasEstimate);
      
      return {
        ...monadAdjustedGas,
        original: gasEstimate,
        monadSpecific: {
          chargesGasLimit: true,
          baseFee: MONAD_CONFIG.baseFee.toString(),
          adjustmentApplied: true
        }
      };
      
    } catch (error) {
      // Fallback to local gas estimation
      console.warn('Pimlico gas estimation failed, using fallback:', error.message);
      return await this.fallbackGasEstimation(userOperation);
    }
  }
  
  /**
   * Submit user operation via Pimlico bundler
   * @param {object} userOperation - Complete user operation
   * @param {object} options - Submission options
   * @returns {Promise<string>} User operation hash
   */
  async sendUserOperation(userOperation, options = {}) {
    if (!userOperation) {
      throw new Error('User operation is required');
    }
    
    try {
      // Validate user operation
      this.validateUserOperation(userOperation);
      
      // Submit via Pimlico bundler
      const userOpHash = await this.pimlicoClient.sendUserOperation({
        userOperation,
        entryPoint: this.entryPoint.address
      });
      
      // Track the operation
      this.trackUserOperation(userOpHash, userOperation);
      
      console.log(`User operation submitted via Pimlico: ${userOpHash}`);
      return userOpHash;
      
    } catch (error) {
      throw new Error(`User operation submission failed: ${error.message}`);
    }
  }
  
  /**
   * Wait for user operation receipt via Pimlico
   * @param {string} userOpHash - User operation hash
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<object>} User operation receipt
   */
  async waitForUserOperationReceipt(userOpHash, timeout = this.timeout) {
    if (!userOpHash) {
      throw new Error('User operation hash is required');
    }
    
    try {
      // Use Pimlico's receipt polling
      const receipt = await this.pimlicoClient.waitForUserOperationReceipt({
        hash: userOpHash,
        timeout,
        pollingInterval: this.pollingInterval
      });
      
      // Update operation tracking
      this.updateOperationStatus(userOpHash, USER_OP_STATUS.EXECUTED, receipt);
      
      // Enhance receipt with Monad-specific information
      const enhancedReceipt = {
        ...receipt,
        network: 'monad-testnet',
        blockTime: MONAD_CONFIG.blockTime,
        gasChargedAsLimit: true,
        monadSpecific: {
          baseFee: MONAD_CONFIG.baseFee.toString(),
          chargesGasLimit: true,
          fastFinality: receipt.blockNumber ? 'speculative' : 'full'
        }
      };
      
      return enhancedReceipt;
      
    } catch (error) {
      // Update operation status on failure
      this.updateOperationStatus(userOpHash, USER_OP_STATUS.FAILED, { error: error.message });
      
      if (error.message.includes('timeout')) {
        throw new Error(`${ERROR_CODES.TIMEOUT_ERROR}: User operation confirmation timeout`);
      }
      
      throw new Error(`Failed to get user operation receipt: ${error.message}`);
    }
  }
  
  /**
   * Get user operation status via Pimlico
   * @param {string} userOpHash - User operation hash
   * @returns {Promise<object>} Operation status
   */
  async getUserOperationStatus(userOpHash) {
    if (!userOpHash) {
      throw new Error('User operation hash is required');
    }
    
    try {
      // Check local tracking first
      const localStatus = this.pendingOperations.get(userOpHash);
      
      // Try to get receipt from Pimlico
      let receipt = null;
      try {
        receipt = await this.pimlicoClient.getUserOperationReceipt({ 
          hash: userOpHash 
        });
      } catch (error) {
        // Receipt not available yet
      }
      
      if (receipt) {
        const status = receipt.success ? USER_OP_STATUS.EXECUTED : USER_OP_STATUS.FAILED;
        this.updateOperationStatus(userOpHash, status, receipt);
        
        return {
          hash: userOpHash,
          status,
          receipt,
          submittedAt: localStatus?.submittedAt,
          executedAt: Date.now()
        };
      }
      
      // Return pending status
      return {
        hash: userOpHash,
        status: localStatus?.status || USER_OP_STATUS.PENDING,
        submittedAt: localStatus?.submittedAt,
        userOperation: localStatus?.userOperation
      };
      
    } catch (error) {
      throw new Error(`Failed to get user operation status: ${error.message}`);
    }
  }
  
  /**
   * Get gas price from Pimlico
   * @returns {Promise<object>} Gas price data
   */
  async getUserOperationGasPrice() {
    try {
      return await this.pimlicoClient.getUserOperationGasPrice();
    } catch (error) {
      // Fallback to Monad defaults
      return {
        slow: {
          maxFeePerGas: MONAD_CONFIG.baseFee * 15n / 10n, // 1.5x
          maxPriorityFeePerGas: MONAD_CONFIG.baseFee / 20n // 5%
        },
        standard: {
          maxFeePerGas: MONAD_CONFIG.baseFee * 2n, // 2x
          maxPriorityFeePerGas: MONAD_CONFIG.baseFee / 10n // 10%
        },
        fast: {
          maxFeePerGas: MONAD_CONFIG.baseFee * 3n, // 3x
          maxPriorityFeePerGas: MONAD_CONFIG.baseFee / 5n // 20%
        }
      };
    }
  }
  
  /**
   * Get Pimlico paymaster data for ERC-20 payments
   * @param {string} token - Token address for payment
   * @returns {Promise<object|null>} Paymaster data or null
   */
  async getTokenQuotes(tokens) {
    try {
      return await this.pimlicoClient.getTokenQuotes({ tokens });
    } catch (error) {
      console.warn('Token quotes request failed:', error.message);
      return null;
    }
  }
  
  /**
   * Validate user operation structure
   * @param {object} userOperation - User operation to validate
   * @throws {Error} If validation fails
   */
  validateUserOperation(userOperation) {
    const requiredFields = [
      'sender',
      'nonce',
      'callData'
    ];
    
    for (const field of requiredFields) {
      if (!userOperation[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    // Validate addresses
    if (userOperation.sender && !userOperation.sender.match(/^0x[a-fA-F0-9]{40}$/)) {
      throw new Error('Invalid sender address format');
    }
    
    if (userOperation.paymasterAndData && !userOperation.paymasterAndData.startsWith("0x")) {
      throw new Error('Invalid paymaster address format');
    }
  }
  
  /**
   * Adjust gas estimates for Monad network specifics
   * @param {object} gasEstimate - Original gas estimate
   * @returns {object} Monad-adjusted gas estimate
   */
  adjustGasForMonad(gasEstimate) {
    // Apply buffer for Monad's gas_limit charging
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
  
  /**
   * Fallback gas estimation
   * @param {object} userOperation - User operation
   * @returns {Promise<object>} Gas estimate
   */
  async fallbackGasEstimation(userOperation) {
    // Use static values as ultimate fallback
    return {
      callGasLimit: BigInt(GAS_LIMITS.userOperation || 200000),
      verificationGasLimit: BigInt(100000),
      preVerificationGas: BigInt(21000),
      paymasterVerificationGasLimit: userOperation.paymaster ? BigInt(50000) : undefined,
      paymasterPostOpGasLimit: userOperation.paymaster ? BigInt(30000) : undefined
    };
  }
  
  /**
   * Track user operation
   * @param {string} userOpHash - User operation hash
   * @param {object} userOperation - User operation data
   */
  trackUserOperation(userOpHash, userOperation) {
    this.pendingOperations.set(userOpHash, {
      hash: userOpHash,
      userOperation,
      status: USER_OP_STATUS.SUBMITTED,
      submittedAt: Date.now()
    });
    
    // Auto-cleanup after 1 hour
    setTimeout(() => {
      this.pendingOperations.delete(userOpHash);
    }, 3600000);
  }
  
  /**
   * Update operation status
   * @param {string} userOpHash - User operation hash
   * @param {string} status - New status
   * @param {object} data - Additional data
   */
  updateOperationStatus(userOpHash, status, data = {}) {
    const operation = this.pendingOperations.get(userOpHash);
    if (operation) {
      operation.status = status;
      operation.lastUpdated = Date.now();
      
      if (data.error) operation.error = data.error;
      if (data.blockNumber) operation.blockNumber = data.blockNumber;
      if (data.transactionHash) operation.transactionHash = data.transactionHash;
      
      // Move to history if completed
      if (status === USER_OP_STATUS.EXECUTED || status === USER_OP_STATUS.FAILED) {
        this.operationHistory.set(userOpHash, operation);
        this.pendingOperations.delete(userOpHash);
      }
    }
  }
  
  /**
   * Get all pending operations
   * @returns {object[]} Array of pending operations
   */
  getPendingOperations() {
    return Array.from(this.pendingOperations.values());
  }
  
  /**
   * Get operation history
   * @param {number} limit - Maximum number of operations to return
   * @returns {object[]} Array of completed operations
   */
  getOperationHistory(limit = 100) {
    const operations = Array.from(this.operationHistory.values());
    return operations
      .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))
      .slice(0, limit);
  }
  
  /**
   * Health check for Pimlico service
   * @returns {Promise<boolean>} True if healthy
   */
  async healthCheck() {
    try {
      await this.getUserOperationGasPrice();
      return true;
    } catch (error) {
      console.warn('Pimlico health check failed:', error.message);
      return false;
    }
  }
}

// ===== SINGLETON INSTANCE =====

/**
 * Default Pimlico bundler client instance
 */
export const bundlerClient = new MonadPimlicoBundlerClient();

// ===== UTILITY FUNCTIONS =====

/**
 * Create sponsored user operation (gasless)
 * @param {object} smartAccount - Smart account instance  
 * @param {object} call - Call parameters
 * @param {object} options - Additional options
 * @returns {object} User operation with paymaster
 */
export const createSponsoredUserOperation = async (smartAccount, call, options = {}) => {
  const smartAccountClient = bundlerClient.createSmartAccountClient(smartAccount, {
    sponsorUserOperation: true
  });
  
  return await smartAccountClient.sendTransaction({
    calls: Array.isArray(call) ? call : [call],
    ...options
  });
};

/**
 * Create ERC-20 sponsored user operation
 * @param {object} smartAccount - Smart account instance
 * @param {object} call - Call parameters  
 * @param {string} paymentToken - Token address for gas payment
 * @param {object} options - Additional options
 * @returns {object} User operation with ERC-20 paymaster
 */
export const createERC20SponsoredUserOperation = async (smartAccount, call, paymentToken, options = {}) => {
  const smartAccountClient = bundlerClient.createSmartAccountClient(smartAccount);
  
  // Get token quotes for paymaster
  const quotes = await bundlerClient.getTokenQuotes([paymentToken]);
  if (!quotes || quotes.length === 0) {
    throw new Error(`No paymaster available for token: ${paymentToken}`);
  }
  
  const paymaster = quotes[0].paymaster;
  
  // Prepare calls with token approval

  const amountToApprove = quotes[0]?.maxCost || maxUint256;
  const calls = [
    {
      to: getAddress(paymentToken),
      abi: parseAbi(["function approve(address,uint256)"]),
      functionName: "approve",
      args: [paymaster, amountToApprove],
    },
    ...(Array.isArray(call) ? call : [call])
  ];
  
  return await smartAccountClient.sendTransaction({
    calls,
    paymasterContext: {
      token: paymentToken,
    },
    ...options
  });
};

// ===== EXPORTS =====
export default {
  MonadPimlicoBundlerClient,
  bundlerClient,
  USER_OP_STATUS,
  ENTRYPOINT_VERSIONS,
  createSponsoredUserOperation,
  createERC20SponsoredUserOperation
};