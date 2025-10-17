import { encodeFunctionData, parseAbi, formatUnits, parseUnits } from 'viem';
import { monadClient } from '../monad/monadClient.js';
import { gasEstimator } from '../monad/gasEstimator.js';
import { bundlerClient } from './bundlerClient.js';
import { CONTRACTS, GAS_LIMITS, MONAD_CONFIG } from '../../utils/constants.js';
import { validateUserOperation, validateAddress, validateTokenAmount } from '../../utils/validators.js';
import { formatTokenAmount } from '../../utils/formatters.js';
import { Await } from 'react-router-dom';
import { call } from 'viem/actions';

/**
 * Execution status for UserOperations
 */
export const EXECUTION_STATUS = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  REVERTED: 'reverted',
  TIMEOUT: 'timeout'
};

/**
 * Operation types for tracking and gas estimation
 */
export const OPERATION_TYPES = {
  TOKEN_TRANSFER: 'token_transfer',
  TOKEN_APPROVAL: 'token_approval',
  UNISWAP_SWAP: 'uniswap_swap',
  DCA_EXECUTION: 'dca_execution',
  DELEGATION_CREATION: 'delegation_creation',
  DELEGATION_REDEMPTION: 'delegation_redemption',
  BATCH_OPERATIONS: 'batch_operations'
};

/**
 * UserOperations service for Smart Accounts on Monad via Fastlane shBundler
 * Handles creation, execution, and monitoring of ERC-4337 operations
 */
class UserOperationsService {
  constructor() {
    this.activeOperations = new Map();
    this.operationHistory = [];
    this.retryAttempts = new Map();
    this.maxRetries = 3;
    this.initialized = false;
  }

  /**
   * Initialize the service with required clients
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await monadClient.initialize();
      await bundlerClient.healthCheck();
      this.initialized = true;
      console.log('✅ UserOperations service initialized with Fastlane shBundler');
    } catch (error) {
      console.error('❌ Failed to initialize UserOperations service:', error);
      throw new Error(`UserOperations initialization failed: ${error.message}`);
    }
  }

  /**
   * Create a token transfer UserOperation
   */
  async createTokenTransfer(params) {
    const { account, to, token, amount, gasOptions = {} } = params;

    validateAddress(account.address, 'Smart account address');
    validateAddress(to, 'Recipient address');
    validateAddress(token, 'Token contract address');
    validateTokenAmount(amount, 'Transfer amount');

    try {
      const tokenContract = {
        address: token,
        abi: parseAbi([
          'function decimals() view returns (uint8)',
          'function transfer(address to, uint256 amount) returns (bool)'
        ])
      };

      const decimals = await bundlerClient.publicClient.readContract({
        ...tokenContract,
        functionName: 'decimals'
      });

      const parsedAmount = parseUnits(amount.toString(), decimals);

      const call = {
        to: token,
        abi: tokenContract.abi,
        functionName: 'transfer',
        args: [to, parsedAmount]
      };

      const smartAccountClient = bundlerClient.createSmartAccountClient(account, {
        sponsorUserOperation: true // ✅ Fastlane shMonad sponsorship
      });

      const userOp = await this.createUserOperationFromCalls({
        smartAccountClient,
        calls: [call],
        operationType: OPERATION_TYPES.TOKEN_TRANSFER,
        gasOptions
      });

      return userOp;
    } catch (error) {
      console.error('Failed to create token transfer:', error);
      throw new Error(`Token transfer creation failed: ${error.message}`);
    }
  }

  /**
   * Create a token approval UserOperation
   */
  async createTokenApproval(params) {
    const { account, token, spender, amount, gasOptions = {} } = params;

    validateAddress(account.address, 'Smart account address');
    validateAddress(token, 'Token contract address');
    validateAddress(spender, 'Spender address');

    try {
      const tokenContract = {
        address: token,
        abi: parseAbi([
          'function decimals() view returns (uint8)',
          'function approve(address spender, uint256 amount) returns (bool)'
        ])
      };

      const decimals = await bundlerClient.publicClient.readContract({
        ...tokenContract,
        functionName: 'decimals'
      });

      const parsedAmount = typeof amount === 'bigint' ? amount : parseUnits(amount.toString(), decimals);

      const call = {
        to: token,
        abi: tokenContract.abi,
        functionName: 'approve',
        args: [spender, parsedAmount]
      };

      const smartAccountClient = bundlerClient.createSmartAccountClient(account, {
        sponsorUserOperation: true // ✅ Fastlane shMonad sponsorship
      });

      const userOp = await this.createUserOperationFromCalls({
        smartAccountClient,
        calls: [call],
        operationType: OPERATION_TYPES.TOKEN_APPROVAL,
        gasOptions
      });

      return userOp;
    } catch (error) {
      console.error('Failed to create token approval:', error);
      throw new Error(`Token approval creation failed: ${error.message}`);
    }
  }

