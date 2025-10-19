import { encodeFunctionData, parseAbi, formatUnits, parseUnits } from 'viem';
import { monadClient } from '../monad/monadClient.js';
import { bundlerClient } from './bundlerClient.js';
import { CONTRACTS, ALCHEMY_CONFIG } from '../../utils/constants.js';
import { validateAddress, validateTokenAmount } from '../../utils/validators.js';

// Execution status
export const EXECUTION_STATUS = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  REVERTED: 'reverted'
};

// Operation types
export const OPERATION_TYPES = {
  TOKEN_TRANSFER: 'token_transfer',
  TOKEN_APPROVAL: 'token_approval',
  UNISWAP_SWAP: 'uniswap_swap',
  BATCH_OPERATIONS: 'batch_operations'
};

/**
 * ✅ SIMPLIFIED UserOperations Service
 * Following the guide - let Alchemy handle everything!
 */
class UserOperationsService {
  constructor() {
    this.activeOperations = new Map();
    this.operationHistory = [];
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await monadClient.initialize();
      await bundlerClient.healthCheck();
      this.initialized = true;
      console.log('✅ UserOperations service initialized');
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

      return {
        account,
        calls: [call],
        operationType: OPERATION_TYPES.TOKEN_TRANSFER,
        gasOptions
      };
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

      return {
        account,
        calls: [call],
        operationType: OPERATION_TYPES.TOKEN_APPROVAL,
        gasOptions
      };
    } catch (error) {
      console.error('Failed to create token approval:', error);
      throw new Error(`Token approval creation failed: ${error.message}`);
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

    return {
      account,
      calls,
      operationType,
      gasOptions
    };
  }

  /**
   * ✅ SIMPLIFIED Execute - Just use bundlerClient + paymasterClient!
   */
  async executeUserOperation(userOp, options = {}) {
    const { timeout = 60000, waitForConfirmation = true } = options;
    const operationId = this.generateOperationId();
    
    try {
      // Extract account and calls
      const account = userOp.account || userOp.smartAccount?.account;
      const calls = userOp.calls || [];

      if (!account) {
        throw new Error('Invalid UserOperation format - missing account');
      }

      console.log('🔍 Executing UserOperation:', {
        operationId,
        accountAddress: account.address,
        callsCount: calls.length
      });

      this.trackOperation(operationId, userOp, EXECUTION_STATUS.PENDING);
      console.log(`⚡ Executing UserOperation ${operationId}...`);

      // ✅ Import clients
      const { createBundlerClient, createPaymasterClient } = await import('viem/account-abstraction');
      const { http, createPublicClient } = await import('viem');
      const { monadTestnet } = await import('../monad/monadClient.js');

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

      console.log('🚀 Sending UserOperation with Alchemy Gas Manager...');

      // ✅ THIS IS THE KEY - Just like the guide!
      const userOpHash = await bundlerClient.sendUserOperation({
        account: account,
        calls: calls,
        paymaster: paymasterClient,
        paymasterContext: {
          policyId: ALCHEMY_CONFIG.POLICY_ID,
        },
      });

      this.updateOperationStatus(operationId, EXECUTION_STATUS.SUBMITTED, {
        transactionHash: userOpHash
      });

      console.log(`✅ UserOperation submitted: ${userOpHash}`);

      if (!waitForConfirmation) {
        return {
          success: true,
          operationId,
          transactionHash: userOpHash,
          status: EXECUTION_STATUS.SUBMITTED
        };
      }

      // Wait for receipt
      const receipt = await Promise.race([
        bundlerClient.waitForUserOperationReceipt({ hash: userOpHash }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Operation timeout')), timeout)
        )
      ]);

      if (receipt.success) {
        this.updateOperationStatus(operationId, EXECUTION_STATUS.CONFIRMED, { receipt });
        console.log(`✅ UserOperation confirmed: ${userOpHash}`);
        
        return {
          success: true,
          operationId,
          transactionHash: receipt.receipt.transactionHash,
          receipt,
          status: EXECUTION_STATUS.CONFIRMED,
          gasUsed: receipt.receipt.gasUsed,
          txHash: receipt.receipt.transactionHash
        };
      } else {
        this.updateOperationStatus(operationId, EXECUTION_STATUS.REVERTED, { receipt });
        throw new Error(`UserOperation reverted`);
      }
    } catch (error) {
      console.error(`❌ UserOperation ${operationId} failed:`, error);

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
   * Get operation status
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

    if ([EXECUTION_STATUS.CONFIRMED, EXECUTION_STATUS.FAILED, EXECUTION_STATUS.REVERTED].includes(status)) {
      this.operationHistory.push(operation);
      this.activeOperations.delete(operationId);
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const checks = {
        initialized: this.initialized,
        monadClient: await monadClient.healthCheck(),
        alchemyBundler: await bundlerClient.healthCheck(),
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

/**
 * Helper function to send user operation
 */
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

// Create and export singleton
export const userOperationsService = new UserOperationsService();

// Export helper functions
export const createTokenTransfer = (params) => userOperationsService.createTokenTransfer(params);
export const createTokenApproval = (params) => userOperationsService.createTokenApproval(params);
export const createBatchOperation = (params) => userOperationsService.createBatchOperation(params);
export const executeUserOperation = (userOp, options) => userOperationsService.executeUserOperation(userOp, options);