import { parseUnits, formatUnits } from 'viem';
import { monadClient } from '../monad/monadClient.js';
import { gasEstimator } from '../monad/gasEstimator.js';
import { delegationService } from '../delegation/delegationService.js';
import { delegationStorage } from '../delegation/delegationStorage.js';
import { userOperationsService } from '../smartAccount/userOperations.js';
import { swapExecutor } from './swapExecutor.js';
import { validateDCAStrategy, validateTokenAmount } from '../../utils/validators.js';
import { formatTokenAmount, formatDateTime } from '../../utils/formatters.js';
import { encryptAndStore, retrieveAndDecrypt } from '../../utils/encryption.js';
import { 
  DCA_CONFIG, 
  CONTRACTS, 
  SUPPORTED_TOKENS, 
  GAS_LIMITS,
  MONAD_CONFIG,
  SWAP_INTERVALS
} from '../../utils/constants.js';

function safeBase64Encode(str) {
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str, 'utf-8').toString('base64');
    } else if (typeof btoa !== 'undefined') {
      return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
    } else {
      throw new Error('No base64 encoder available');
    }
  } catch (e) {
    return `${Date.now()}${Math.floor(Math.random() * 1e9)}`;
  }
}

// DCA Strategy States
const STRATEGY_STATUS = {
  CREATED: 'created',
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  ERROR: 'error'
};

// DCA Execution States
const EXECUTION_STATUS = {
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
};

/**
 * DCA Engine Service
 * Manages DCA strategy lifecycle and automated execution (NO ORACLE/AI)
 */
class DCAEngineService {
  constructor() {
    this.strategies = new Map();
    this.activeExecutions = new Map();
    this.scheduledIntervals = new Map(); // Store interval IDs
    this.executionHistory = new Map();
    this.initialized = false;
  }

  /**
   * Initialize the DCA engine
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await this.loadStrategiesFromStorage();
      await swapExecutor.initialize();
      
      this.initialized = true;
      console.log('DCAEngineService initialized (No Oracle Mode) with', this.strategies.size, 'strategies');
      
      // Restart active strategies
      for (const [strategyId, strategy] of this.strategies.entries()) {
        if (strategy.state?.status === STRATEGY_STATUS.ACTIVE) {
          this.scheduleRecurringExecution(strategyId, strategy);
        }
      }
    } catch (error) {
      console.error('Failed to initialize DCAEngineService:', error);
      throw new Error(`DCA engine initialization failed: ${error.message}`);
    }
  }

  /**
   * Create a new DCA strategy
   */
  async createStrategy(strategyConfig, options = {}) {
    if (!this.initialized) {
      throw new Error('DCA engine not initialized');
    }

    const validation = validateDCAStrategy(strategyConfig);
    if (!validation.isValid) {
      throw new Error(`Invalid DCA strategy: ${validation.errors.join(', ')}`);
    }

    const {
      encryptStrategy = true,
      createDelegation = true,
      autoStart = true
    } = options;

    try {
      const strategyId = this.generateStrategyId(strategyConfig);
      const timestamp = Date.now();

      const strategy = {
        id: strategyId,
        config: {
          ...strategyConfig,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: '1.0'
        },
        state: {
          status: STRATEGY_STATUS.CREATED,
          totalExecutions: 0,
          successfulExecutions: 0,
          totalInvested: 0n,
          totalReceived: 0n,
          averagePrice: 0n,
          lastExecutionAt: null,
          nextExecutionAt: this.calculateNextExecution(strategyConfig),
          failureCount: 0,
          pauseReason: null
        },
        delegation: null,
        metadata: {
          createdBy: strategyConfig.smartAccount,
          encrypted: encryptStrategy,
          gasSpent: 0n,
          riskScore: this.calculateRiskScore(strategyConfig)
        }
      };

      // Create delegation if requested
      if (createDelegation) {
        const delegationResult = await this.createStrategyDelegation(strategy);
        if (!delegationResult.success) {
          throw new Error(`Failed to create delegation: ${delegationResult.error}`);
        }
        strategy.delegation = delegationResult.delegation;
      }

      // Store strategy
      if (encryptStrategy) {
        await this.encryptAndStoreStrategy(strategy);
      } else {
        this.strategies.set(strategyId, strategy);
      }

      // Start strategy if requested
      if (autoStart && createDelegation) {
        await this.startStrategy(strategyId);
      }

      console.log(`DCA strategy ${strategyId} created successfully`);
      
      return {
        success: true,
        strategyId,
        strategy: this.sanitizeStrategyForResponse(strategy),
        nextExecution: strategy.state.nextExecutionAt
      };

    } catch (error) {
      console.error('Failed to create DCA strategy:', error);
      throw new Error(`Strategy creation failed: ${error.message}`);
    }
  }