  /**
   * Create a Uniswap swap UserOperation
   */
  async createUniswapSwap(params) {
    const {
      account,
      tokenIn,
      tokenOut,
      amountIn,
      amountOutMinimum,
      recipient,
      deadline,
      gasOptions = {}
    } = params;
  
    validateAddress(account.address, 'Smart account address');
    validateAddress(tokenIn, 'Token in address');
    validateAddress(tokenOut, 'Token out address');
  
    try {
      const fee = 3000;
  
      const swapParams = {
        tokenIn,
        tokenOut,
        fee: Number(fee),
        recipient: recipient || account.address,
        deadline: typeof deadline === 'bigint' ? deadline : BigInt(deadline || Math.floor(Date.now() / 1000) + 300),
        amountIn: typeof amountIn === 'bigint' ? amountIn : BigInt(amountIn),
        amountOutMinimum: typeof amountOutMinimum === 'bigint' ? amountOutMinimum : BigInt(amountOutMinimum),
        sqrtPriceLimitX96: 0n
      };
  
      console.log('🔍 Swap params types:', {
        fee: typeof swapParams.fee,
        deadline: typeof swapParams.deadline,
        amountIn: typeof swapParams.amountIn,
        amountOutMinimum: typeof swapParams.amountOutMinimum
      });
  
      if (
        typeof swapParams.fee !== 'number' ||
        typeof swapParams.deadline !== 'bigint' ||
        typeof swapParams.amountIn !== 'bigint' ||
        typeof swapParams.amountOutMinimum !== 'bigint' ||
        typeof swapParams.tokenIn !== 'string' ||
        typeof swapParams.tokenOut !== 'string' ||
        typeof swapParams.recipient !== 'string'
      ) {
        throw new Error('Swap params have incorrect types');
      }
  
      const call = {
        to: CONTRACTS.SwapRouter02,
        abi: parseAbi([
          'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
        ]),
        functionName: 'exactInputSingle',
        args: [swapParams]
      };

      const smartAccountClient = bundlerClient.createSmartAccountClient(account, {
        sponsorUserOperation: true // ✅ Fastlane shMonad sponsorship
      });

      const userOp = await this.createUserOperationFromCalls({
        smartAccountClient,
        calls: [call],
        operationType: OPERATION_TYPES.UNISWAP_SWAP,
        gasOptions
      });

      return userOp;
    } catch (error) {
      console.error('Failed to create Uniswap swap:', error);
      throw new Error(`Uniswap swap creation failed: ${error.message}`);
    }
  }
  
  /**
   * Create a batch UserOperation for multiple calls
   */
  async createBatchOperation(params) {
    const { account, calls, operationType = OPERATION_TYPES.BATCH_OPERATIONS, gasOptions = {} } = params;

    validateAddress(account.address, 'Smart account address');
    
    if (!Array.isArray(calls) || calls.length === 0) {
      throw new Error('Calls must be a non-empty array');
    }

    calls.forEach((call, index) => {
      validateAddress(call.to, `Call ${index} target address`);
      if (call.data && typeof call.data !== 'string') {
        throw new Error(`Call ${index} data must be a hex string`);
      }
      if (call.value !== undefined && typeof call.value !== 'bigint') {
        throw new Error(`Call ${index} value must be a bigint`);
      }
    });

    try {
      const smartAccountClient = bundlerClient.createSmartAccountClient(account, {
        sponsorUserOperation: true // ✅ Fastlane shMonad sponsorship
      });

      const userOp = await this.createUserOperationFromCalls({
        smartAccountClient,
        calls,
        operationType,
        gasOptions
      });

      return userOp;
    } catch (error) {
      console.error('Failed to create batch operation:', error);
      throw new Error(`Batch operation creation failed: ${error.message}`);
    }
  }

