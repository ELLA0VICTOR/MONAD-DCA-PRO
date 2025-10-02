import { encodeFunctionData, parseAbi, formatUnits, parseUnits } from 'viem';
import { monadClient } from '../monad/monadClient.js';
import { gasEstimator } from '../monad/gasEstimator.js';
import { bundlerClient } from './bundlerClient.js';
import { smartAccountFactory } from './accountFactory.js';
import { CONTRACTS, GAS_LIMITS, MONAD_CONFIG, SMART_ACCOUNT_CONFIG } from '../../utils/constants.js';
import { validateUserOperation, validateAddress, validateTokenAmount } from '../../utils/validators.js';
import { formatTokenAmount, formatGasInfo } from '../../utils/formatters.js';

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
 * UserOperations service for Smart Accounts on Monad via Pimlico
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
      // bundlerClient initializes itself in constructor
      await bundlerClient.healthCheck(); // Verify connection
      this.initialized = true;
      console.log('UserOperations service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize UserOperations service:', error);
      throw new Error(`UserOperations initialization failed: ${error.message}`);
    }
  }

  /**
   * Create a token transfer UserOperation
   */
  async createTokenTransfer(params) {
    const { account, to, token, amount, gasOptions = {} } = params;

    // Validate inputs
    validateAddress(account.address, 'Smart account address');
    validateAddress(to, 'Recipient address');
    validateAddress(token, 'Token contract address');
    validateTokenAmount(amount, 'Transfer amount');

    try {
      // Get token decimals for proper amount formatting
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

      const parsedAmount = parseUnits(amount, decimals);

      // Create the call object
      const call = {
        to: token,
        abi: tokenContract.abi,
        functionName: 'transfer',
        args: [to, parsedAmount]
      };

      // Create smart account client
      const smartAccountClient = bundlerClient.createSmartAccountClient(account, {
        sponsorUserOperation: false // User pays gas in MON
      });

      // Create UserOperation by sending transaction
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
    validateTokenAmount(amount, 'Approval amount');

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

      const parsedAmount = parseUnits(amount, decimals);

      const call = {
        to: token,
        abi: tokenContract.abi,
        functionName: 'approve',
        args: [spender, parsedAmount]
      };

      const smartAccountClient = bundlerClient.createSmartAccountClient(account, {
        sponsorUserOperation: false
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
    const { account, swapParams, gasOptions = {} } = params;
    
    validateAddress(account.address, 'Smart account address');
    
    try {
      const call = {
        to: CONTRACTS.SwapRouter02,
        abi: parseAbi([
          'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
        ]),
        functionName: 'exactInputSingle',
        args: [swapParams]
      };

      const smartAccountClient = bundlerClient.createSmartAccountClient(account, {
        sponsorUserOperation: false
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

    // Validate each call
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
        sponsorUserOperation: false
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
      // Get current gas prices from Pimlico
      const gasPrice = await bundlerClient.getUserOperationGasPrice();
      
      // Apply user preferences or use standard pricing
      const gasPricing = gasOptions.priorityLevel === 'fast' ? gasPrice.fast :
                        gasOptions.priorityLevel === 'slow' ? gasPrice.slow :
                        gasPrice.standard;

      // Prepare transaction options
      const txOptions = {
        maxFeePerGas: gasOptions.maxFeePerGas || gasPricing.maxFeePerGas,
        maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas || gasPricing.maxPriorityFeePerGas
      };

      // Calculate estimated cost for validation
      const estimatedCost = await this.calculateOperationCostEstimate(gasPricing);

      return {
        smartAccountClient,
        calls,
        txOptions,
        operationType,
        estimatedCost,
        timestamp: Date.now()
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
    const { timeout = 60000, retryOnFailure = true } = options;
    const operationId = this.generateOperationId();

    try {
      // Validate account balance if needed
      if (userOp.estimatedCost && !options.skipBalanceCheck) {
        await this.validateSufficientBalance(
          userOp.smartAccountClient.account.address, 
          userOp.estimatedCost
        );
      }

      // Track operation start
      this.trackOperation(operationId, userOp, EXECUTION_STATUS.PENDING);

      console.log(`Executing UserOperation ${operationId}...`);

      // Execute transaction via smart account client
      const txHash = await userOp.smartAccountClient.sendTransaction({
        calls: userOp.calls,
        ...userOp.txOptions
      });
      
      // Update tracking with transaction hash
      this.updateOperationStatus(operationId, EXECUTION_STATUS.SUBMITTED, { 
        transactionHash: txHash 
      });
      
      console.log(`UserOperation submitted with tx hash: ${txHash}`);

      // Wait for transaction confirmation
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
        console.log(`UserOperation confirmed: ${txHash}`);
        return { 
          operationId, 
          transactionHash: txHash, 
          receipt, 
          status: EXECUTION_STATUS.CONFIRMED 
        };
      } else {
        this.updateOperationStatus(operationId, EXECUTION_STATUS.REVERTED, { receipt });
        throw new Error(`UserOperation reverted in transaction: ${txHash}`);
      }

    } catch (error) {
      console.error(`UserOperation ${operationId} failed:`, error);
      
      // Handle retry logic
      if (retryOnFailure && this.shouldRetry(operationId, error)) {
        console.log(`Retrying UserOperation ${operationId}...`);
        return await this.retryUserOperation(operationId, userOp, options);
      }

      // Mark as failed
      const status = error.message.includes('timeout') ? EXECUTION_STATUS.TIMEOUT : EXECUTION_STATUS.FAILED;
      this.updateOperationStatus(operationId, status, { error: error.message });
      
      throw error;
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

    // Exponential backoff
    const delay = Math.pow(2, retryCount) * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Update retry count
    this.retryAttempts.set(operationId, retryCount + 1);

    try {
      // Get fresh gas prices
      const newGasPrice = await bundlerClient.getUserOperationGasPrice();
      
      // Update gas parameters with higher prices for retry
      const updatedUserOp = {
        ...userOp,
        txOptions: {
          ...userOp.txOptions,
          maxFeePerGas: newGasPrice.fast.maxFeePerGas, // Use fast pricing for retries
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
    // Use conservative gas limit estimates
    let estimatedGasLimit;
    try{
      estimatedGasLimit = await gasEstimator.estimateGasLimit?.() || BigInt(300000);
    } catch{
      estimatedGasLimit = BigInt(300000);
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
      const balance = await monadClient.getBalance(accountAddress);
      const requiredBalance = BigInt(operationCost.totalCostWei);

      if (balance < requiredBalance) {
        throw new Error(
          `Insufficient balance. Required: ${formatTokenAmount(requiredBalance, 18)} MON (${requiredBalance} wei), ` +
          `Available: ${formatTokenAmount(balance, 18)} MON (${balance} wei)`
        );
      }

      return true;
    } catch (error) {
      console.error('Balance validation failed:', error);
      throw error;
    }
  }

  /**
   * Create a simple direct transaction (bypassing UserOperation flow)
   * For cases where ERC-4337 isn't needed
   */
  async executeDirectTransaction(params) {
    const { account, call, gasOptions = {} } = params;
    
    try {
      const smartAccountClient = bundlerClient.createSmartAccountClient(account, {
        sponsorUserOperation: false
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

    // Move completed operations to history
    if ([EXECUTION_STATUS.CONFIRMED, EXECUTION_STATUS.FAILED, EXECUTION_STATUS.REVERTED, EXECUTION_STATUS.TIMEOUT].includes(status)) {
      this.operationHistory.push(operation);
      this.activeOperations.delete(operationId);
      this.retryAttempts.delete(operationId);
    }
  }

  shouldRetry(operationId, error) {
    // Don't retry user errors or invalid operations
    const nonRetryableErrors = [
      'insufficient balance',
      'invalid signature',
      'invalid nonce',
      'execution reverted'
    ];

    const errorMessage = error.message.toLowerCase();
    return !nonRetryableErrors.some(nonRetryable => errorMessage.includes(nonRetryable));
  }

  getOperationType(operationId) {
    const operation = this.activeOperations.get(operationId);
    return operation?.userOp?.operationType || OPERATION_TYPES.BATCH_OPERATIONS;
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
        bundlerClient: await bundlerClient.healthCheck(),
        gasEstimator: gasEstimator.initialized || true,
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

// Create and export singleton instance
export const userOperationsService = new UserOperationsService();

// Export helper functions
export const createTokenTransfer = (params) => userOperationsService.createTokenTransfer(params);
export const createTokenApproval = (params) => userOperationsService.createTokenApproval(params);
export const createUniswapSwap = (params) => userOperationsService.createUniswapSwap(params);
export const createBatchOperation = (params) => userOperationsService.createBatchOperation(params);
export const executeUserOperation = (userOp, options) => userOperationsService.executeUserOperation(userOp, options);
export const executeDirectTransaction = (params) => userOperationsService.executeDirectTransaction(params);