  /**
   * Start executing a DCA strategy
   */
  async startStrategy(strategyId, options = {}) {
    if (!this.initialized) {
      throw new Error('DCA engine not initialized');
    }

    const { validateBalance = true } = options;

    try {
      const strategy = await this.getStrategy(strategyId);
      if (!strategy) {
        throw new Error('Strategy not found');
      }

      if (strategy.state.status === STRATEGY_STATUS.ACTIVE) {
        throw new Error('Strategy already active');
      }

      if (strategy.state.status === STRATEGY_STATUS.COMPLETED) {
        throw new Error('Strategy already completed');
      }

      if (!strategy.delegation) {
        throw new Error('No delegation found for strategy');
      }

      const delegationResult = await delegationStorage.getDelegation(strategy.delegation.id);
      if (!delegationResult.success || delegationResult.delegation.metadata.status !== 'active') {
        throw new Error('Delegation not active or accessible');
      }

      if (validateBalance) {
        const balanceCheck = await this.validateStrategyBalance(strategy);
        if (!balanceCheck.sufficient) {
          throw new Error(`Insufficient balance: need ${balanceCheck.required}, have ${balanceCheck.available}`);
        }
      }

      // Update strategy status
      strategy.state.status = STRATEGY_STATUS.ACTIVE;
      strategy.state.updatedAt = Date.now();
      strategy.state.nextExecutionAt = this.calculateNextExecution(strategy.config);

      await this.saveStrategy(strategy);

      // Schedule execution based on interval type
      const intervalConfig = SWAP_INTERVALS[strategy.config.interval?.toUpperCase()];
      if (intervalConfig && intervalConfig.recurring) {
        this.scheduleRecurringExecution(strategyId, strategy);
      } else {
        // Immediate execution
        await this.executeSwap(strategyId);
      }

      console.log(`DCA strategy ${strategyId} started`);

      return {
        success: true,
        status: STRATEGY_STATUS.ACTIVE,
        nextExecution: strategy.state.nextExecutionAt
      };

    } catch (error) {
      console.error('Failed to start DCA strategy:', error);
      throw new Error(`Strategy start failed: ${error.message}`);
    }
  }

  /**
   * Schedule recurring execution using setInterval
   */
  scheduleRecurringExecution(strategyId, strategy) {
    // Clear existing interval if any
    this.cancelScheduledExecution(strategyId);

    const intervalConfig = SWAP_INTERVALS[strategy.config.interval?.toUpperCase()];
    if (!intervalConfig || !intervalConfig.recurring) {
      console.warn(`Invalid or non-recurring interval for strategy ${strategyId}`);
      return;
    }

    const intervalMs = intervalConfig.intervalMs;
    
    const intervalId = setInterval(async () => {
      try {
        const currentStrategy = await this.getStrategy(strategyId);
        if (!currentStrategy || currentStrategy.state.status !== STRATEGY_STATUS.ACTIVE) {
          this.cancelScheduledExecution(strategyId);
          return;
        }

        console.log(`Executing scheduled swap for strategy ${strategyId}`);
        await this.executeSwap(strategyId);
      } catch (error) {
        console.error(`Scheduled execution failed for strategy ${strategyId}:`, error);
      }
    }, intervalMs);

    this.scheduledIntervals.set(strategyId, intervalId);
    console.log(`Scheduled recurring execution for strategy ${strategyId} every ${intervalMs}ms`);
  }