  /**
   * Core UserOperation creation using smart account client
   */
  async createUserOperationFromCalls(params) {
    const { smartAccountClient, calls, operationType, gasOptions = {} } = params;
   

    try {
      const gasPrice = await bundlerClient.getUserOperationGasPrice();
  
      const gasPricing = gasOptions.priorityLevel === 'fast' ? gasPrice.fast :
                        gasOptions.priorityLevel === 'slow' ? gasPrice.slow :
                        gasPrice.standard;

      const txOptions = {
        maxFeePerGas: gasOptions.maxFeePerGas || gasPricing.maxFeePerGas,
        maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas || gasPricing.maxPriorityFeePerGas
      };
      // critical: estimate gas limits via bundlerClient
      const gasEstimate = await bundlerClient.estimateUserOperationGas({
        calls,
        account: smartAccountClient.account
      });

      const estimatedCost = await this.calculateOperationCostEstimate(gasPricing);

      return {
        smartAccountClient,
        calls,
        txOptions,
        operationType,
        estimatedCost,
        timestamp: Date.now(),
        callGasLimit: gasEstimate.callGasLimit,
        verificationGasLimit: gasEstimate.verificationGasLimit,
        preVerificationGas: gasEstimate.preVerificationGas,
        maxFeePerGas: txOptions.maxFeePerGas,
        maxPriorityFeePerGas: txOptions.maxPriorityFeePerGas,
      };

    } catch (error) {
      console.error('Failed to create UserOperation from calls:', error);
      throw new Error(`UserOperation creation failed: ${error.message}`);
    }
  }

  /**
   * Execute a UserOperation with retry logic and monitoring
   */
  async executeUserOperation(userOp, options = {}) {
    const { timeout = 60000, retryOnFailure = true, waitForConfirmation = true } = options;
    const operationId = this.generateOperationId();
    
    try {
      let smartAccountClient, calls, txOptions;
  
      if (userOp.smartAccountClient) {
        smartAccountClient = userOp.smartAccountClient;
        calls = userOp.calls;
        txOptions = userOp.txOptions || {};
      } else if (userOp.client && typeof userOp.client.sendTransaction === 'function') {
        smartAccountClient = userOp.client;
        calls = userOp.calls || [];
        txOptions = userOp.txOptions || {};
      } else if (userOp.account && typeof userOp.account.encodeCalls === 'function') {
        smartAccountClient = userOp;
        calls = userOp.calls || [];
        txOptions = userOp.txOptions || {};
      } else {
        throw new Error('Invalid UserOperation format - missing smartAccountClient, client, or account');
      }
  
      if (typeof smartAccountClient.sendTransaction !== 'function') {
        throw new Error('SmartAccountClient missing sendTransaction method');
      }
      if (!smartAccountClient.account) {
        throw new Error('SmartAccountClient missing account property');
      }
  
      console.log('🔍 Executing with Fastlane shBundler:', {
        hasClient: !!smartAccountClient,
        hasAccount: !!smartAccountClient.account,
        accountAddress: smartAccountClient.account?.address,
        callsCount: calls?.length
      });
  
      if (userOp.estimatedCost && !options.skipBalanceCheck) {
        await this.validateSufficientBalance(
          smartAccountClient.account.address,
          userOp.estimatedCost
        );
      }
  
      this.trackOperation(operationId, userOp, EXECUTION_STATUS.PENDING);
      console.log(`⚡ Executing UserOperation ${operationId} via Fastlane...`);
  
      const txHash = await smartAccountClient.sendTransaction({
        calls,
        ...txOptions
      });
  
      this.updateOperationStatus(operationId, EXECUTION_STATUS.SUBMITTED, {
        transactionHash: txHash
      });
  
      console.log(`✅ UserOperation submitted via Fastlane with tx hash: ${txHash}`);
  
      if (!waitForConfirmation) {
        return {
          success: true,
          operationId,
          transactionHash: txHash,
          status: EXECUTION_STATUS.SUBMITTED
        };
      }
  
      const receipt = await Promise.race([
        bundlerClient.publicClient.waitForTransactionReceipt({
          hash: txHash,
          timeout
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Operation timeout')), timeout)
        )
      ]);
  
      if (receipt.status === 'success') {
        this.updateOperationStatus(operationId, EXECUTION_STATUS.CONFIRMED, { receipt });
        console.log(`✅ UserOperation confirmed via Fastlane: ${txHash}`);
        return {
          success: true,
          operationId,
          transactionHash: txHash,
          receipt,
          status: EXECUTION_STATUS.CONFIRMED,
          gasUsed: receipt.gasUsed,
          gasCost: receipt.gasUsed * (receipt.effectiveGasPrice || MONAD_CONFIG.baseFee),
          txHash
        };
      } else {
        this.updateOperationStatus(operationId, EXECUTION_STATUS.REVERTED, { receipt });
        throw new Error(`UserOperation reverted in transaction: ${txHash}`);
      }
    } catch (error) {
      console.error(`❌ UserOperation ${operationId} failed:`, error);
  
      if (retryOnFailure && this.shouldRetry(operationId, error)) {
        console.log(`🔄 Retrying UserOperation ${operationId} with Fastlane...`);
        return await this.retryUserOperation(operationId, userOp, options);
      }
  
      const status = error.message.includes('timeout') ? EXECUTION_STATUS.TIMEOUT : EXECUTION_STATUS.FAILED;
      this.updateOperationStatus(operationId, status, { error: error.message });
  
      return {
        success: false,
        error: error.message,
        operationId,
        status
      };
    }
  }
  
  /**
   * Retry failed UserOperation with exponential backoff
   */
  async retryUserOperation(operationId, userOp, options) {
    const retryCount = this.retryAttempts.get(operationId) || 0;
    
    if (retryCount >= this.maxRetries) {
      throw new Error(`Max retries (${this.maxRetries}) exceeded for operation ${operationId}`);
    }

    const delay = Math.pow(2, retryCount) * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));

    this.retryAttempts.set(operationId, retryCount + 1);

    try {
      const newGasPrice = await bundlerClient.getUserOperationGasPrice();
      
      const updatedUserOp = {
        ...userOp,
        txOptions: {
          ...userOp.txOptions,
          maxFeePerGas: newGasPrice.fast.maxFeePerGas,
          maxPriorityFeePerGas: newGasPrice.fast.maxPriorityFeePerGas
        }
      };

      return await this.executeUserOperation(updatedUserOp, options);

    } catch (error) {
      console.error(`Retry ${retryCount + 1} failed for operation ${operationId}:`, error);
      throw error;
    }
  }

  /**
   * Get operation status and details
   */
  getOperationStatus(operationId) {
    return this.activeOperations.get(operationId) || null;
  }

  /**
   * Get all active operations
   */
  getActiveOperations() {
    return Array.from(this.activeOperations.values());
  }

  /**
   * Get operation history
   */
  getOperationHistory(limit = 50) {
    return this.operationHistory
      .slice(-limit)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Calculate estimated cost of operation in MON
   */
  async calculateOperationCostEstimate(gasPrice) {
    let estimatedGasLimit = BigInt(GAS_LIMITS.userOperation || 300000);
    
    try {
      if (gasEstimator && gasEstimator.estimateGasLimit) {
        estimatedGasLimit = await gasEstimator.estimateGasLimit();
      }
    } catch (error) {
      console.warn('Gas estimation failed, using default:', error.message);
    }
    
    const totalCost = gasPrice.maxFeePerGas * estimatedGasLimit;
    
    return {
      gasLimit: estimatedGasLimit,
      gasPrice: gasPrice.maxFeePerGas,
      totalCostWei: totalCost,
      totalCostMON: formatUnits(totalCost, 18),
      breakdown: {
        estimated: true,
        maxFeePerGas: gasPrice.maxFeePerGas,
        maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas
      }
    };
  }

  /**
   * Check if account has sufficient balance for operation
   */
  async validateSufficientBalance(accountAddress, operationCost) {
    try {
      const balance = await monadClient.getBalance({ address: accountAddress });
      const requiredBalance = BigInt(operationCost.totalCostWei);

      if (balance < requiredBalance) {
        throw new Error(
          `Insufficient balance. Required: ${formatTokenAmount(requiredBalance, 18)} MON, ` +
          `Available: ${formatTokenAmount(balance, 18)} MON`
        );
      }

      return true;
    } catch (error) {
      console.error('Balance validation failed:', error);
      throw error;
    }
  }

  /**
   * Create a simple direct transaction
   */
  async executeDirectTransaction(params) {
    const { account, call, gasOptions = {} } = params;
    
    try {
      const smartAccountClient = bundlerClient.createSmartAccountClient(account, {
        sponsorUserOperation: true // ✅ Fastlane shMonad sponsorship
      });

      const gasPrice = await bundlerClient.getUserOperationGasPrice();
      
      const txHash = await smartAccountClient.sendTransaction({
        calls: [call],
        maxFeePerGas: gasOptions.maxFeePerGas || gasPrice.standard.maxFeePerGas,
        maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas || gasPrice.standard.maxPriorityFeePerGas
      });

      const receipt = await bundlerClient.publicClient.waitForTransactionReceipt({ 
        hash: txHash 
      });

      return { transactionHash: txHash, receipt };
    } catch (error) {
      console.error('Direct transaction failed:', error);
      throw error;
    }
  }

  // Private helper methods

  generateOperationId() {
    return `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  trackOperation(operationId, userOp, status) {
    const operation = {
      id: operationId,
      userOp,
      status,
      timestamp: Date.now(),
      history: [{ status, timestamp: Date.now() }]
    };

    this.activeOperations.set(operationId, operation);
  }

  updateOperationStatus(operationId, status, data = {}) {
    const operation = this.activeOperations.get(operationId);
    if (!operation) return;

    operation.status = status;
    operation.history.push({ status, timestamp: Date.now(), ...data });

    if ([EXECUTION_STATUS.CONFIRMED, EXECUTION_STATUS.FAILED, EXECUTION_STATUS.REVERTED, EXECUTION_STATUS.TIMEOUT].includes(status)) {
      this.operationHistory.push(operation);
      this.activeOperations.delete(operationId);
      this.retryAttempts.delete(operationId);
    }
  }

  shouldRetry(operationId, error) {
    const nonRetryableErrors = [
      'insufficient balance',
      'invalid signature',
      'invalid nonce',
      'execution reverted'
    ];

    const errorMessage = error.message.toLowerCase();
    return !nonRetryableErrors.some(nonRetryable => errorMessage.includes(nonRetryable));
  }

  /**
   * Cleanup old operations from history
   */
  cleanup(maxHistorySize = 1000) {
    if (this.operationHistory.length > maxHistorySize) {
      this.operationHistory = this.operationHistory.slice(-maxHistorySize);
    }
  }

  /**
   * Health check for the service
   */
  async healthCheck() {
    try {
      const checks = {
        initialized: this.initialized,
        monadClient: await monadClient.healthCheck(),
        fastlaneBundler: await bundlerClient.healthCheck(),
        activeOperations: this.activeOperations.size,
        historySize: this.operationHistory.length
      };

      const isHealthy = Object.values(checks).every(check => 
        typeof check === 'boolean' ? check : typeof check === 'number'
      );

      return { isHealthy, checks };
    } catch (error) {
      console.error('UserOperations health check failed:', error);
      return { isHealthy: false, error: error.message };
    }
  }
}

export async function sendUserOperation(account, calls, options = {}) {
  try {
    await userOperationsService.initialize();

    const userOp = await userOperationsService.createBatchOperation({
      account,
      calls,
      operationType: 'manual_execution',
      gasOptions: options.gasOptions || {},
    });

    const result = await userOperationsService.executeUserOperation(userOp, options);

    return result?.transactionHash || result;
  } catch (error) {
    console.error('sendUserOperation failed:', error);
    throw error;
  }
}

// Create and export singleton instance
export const userOperationsService = new UserOperationsService();

// Export helper functions
export const createTokenTransfer = (params) => userOperationsService.createTokenTransfer(params);
export const createTokenApproval = (params) => userOperationsService.createTokenApproval(params);
export const createUniswapSwap = (params) => userOperationsService.createUniswapSwap(params);
export const createBatchOperation = (params) => userOperationsService.createBatchOperation(params);
export const executeUserOperation = (userOp, options) => userOperationsService.executeUserOperation(userOp, options);
export const executeDirectTransaction = (params) => userOperationsService.executeDirectTransaction(params);