  /**
   * Execute a single DCA swap (NO AI/ORACLE CHECKS)
   */
  async executeSwap(strategyId, options = {}) {
    if (!this.initialized) {
      throw new Error('DCA engine not initialized');
    }

    const { forceExecution = false, customAmount = null } = options;
    const executionId = `exec_${strategyId}_${Date.now()}`;
    
    try {
      const strategy = await this.getStrategy(strategyId);
      if (!strategy) {
        throw new Error('Strategy not found');
      }

      if (strategy.state.status !== STRATEGY_STATUS.ACTIVE && !forceExecution) {
        throw new Error(`Strategy not active: ${strategy.state.status}`);
      }

      const execution = {
        id: executionId,
        strategyId,
        status: EXECUTION_STATUS.EXECUTING,
        startedAt: Date.now(),
        completedAt: null,
        swapAmount: customAmount || this.calculateSwapAmount(strategy),
        expectedOutput: 0n,
        actualOutput: 0n,
        gasUsed: 0n,
        gasCost: 0n,
        slippage: 0,
        error: null,
        txHash: null,
        retryCount: 0
      };

      this.activeExecutions.set(executionId, execution);

      console.log(`Starting DCA execution ${executionId} for strategy ${strategyId}`);

      // Execute swap via delegation (simplified - no AI checks)
      const swapResult = await this.executeSwapViaDelegation(strategy, execution);
      
      if (swapResult.success) {
        execution.status = EXECUTION_STATUS.COMPLETED;
        execution.actualOutput = swapResult.outputAmount;
        execution.txHash = swapResult.txHash;
        execution.gasUsed = swapResult.gasUsed;
        execution.gasCost = swapResult.gasCost;
        execution.slippage = this.calculateActualSlippage(execution);

        await this.updateStrategyAfterExecution(strategy, execution);

        console.log(`DCA execution ${executionId} completed successfully`);
      } else {
        execution.status = EXECUTION_STATUS.FAILED;
        execution.error = swapResult.error;
        
        strategy.state.failureCount++;
        
        if (strategy.state.failureCount >= DCA_CONFIG.MAX_CONSECUTIVE_FAILURES) {
          strategy.state.status = STRATEGY_STATUS.PAUSED;
          strategy.state.pauseReason = 'too_many_failures';
          this.cancelScheduledExecution(strategyId);
          console.warn(`Strategy ${strategyId} paused due to repeated failures`);
        }

        await this.saveStrategy(strategy);
      }

      execution.completedAt = Date.now();
      await this.recordExecution(execution);

      return {
        success: execution.status === EXECUTION_STATUS.COMPLETED,
        execution,
        strategy: this.sanitizeStrategyForResponse(strategy)
      };

    } catch (error) {
      console.error(`DCA execution ${executionId} failed:`, error);
      
      const execution = this.activeExecutions.get(executionId) || {
        id: executionId,
        strategyId,
        status: EXECUTION_STATUS.FAILED,
        startedAt: Date.now(),
        error: error.message
      };
      
      execution.status = EXECUTION_STATUS.FAILED;
      execution.error = error.message;
      execution.completedAt = Date.now();
      
      await this.recordExecution(execution);

      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Pause a DCA strategy
   */
  async pauseStrategy(strategyId, reason = 'manual') {
    try {
      const strategy = await this.getStrategy(strategyId);
      if (!strategy) {
        throw new Error('Strategy not found');
      }

      strategy.state.status = STRATEGY_STATUS.PAUSED;
      strategy.state.pauseReason = reason;
      strategy.state.updatedAt = Date.now();

      await this.saveStrategy(strategy);

      // Cancel scheduled execution
      this.cancelScheduledExecution(strategyId);

      return {
        success: true,
        status: STRATEGY_STATUS.PAUSED,
        reason
      };
    } catch (error) {
      console.error('Failed to pause strategy:', error);
      throw error;
    }
  }

  /**
   * Cancel a DCA strategy
   */
  async cancelStrategy(strategyId, reason = 'user_cancelled') {
    try {
      const strategy = await this.getStrategy(strategyId);
      if (!strategy) {
        throw new Error('Strategy not found');
      }

      strategy.state.status = STRATEGY_STATUS.CANCELLED;
      strategy.state.updatedAt = Date.now();
      strategy.state.cancelReason = reason;

      this.cancelScheduledExecution(strategyId);

      await this.saveStrategy(strategy);

      console.log(`DCA strategy ${strategyId} cancelled (${reason})`);

      return {
        success: true,
        status: STRATEGY_STATUS.CANCELLED,
        reason
      };
    } catch (error) {
      console.error('Failed to cancel DCA strategy:', error);
      throw error;
    }
  }

  /**
   * Resume a paused DCA strategy
   */
  async resumeStrategy(strategyId) {
    try {
      const strategy = await this.getStrategy(strategyId);
      if (!strategy) {
        throw new Error('Strategy not found');
      }

      if (strategy.state.status !== STRATEGY_STATUS.PAUSED) {
        throw new Error('Strategy is not paused');
      }

      strategy.state.status = STRATEGY_STATUS.ACTIVE;
      strategy.state.pauseReason = null;
      strategy.state.updatedAt = Date.now();
      strategy.state.nextExecutionAt = this.calculateNextExecution(strategy.config);

      await this.saveStrategy(strategy);

      // Reschedule execution
      this.scheduleRecurringExecution(strategyId, strategy);

      return {
        success: true,
        status: STRATEGY_STATUS.ACTIVE,
        nextExecution: strategy.state.nextExecutionAt
      };
    } catch (error) {
      console.error('Failed to resume strategy:', error);
      throw error;
    }
  }

  /**
   * Get strategy details
   */
  async getStrategy(strategyId, options = {}) {
    const { includeExecutionHistory = false, decrypt = true } = options;

    try {
      let strategy = this.strategies.get(strategyId);
      
      if (!strategy && decrypt) {
        strategy = await this.decryptAndLoadStrategy(strategyId);
      }

      if (!strategy) {
        return null;
      }

      const result = {
        ...strategy,
        performance: await this.calculateStrategyPerformance(strategy)
      };

      if (includeExecutionHistory) {
        result.executionHistory = await this.getExecutionHistory(strategyId);
      }

      return result;
    } catch (error) {
      console.error('Failed to get strategy:', error);
      throw error;
    }
  }

  /**
   * List all strategies with filtering
   */
  async listStrategies(filters = {}, options = {}) {
    const { 
      includePerformance = true,
      includeInactive = true,
      limit = 100,
      offset = 0 
    } = options;

    try {
      let strategies = Array.from(this.strategies.values());

      await this.loadAllEncryptedStrategies();
      strategies = Array.from(this.strategies.values());

      // Apply filters
      if (filters.status) {
        strategies = strategies.filter(s => s.state.status === filters.status);
      }

      if (filters.tokenIn) {
        strategies = strategies.filter(s => s.config.tokenIn.toLowerCase() === filters.tokenIn.toLowerCase());
      }

      if (filters.tokenOut) {
        strategies = strategies.filter(s => s.config.tokenOut.toLowerCase() === filters.tokenOut.toLowerCase());
      }

      if (!includeInactive) {
        strategies = strategies.filter(s => s.state.status === STRATEGY_STATUS.ACTIVE);
      }

      // Sort by creation date (newest first)
      strategies.sort((a, b) => b.config.createdAt - a.config.createdAt);

      // Apply pagination
      const total = strategies.length;
      strategies = strategies.slice(offset, offset + limit);

      // Add performance data if requested
      if (includePerformance) {
        for (const strategy of strategies) {
          strategy.performance = await this.calculateStrategyPerformance(strategy);
        }
      }

      return {
        strategies: strategies.map(s => this.sanitizeStrategyForResponse(s)),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total
        }
      };
    } catch (error) {
      console.error('Failed to list strategies:', error);
      throw error;
    }
  }

  // --- PRIVATE HELPER METHODS ---

  generateStrategyId(config) {
    const key = `${config.smartAccount}-${config.tokenIn}-${config.tokenOut}-${Date.now()}`;
    const encoded = safeBase64Encode(key);
    return `dca_${encoded.replace(/[^a-zA-Z0-9]/g, '').substring(0, 32)}`;
  }

  calculateNextExecution(config) {
    const now = Date.now();
    const intervalConfig = SWAP_INTERVALS[config.interval?.toUpperCase()];
    
    if (!intervalConfig) {
      return now;
    }

    if (!intervalConfig.recurring) {
      return now; // Immediate execution
    }

    return now + intervalConfig.intervalMs;
  }

  calculateSwapAmount(strategy) {
    const { swapAmount } = strategy.config;
    return parseUnits(swapAmount.toString(), strategy.config.tokenInDecimals || 18);
  }

  calculateActualSlippage(execution) {
    if (execution.expectedOutput === 0n) return 0;
    
    const expectedOutput = Number(execution.expectedOutput);
    const actualOutput = Number(execution.actualOutput);
    
    return ((expectedOutput - actualOutput) / expectedOutput) * 100;
  }

  calculateRiskScore(config) {
    let score = 0;
    
    const intervalConfig = SWAP_INTERVALS[config.interval?.toUpperCase()];
    if (intervalConfig) {
      if (intervalConfig.id === 'per_minute') score += 30;
      else if (intervalConfig.id === 'hourly') score += 20;
      else if (intervalConfig.id === 'daily') score += 10;
    }
    
    if (config.swapAmount > 1000) score += 25;
    else if (config.swapAmount > 100) score += 15;
    else score += 5;
    
    const slippagePercent = config.maxSlippage * 100;
    if (slippagePercent > 5) score += 20;
    else if (slippagePercent > 2) score += 10;
    else score += 5;
    
    return Math.min(score, 100);
  }

  async executeSwapViaDelegation(strategy, execution) {
    try {
      const slippageBps = BigInt(Math.floor(strategy.config.maxSlippage * 10000));
      
      // Get quote first
      const quoteResult = await swapExecutor.getSwapQuote({
        tokenIn: strategy.config.tokenIn,
        tokenOut: strategy.config.tokenOut,
        amountIn: execution.swapAmount,
        tokenInDecimals: strategy.config.tokenInDecimals || 18,
        tokenOutDecimals: strategy.config.tokenOutDecimals || 18
      });

      if (!quoteResult.success) {
        throw new Error(`Quote failed: ${quoteResult.error}`);
      }

      const minAmountOut = quoteResult.quote.minAmountOut;

      const swapResult = await delegationService.executeDCASwap(
        strategy.delegation.id,
        {
          tokenIn: strategy.config.tokenIn,
          tokenOut: strategy.config.tokenOut,
          amountIn: execution.swapAmount,
          minAmountOut,
          recipient: strategy.config.smartAccount,
          deadline: Math.floor(Date.now() / 1000) + 300
        }
      );

      return swapResult;
    } catch (error) {
      console.error('Swap execution via delegation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async updateStrategyAfterExecution(strategy, execution) {
    strategy.state.totalExecutions++;
    strategy.state.successfulExecutions++;
    strategy.state.totalInvested += execution.swapAmount;
    strategy.state.totalReceived += execution.actualOutput;
    strategy.state.lastExecutionAt = execution.completedAt;
    strategy.state.failureCount = 0;
    strategy.metadata.gasSpent += execution.gasCost;

    const totalReceived = Number(strategy.state.totalReceived);
    const totalInvested = Number(strategy.state.totalInvested);
    if (totalReceived > 0) {
      strategy.state.averagePrice = parseUnits((totalInvested / totalReceived).toString(), 18);
    }

    strategy.state.nextExecutionAt = this.calculateNextExecution(strategy.config);

    await this.saveStrategy(strategy);
  }

  async recordExecution(execution) {
    if (!this.executionHistory.has(execution.strategyId)) {
      this.executionHistory.set(execution.strategyId, []);
    }
    
    this.executionHistory.get(execution.strategyId).push(execution);
    
    const history = this.executionHistory.get(execution.strategyId);
    if (history.length > 100) {
      this.executionHistory.set(execution.strategyId, history.slice(-100));
    }
  }

  async calculateStrategyPerformance(strategy) {
    const totalInvested = Number(formatUnits(strategy.state.totalInvested, 18));
    const totalReceived = Number(formatUnits(strategy.state.totalReceived, 18));
    const gasSpent = Number(formatUnits(strategy.metadata.gasSpent, 18));

    return {
      totalInvested,
      totalReceived,
      gasSpent,
      netReturn: totalReceived - totalInvested - gasSpent,
      returnPercentage: totalInvested > 0 ? ((totalReceived - totalInvested - gasSpent) / totalInvested) * 100 : 0,
      averagePrice: Number(formatUnits(strategy.state.averagePrice, 18)),
      successRate: strategy.state.totalExecutions > 0 ? (strategy.state.successfulExecutions / strategy.state.totalExecutions) * 100 : 0,
      executionCount: strategy.state.totalExecutions
    };
  }

  cancelScheduledExecution(strategyId) {
    const intervalId = this.scheduledIntervals.get(strategyId);
    if (intervalId) {
      clearInterval(intervalId);
      this.scheduledIntervals.delete(strategyId);
      console.log(`Cancelled scheduled execution for strategy ${strategyId}`);
    }
  }

  async createStrategyDelegation(strategy) {
    try {
      const delegationConfig = {
        delegator: strategy.config.smartAccount,
        delegate: strategy.config.dcaAgent,
        type: 'dca_strategy',
        caveats: [
          {
            type: 'spending_limit',
            terms: {
              token: strategy.config.tokenIn,
              amount: strategy.config.totalBudget,
              period: 'total'
            }
          },
          {
            type: 'time_range',
            terms: {
              start: Date.now(),
              end: strategy.config.endTime || Date.now() + (365 * 24 * 60 * 60 * 1000)
            }
          }
        ]
      };

      return await delegationService.createDCAStrategyDelegation(delegationConfig);
    } catch (error) {
      console.error('Failed to create strategy delegation:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async encryptAndStoreStrategy(strategy) {
    const encryptedData = await encryptAndStore(strategy, 'STRATEGY_CONFIG');
    this.strategies.set(strategy.id, {
      id: strategy.id,
      encrypted: true,
      encryptedReference: encryptedData.reference
    });
  }

  async decryptAndLoadStrategy(strategyId) {
    const strategyRef = this.strategies.get(strategyId);
    if (!strategyRef || !strategyRef.encrypted) {
      return null;
    }

    try {
      const decryptedStrategy = await retrieveAndDecrypt(strategyRef.encryptedReference, 'STRATEGY_CONFIG');
      return decryptedStrategy;
    } catch (error) {
      console.error(`Failed to decrypt strategy ${strategyId}:`, error);
      return null;
    }
  }

  async saveStrategy(strategy) {
    if (strategy.metadata.encrypted) {
      await this.encryptAndStoreStrategy(strategy);
    } else {
      this.strategies.set(strategy.id, strategy);
    }
  }

  async loadStrategiesFromStorage() {
    console.log('Loading DCA strategies from storage...');
    // In production, load from secure storage
  }

  async loadAllEncryptedStrategies() {
    const encryptedRefs = Array.from(this.strategies.values()).filter(s => s.encrypted);
    
    for (const ref of encryptedRefs) {
      try {
        const strategy = await this.decryptAndLoadStrategy(ref.id);
        if (strategy) {
          this.strategies.set(ref.id, strategy);
        }
      } catch (error) {
        console.error(`Failed to load encrypted strategy ${ref.id}:`, error);
      }
    }
  }

  async getExecutionHistory(strategyId, options = {}) {
    const { limit = 50, offset = 0 } = options;
    
    const history = this.executionHistory.get(strategyId) || [];
    const total = history.length;
    
    const sortedHistory = [...history].sort((a, b) => b.startedAt - a.startedAt);
    const paginatedHistory = sortedHistory.slice(offset, offset + limit);
    
    return {
      executions: paginatedHistory,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    };
  }

  async validateStrategyBalance(strategy) {
    try {
      const balance = await monadClient.getBalance({
        address: strategy.config.smartAccount
      });
      const requiredAmount = this.calculateSwapAmount(strategy);
      const gasReserve = parseUnits('0.1', 18);
      
      return {
        sufficient: balance >= requiredAmount + gasReserve,
        available: formatUnits(balance, strategy.config.tokenInDecimals || 18),
        required: formatUnits(requiredAmount, strategy.config.tokenInDecimals || 18),
        gasReserve: formatUnits(gasReserve, 18)
      };
    } catch (error) {
      console.error('Balance validation failed:', error);
      return {
        sufficient: false,
        error: error.message
      };
    }
  }

  sanitizeStrategyForResponse(strategy) {
    const sanitized = { ...strategy };
    
    if (sanitized.delegation) {
      delete sanitized.delegation.signature;
      delete sanitized.delegation.salt;
    }

    return sanitized;
  }

  getEngineStats() {
    const activeStrategies = Array.from(this.strategies.values())
      .filter(s => !s.encrypted && s.state?.status === STRATEGY_STATUS.ACTIVE).length;
    
    const totalStrategies = this.strategies.size;
    const activeExecutions = this.activeExecutions.size;
    const scheduledJobs = this.scheduledIntervals.size;

    return {
      strategies: {
        total: totalStrategies,
        active: activeStrategies,
        paused: totalStrategies - activeStrategies
      },
      executions: {
        active: activeExecutions,
        scheduled: scheduledJobs
      },
      initialized: this.initialized
    };
  }

  async emergencyStop(reason = 'manual_emergency_stop') {
    console.warn(`Emergency stop initiated: ${reason}`);
    
    const stoppedStrategies = [];
    
    try {
      // Stop all intervals
      for (const [strategyId, intervalId] of this.scheduledIntervals.entries()) {
        clearInterval(intervalId);
        stoppedStrategies.push(strategyId);
      }
      this.scheduledIntervals.clear();
      
      // Pause all active strategies
      for (const [strategyId, strategy] of this.strategies.entries()) {
        if (!strategy.encrypted && strategy.state?.status === STRATEGY_STATUS.ACTIVE) {
          await this.pauseStrategy(strategyId, reason);
        }
      }
      
      this.activeExecutions.clear();
      
      console.log(`Emergency stop completed: ${stoppedStrategies.length} strategies stopped`);
      
      return {
        success: true,
        stoppedStrategies: stoppedStrategies.length,
        reason
      };
    } catch (error) {
      console.error('Emergency stop failed:', error);
      throw error;
    }
  }

  destroy() {
    for (const intervalId of this.scheduledIntervals.values()) {
      clearInterval(intervalId);
    }
    this.scheduledIntervals.clear();
    this.strategies.clear();
    this.activeExecutions.clear();
    this.executionHistory.clear();
    this.initialized = false;
    
    console.log('DCAEngineService destroyed');
  }
}

// Create singleton instance
const dcaEngine = new DCAEngineService();

// ===== STRATEGY PERFORMANCE ANALYTICS =====
export const getStrategyPerformance = async (strategyId) => {
  try {
    const strategy = await dcaEngine.getStrategy(strategyId);
    if (!strategy) throw new Error(`Strategy ${strategyId} not found`);

    const historyResult = await dcaEngine.getExecutionHistory(strategyId);
    const history = historyResult?.executions || [];

    if (history.length === 0) {
      return {
        strategyId,
        totalExecutions: 0,
        totalVolumeUSD: 0,
        averageEntryPrice: 0,
        realizedPnL: 0,
        successRate: 0,
        status: strategy.state?.status || 'inactive'
      };
    }

    const totalExecutions = history.length;
    const successfulExecutions = history.filter(h => h.status === 'completed').length;
    const totalVolumeUSD = history.reduce((acc, h) => acc + (h.volumeUSD || 0), 0);
    const avgEntryPrice = history.reduce((acc, h) => acc + (h.priceUSD || 0), 0) / totalExecutions;
    const realizedPnL = history.reduce((acc, h) => acc + (h.profitLossUSD || 0), 0);

    return {
      strategyId,
      totalExecutions,
      totalVolumeUSD,
      averageEntryPrice: Number(avgEntryPrice.toFixed(2)),
      realizedPnL: Number(realizedPnL.toFixed(2)),
      successRate: Number(((successfulExecutions / totalExecutions) * 100).toFixed(2)),
      status: strategy.state?.status || 'active'
    };
  } catch (err) {
    console.error(`[dcaEngine] getStrategyPerformance failed:`, err);
    throw err;
  }
};

// ===== MAIN EXPORTED OPERATIONS =====
export const createDCAStrategy = (config, options) => dcaEngine.createStrategy(config, options);
export const startDCAStrategy = (id, options) => dcaEngine.startStrategy(id, options);
export const executeDCASwap = (id, options) => dcaEngine.executeSwap(id, options);
export const pauseDCAStrategy = (id, reason) => dcaEngine.pauseStrategy(id, reason);
export const resumeDCAStrategy = (id) => dcaEngine.resumeStrategy(id);
export const getDCAStrategy = (id, options) => dcaEngine.getStrategy(id, options);
export const listDCAStrategies = (filters, options) => dcaEngine.listStrategies(filters, options);
export const getDCAEngineStats = () => dcaEngine.getEngineStats();
export const emergencyStopDCA = (reason) => dcaEngine.emergencyStop(reason);
export const cancelDCAStrategy = (id, reason) => dcaEngine.cancelStrategy(id, reason);

// ===== SIMPLE ALIASES =====
export const createStrategy = createDCAStrategy;
export const startStrategy = startDCAStrategy;
export const executeSwap = executeDCASwap;
export const pauseStrategy = pauseDCAStrategy;
export const resumeStrategy = resumeDCAStrategy;
export const cancelStrategy = cancelDCAStrategy;
export const getStrategy = getDCAStrategy;
export const getAllStrategies = listDCAStrategies;
export const calculateNextExecution = (config) => dcaEngine.calculateNextExecution(config);

// ===== EXPORT CLASS & CONSTANTS =====
export { 
  DCAEngineService,
  dcaEngine,
  STRATEGY_STATUS,
  EXECUTION_STATUS
};