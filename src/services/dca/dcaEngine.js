import { parseUnits, formatUnits } from 'viem';
import { monadClient } from '../monad/monadClient.js';
import { gasEstimator } from '../monad/gasEstimator.js';
import { delegationService } from '../delegation/delegationService.js';
import { delegationStorage } from '../delegation/delegationStorage.js';
import { userOperationsService } from '../smartAccount/userOperations.js';
import { validateDCAStrategy, validateTokenAmount, validateSlippage } from '../../utils/validators.js';
import { formatTokenAmount, formatPrice, formatDateTime } from '../../utils/formatters.js';
import { encryptAndStore, retrieveAndDecrypt } from '../../utils/encryption.js';
import { 
  DCA_CONFIG, 
  CONTRACTS, 
  SUPPORTED_TOKENS, 
  GAS_LIMITS,
  MONAD_CONFIG 
} from '../../utils/constants.js';
import { priceOracle } from './priceOracle.js';
import { evaluateExecution } from '../ai/decisionEngine.js'



function safeBase64Encode(str) {
  try {
    if (typeof Buffer !== 'undefined') {
      // Node.js & bundlers
      return Buffer.from(str, 'utf-8').toString('base64');
    } else if (typeof btoa !== 'undefined') {
      // Browser safe UTF-8 → Base64
      return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
    } else {
      throw new Error('No base64 encoder available');
    }
  } catch (e) {
    // Fallback: timestamp + random
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

// DCA Frequency Types
const DCA_FREQUENCIES = {
  HOURLY: 'hourly',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly'
};

// Position Sizing Methods
const SIZING_METHODS = {
  FIXED_AMOUNT: 'fixed_amount',
  PERCENTAGE_BALANCE: 'percentage_balance',
  TWAP_BASED: 'twap_based',
  VOLATILITY_ADJUSTED: 'volatility_adjusted'
};

/**
 * DCA Engine Service
 * Manages DCA strategy lifecycle and automated execution
 */
class DCAEngineService {
  constructor() {
    this.strategies = new Map();
    this.activeExecutions = new Map();
    this.scheduledJobs = new Map();
    this.executionHistory = new Map();
    this.priceCache = new Map();
    this.initialized = false;
    this.schedulerRunning = false;
    this.schedulerTimer = null;
  }

  /**
   * Initialize the DCA engine
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Load existing strategies from storage
      await this.loadStrategiesFromStorage();
      
      // Start execution scheduler
      await this.startScheduler();
      
      this.initialized = true;
      console.log('DCAEngineService initialized with', this.strategies.size, 'strategies');
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

    // Validate strategy configuration
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

      // Prepare strategy data
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
          estimatedApr: 0,
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

      // Encrypt and store strategy
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

    const { validateBalance = true, estimateGas = true } = options;

    try {
      const strategy = await this.getStrategy(strategyId);
      if (!strategy) {
        throw new Error('Strategy not found');
      }

      // Check current status
      if (strategy.state.status === STRATEGY_STATUS.ACTIVE) {
        throw new Error('Strategy already active');
      }

      if (strategy.state.status === STRATEGY_STATUS.COMPLETED) {
        throw new Error('Strategy already completed');
      }

      // Validate delegation exists and is active
      if (!strategy.delegation) {
        throw new Error('No delegation found for strategy');
      }

      const delegationResult = await delegationStorage.getDelegation(strategy.delegation.id);
      if (!delegationResult.success || delegationResult.delegation.metadata.status !== 'active') {
        throw new Error('Delegation not active or accessible');
      }

      // Validate sufficient balance
      if (validateBalance) {
        const balanceCheck = await this.validateStrategyBalance(strategy);
        if (!balanceCheck.sufficient) {
          throw new Error(`Insufficient balance: need ${balanceCheck.required}, have ${balanceCheck.available}`);
        }
      }

      // Estimate gas costs
      if (estimateGas) {
        const gasEstimate = await this.estimateStrategyGasCosts(strategy);
        if (gasEstimate.totalCostMON > strategy.config.maxGasBudget) {
          throw new Error(`Gas costs too high: estimated ${gasEstimate.totalCostMON} MON, budget ${strategy.config.maxGasBudget} MON`);
        }
      }

      // Update strategy status
      strategy.state.status = STRATEGY_STATUS.ACTIVE;
      strategy.state.updatedAt = Date.now();
      strategy.state.nextExecutionAt = this.calculateNextExecution(strategy.config);

      // Save updated strategy
      await this.saveStrategy(strategy);

      // Schedule first execution
      this.scheduleExecution(strategyId, strategy.state.nextExecutionAt);

      console.log(`DCA strategy ${strategyId} started, next execution at ${formatDateTime(strategy.state.nextExecutionAt)}`);

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
   // Add helper method to DCAEngineService class:
  async buildPriceContext(strategy, execution) {
    const tokenOut = strategy.config.tokenOut;
    // Get TWAP (15min default)
    const twapData = await priceOracle.getTWAP(tokenOut, 'USD', {
      period: DCA_CONFIG.defaultTwapPeriod, //900s
      method: 'time_weighted'
    });
     // Get price change (1hr)
    const priceChange = await priceOracle.getPriceChange(tokenOut, 'USD', 3600000);
     // Check liquidity
    const liquidityCheck = await swapExecutor.checkLiquidity(
      strategy.config.tokenIn,
      strategy.config.tokenOut
    );
      // Calculate TWAP divergence
    const spotNum = Number(formatUnits(execution.priceAtExecution, 18));
    const twapNum = Number(formatUnits(twapData.twap, 18));
    const twapDivergence = ((spotNum - twapNum) / twapNum) * 100;

    // 🔥 Fetch real MON/USD price (instead of placeholder in decisionEngine
    const monUsdResult = await priceOracle.getPrice("MON", "USD");
    return {
      spot: execution.priceAtExecution,
      twap: twapData.twap,
      twapDivergence,
      volatility: Math.abs(priceChange.changePercentage),
      priceAge: Date.now() - Date.now(), // Will be set properly from oracle 
      dataPoints: twapData.dataPoints,
      hasLiquidity: liquidityCheck.sufficient,
      priceImpactEstimate: liquidityCheck.priceImpactFor1USD || 0,
      monUsdPrice: monUsdResult // attach live MON/USD oracle price
    };
  }
  
  /**
   * Execute a single DCA swap
   */
  async executeSwap(strategyId, options = {}) {
    if (!this.initialized) {
      throw new Error('DCA engine not initialized');
    }

    const {
      forceExecution = false,
      skipSlippageCheck = false,
      customAmount = null
    } = options;

    const executionId = `exec_${strategyId}_${Date.now()}`;
    
    try {
      // Get strategy
      const strategy = await this.getStrategy(strategyId);
      if (!strategy) {
        throw new Error('Strategy not found');
      }

      // Check if strategy is active
      if (strategy.state.status !== STRATEGY_STATUS.ACTIVE && !forceExecution) {
        throw new Error(`Strategy not active: ${strategy.state.status}`);
      }

      // Create execution record
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
        priceAtExecution: 0n,
        error: null,
        txHash: null,
        retryCount: 0
      };

      this.activeExecutions.set(executionId, execution);

      console.log(`Starting DCA execution ${executionId} for strategy ${strategyId}`);

      // Get current price and calculate expected output
      const priceResult = await this.getCurrentPrice(strategy.config.tokenIn, strategy.config.tokenOut);
      if (!priceResult.success) {
        throw new Error(`Failed to get price: ${priceResult.error}`);
      }

      execution.priceAtExecution = priceResult.price;
      execution.expectedOutput = this.calculateExpectedOutput(
        execution.swapAmount,
        priceResult.price,
        strategy.config.tokenIn,
        strategy.config.tokenOut
      );
      // Build price context for AI analysis
      const priceContext = await this.buildPriceContext(strategy, execution);
      // Call AI decision engine
      const aiDecision = await evaluateExecution(strategy, priceContext, execution);
      console.log(`AI Decision: ${aiDecision.reason}`);
      // Act on AI decision
      if (!aiDecision.shouldExecute) {
        execution.status = EXECUTION_STATUS.SKIPPED;
        execution.error = aiDecision.reason;
        execution.completedAt = Date.now();
        await this.recordExecution(execution);
        return {
          success: false,
          execution,
          reason: 'ai_rejected',
          aiAnalysis: aiDecision.analysis
        };
      }
      // Adjust amount if AI recommends
      if (aiDecision.adjustedAmount && aiDecision.adjustedAmount !== execution.swapAmount) {
        console.log(`AI adjusted swap amount: ${formatTokenAmount(execution.swapAmount, strategy.config.tokenInDecimals)} → ${formatTokenAmount(aiDecision.adjustedAmount, strategy.config.tokenInDecimals)}`);
        execution.swapAmount = aiDecision.adjustedAmount;
        // Recalculate expected output
        execution.expectedOutput = this.calculateExpectedOutput(
          execution.swapAmount,
          priceContext.spot,
          strategy.config.tokenIn,
          strategy.config.tokenOut
        );
      }
      // Check slippage limits
      if (!skipSlippageCheck) {
        const slippageCheck = await this.checkSlippageLimits(strategy, execution);
        if (!slippageCheck.acceptable) {
          execution.status = EXECUTION_STATUS.SKIPPED;
          execution.error = `Slippage too high: ${slippageCheck.currentSlippage}% > ${strategy.config.maxSlippage}%`;
          execution.completedAt = Date.now();
          
          await this.recordExecution(execution);
          return {
            success: false,
            execution,
            reason: 'slippage_too_high'
          };
        }
      }

      // Execute the swap via delegation
      const swapResult = await this.executeSwapViaDelegation(strategy, execution);
      
      if (swapResult.success) {
        execution.status = EXECUTION_STATUS.COMPLETED;
        execution.actualOutput = swapResult.outputAmount;
        execution.txHash = swapResult.txHash;
        execution.gasUsed = swapResult.gasUsed;
        execution.gasCost = swapResult.gasCost;
        execution.slippage = this.calculateActualSlippage(execution);

        // Update strategy state
        await this.updateStrategyAfterExecution(strategy, execution);

        console.log(`DCA execution ${executionId} completed successfully`);
      } else {
        execution.status = EXECUTION_STATUS.FAILED;
        execution.error = swapResult.error;
        
        // Update failure count
        strategy.state.failureCount++;
        
        // Pause strategy if too many failures
        if (strategy.state.failureCount >= DCA_CONFIG.MAX_CONSECUTIVE_FAILURES) {
          strategy.state.status = STRATEGY_STATUS.PAUSED;
          strategy.state.pauseReason = 'too_many_failures';
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
      
      // Update execution record
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
 * Cancel a DCA strategy completely (cannot be resumed)
 */
async cancelStrategy(strategyId, reason = 'user_cancelled') {
  try {
    const strategy = await this.getStrategy(strategyId);
    if (!strategy) {
      throw new Error('Strategy not found');
    }

    // Mark as cancelled
    strategy.state.status = STRATEGY_STATUS.CANCELLED;
    strategy.state.updatedAt = Date.now();
    strategy.state.cancelReason = reason;

    // Stop any future executions
    this.cancelScheduledExecution(strategyId);

    // Save and persist
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
      this.scheduleExecution(strategyId, strategy.state.nextExecutionAt);

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
        performance: await this.calculateStrategyPerformance(strategy),
        gasAnalysis: await this.calculateGasAnalysis(strategy)
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

      // Load encrypted strategies
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
    const { frequency, startTime } = config;

    let nextExecution = startTime || now;

    switch (frequency) {
      case DCA_FREQUENCIES.HOURLY:
        nextExecution = now + (60 * 60 * 1000); // 1 hour
        break;
      case DCA_FREQUENCIES.DAILY:
        nextExecution = now + (24 * 60 * 60 * 1000); // 24 hours
        break;
      case DCA_FREQUENCIES.WEEKLY:
        nextExecution = now + (7 * 24 * 60 * 60 * 1000); // 7 days
        break;
      case DCA_FREQUENCIES.MONTHLY:
        nextExecution = now + (30 * 24 * 60 * 60 * 1000); // 30 days
        break;
      default:
        nextExecution = now + (24 * 60 * 60 * 1000); // Default to daily
    }

    return nextExecution;
  }

  calculateSwapAmount(strategy) {
    const { sizingMethod, swapAmount, percentageOfBalance } = strategy.config;

    switch (sizingMethod) {
      case SIZING_METHODS.FIXED_AMOUNT:
        return parseUnits(swapAmount.toString(), strategy.config.tokenInDecimals);
      
      case SIZING_METHODS.PERCENTAGE_BALANCE:
        // This would need to fetch current balance and calculate percentage
        // For now, return fixed amount as fallback
        return parseUnits(swapAmount.toString(), strategy.config.tokenInDecimals);
      
      default:
        return parseUnits(swapAmount.toString(), strategy.config.tokenInDecimals);
    }
  }

  calculateExpectedOutput(inputAmount, price, tokenIn, tokenOut) {
    // Simple calculation - in production would use proper price feeds
    const inputToken = SUPPORTED_TOKENS.find(t => t.symbol.toUpperCase() === tokenIn.toUpperCase());
    const outputToken = SUPPORTED_TOKENS.find(t => t.symbol.toUpperCase() === tokenOut.toUpperCase());
    
    if (!inputToken || !outputToken) {
      throw new Error('Unsupported token pair');
    }

    // Convert input amount to base units and calculate output
    const inputInUSD = (inputAmount * price) / ((10n ** BigInt(inputToken.decimals)) * 10n ** 18n);
    return inputInUSD * (10n ** BigInt(outputToken.decimals));
  }

  calculateActualSlippage(execution) {
    if (execution.expectedOutput === 0n) return 0;
    
    const expectedOutput = Number(execution.expectedOutput);
    const actualOutput = Number(execution.actualOutput);
    
    return ((expectedOutput - actualOutput) / expectedOutput) * 100;
  }

  calculateRiskScore(config) {
    let score = 0;
    
    // Frequency risk (more frequent = higher risk)
    if (config.frequency === DCA_FREQUENCIES.HOURLY) score += 30;
    else if (config.frequency === DCA_FREQUENCIES.DAILY) score += 20;
    else if (config.frequency === DCA_FREQUENCIES.WEEKLY) score += 10;
    
    // Amount risk (higher amounts = higher risk)
    if (config.swapAmount > 1000) score += 25;
    else if (config.swapAmount > 100) score += 15;
    else score += 5;
    
    // Slippage tolerance risk
    const slippagePercent = config.maxSlippage * 100
    if (slippagePercent > 5) score += 20;
    else if (slippagePercent > 2) score += 10;
    else score += 5;
    
    return Math.min(score, 100);
  }

  async getCurrentPrice(tokenIn, tokenOut) {
    try{
      const price = await priceOracle.getPrice(tokenIn, tokenOut);
      return{
        success: true,
        price,
        timestamp:Date.now(),
        source: 'pyth_oracle'
      };
    } catch (error){
      return {success:false, error: error.message};

    }
  }

  async checkSlippageLimits(strategy, execution) {
    // Implementation would check current market conditions
    return {
      acceptable: true,
      currentSlippage: 1.5,
      maxAllowed: strategy.config.maxSlippage
    };
  }

  async executeSwapViaDelegation(strategy, execution) {
    try {
      // Convert maxSlippage (e.g. 0.05 = 5%) into basis points (500 bps)
      const SlippageBps = BigInt(Math.floor(strategy.config.maxSlippage * 10000));

      // minAmountOut = expectedOutput * (10000 - slippageBps) / 10000
      const minAmountOut =(execution.expectedOutput * (10000n - slippageBps)) / 10000n;
      const swapResult = await delegationService.executeDCASwap(
        strategy.delegation.id,
        {
          tokenIn: strategy.config.tokenIn,
          tokenOut: strategy.config.tokenOut,
          amountIn: execution.swapAmount,
          minAmountOut,
          recipient: strategy.config.smartAccount,
          deadline: Math.floor(Date.now() / 1000) + 300 // 5 minutes
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
    strategy.state.failureCount = 0; // Reset failure count on success
    strategy.metadata.gasSpent += execution.gasCost;

    // Update average price
    const totalReceived = Number(strategy.state.totalReceived);
    const totalInvested = Number(strategy.state.totalInvested);
    if (totalReceived > 0) {
      strategy.state.averagePrice = parseUnits((totalInvested / totalReceived).toString(), 18);
    }

    // Schedule next execution
    strategy.state.nextExecutionAt = this.calculateNextExecution(strategy.config);

    await this.saveStrategy(strategy);
    this.scheduleExecution(strategy.id, strategy.state.nextExecutionAt);
  }

  async recordExecution(execution) {
    if (!this.executionHistory.has(execution.strategyId)) {
      this.executionHistory.set(execution.strategyId, []);
    }
    
    this.executionHistory.get(execution.strategyId).push(execution);
    
    // Keep only last 100 executions per strategy
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

  async calculateGasAnalysis(strategy) {
    const totalGasSpent = Number(formatUnits(strategy.metadata.gasSpent, 18));
    const avgGasPerExecution = strategy.state.successfulExecutions > 0 ? 
      totalGasSpent / strategy.state.successfulExecutions : 0;

    return {
      totalGasSpent,
      averageGasPerExecution: avgGasPerExecution,
      estimatedGasForNext: avgGasPerExecution,
      gasEfficiencyScore: this.calculateGasEfficiency(strategy)
    };
  }

  calculateGasEfficiency(strategy) {
    const gasSpent = Number(formatUnits(strategy.metadata.gasSpent, 18));
    const totalValue = Number(formatUnits(strategy.state.totalInvested, 18));
    
    if (totalValue === 0) return 0;
    
    const gasRatio = gasSpent / totalValue;
    
    // Lower gas ratio = higher efficiency score
    if (gasRatio < 0.001) return 95;
    if (gasRatio < 0.005) return 85;
    if (gasRatio < 0.01) return 70;
    if (gasRatio < 0.02) return 50;
    return 30;
  }

  scheduleExecution(strategyId, executionTime) {
    // Clear existing scheduled job
    this.cancelScheduledExecution(strategyId);

    const delay = executionTime - Date.now();
    if (delay > 0) {
      const timeoutId = setTimeout(async () => {
        try {
          await this.executeSwap(strategyId);
        } catch (error) {
          console.error(`Scheduled execution failed for strategy ${strategyId}:`, error);
        }
      }, delay);

      this.scheduledJobs.set(strategyId, timeoutId);
      console.log(`Scheduled execution for strategy ${strategyId} in ${Math.round(delay / 1000)} seconds`);
    }
  }

  cancelScheduledExecution(strategyId) {
    const timeoutId = this.scheduledJobs.get(strategyId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.scheduledJobs.delete(strategyId);
    }
  }

  async createStrategyDelegation(strategy) {
    try {
      const delegationConfig = {
        delegator: strategy.config.smartAccount,
        delegate: strategy.config.dcaAgent, // DCA agent address
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
              end: strategy.config.endTime || Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year default
            }
          },
          {
            type: 'function_whitelist',
            terms: {
              functions: ['swapExactTokensForTokens', 'multicall']
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
    // Store reference in memory with encryption flag
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
    // Implementation would load from persistent storage
    console.log('Loading DCA strategies from storage...');
    // For now, start with empty state - in production would load from secure storage
  }

  async loadAllEncryptedStrategies() {
    // Load all encrypted strategy references and decrypt them
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
    
    // Sort by execution time (newest first)
    const sortedHistory = [...history].sort((a, b) => b.startedAt - a.startedAt);
    
    // Apply pagination
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
      const balance = await monadClient.getBalance(strategy.config.smartAccount, strategy.config.tokenIn);
      const requiredAmount = this.calculateSwapAmount(strategy);
      const gasReserve = parseUnits('0.1', 18); // Reserve 0.1 MON for gas
      
      return {
        sufficient: balance >= requiredAmount + gasReserve,
        available: formatUnits(balance, strategy.config.tokenInDecimals),
        required: formatUnits(requiredAmount, strategy.config.tokenInDecimals),
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

  async estimateStrategyGasCosts(strategy) {
    try {
      const swapGasEstimate = await gasEstimator.estimateOperationGas('uniswap_swap', {
        tokenIn: strategy.config.tokenIn,
        tokenOut: strategy.config.tokenOut,
        amount: this.calculateSwapAmount(strategy)
      });

      const executionsPerPeriod = this.calculateExecutionsPerPeriod(strategy.config.frequency);
      const totalExecutions = strategy.config.totalExecutions || 100; // Default estimate
      
      return {
        gasPerSwap: swapGasEstimate.gasLimit,
        gasCostPerSwap: swapGasEstimate.totalCostMON,
        totalGasLimit: swapGasEstimate.gasLimit * BigInt(totalExecutions),
        totalCostMON: swapGasEstimate.totalCostMON * BigInt(totalExecutions),
        executionsPerMonth: executionsPerPeriod * 30, // Rough monthly estimate
        monthlyCostMON: (swapGasEstimate.totalCostMON * executionsPerPeriod * 30)
      };
    } catch (error) {
      console.error('Gas estimation failed:', error);
      throw error;
    }
  }

  calculateExecutionsPerPeriod(frequency) {
    switch (frequency) {
      case DCA_FREQUENCIES.HOURLY: return 24; // Per day
      case DCA_FREQUENCIES.DAILY: return 1; // Per day
      case DCA_FREQUENCIES.WEEKLY: return 1/7; // Per day
      case DCA_FREQUENCIES.MONTHLY: return 1/30; // Per day
      default: return 1;
    }
  }

  sanitizeStrategyForResponse(strategy) {
    // Remove sensitive data before sending to frontend
    const sanitized = { ...strategy };
    
    if (sanitized.delegation) {
      // Remove sensitive delegation data
      delete sanitized.delegation.signature;
      delete sanitized.delegation.salt;
    }

    return sanitized;
  }

  async startScheduler() {
    if (this.schedulerRunning) return;

    this.schedulerRunning = true;
    
    // Check for pending executions every minute
    this.schedulerTimer = setInterval(async () => {
      try {
        await this.processScheduledExecutions();
      } catch (error) {
        console.error('Scheduler error:', error);
      }
    }, 60 * 1000); // 1 minute interval

    console.log('DCA execution scheduler started');
  }

  async processScheduledExecutions() {
    const now = Date.now();
    const pendingExecutions = [];

    // Find strategies with pending executions
    for (const [strategyId, strategy] of this.strategies.entries()) {
      if (strategy.encrypted) continue; // Skip encrypted references

      if (strategy.state.status === STRATEGY_STATUS.ACTIVE && 
          strategy.state.nextExecutionAt && 
          strategy.state.nextExecutionAt <= now) {
        pendingExecutions.push(strategyId);
      }
    }

    // Execute pending swaps
    for (const strategyId of pendingExecutions) {
      try {
        console.log(`Processing scheduled execution for strategy ${strategyId}`);
        await this.executeSwap(strategyId);
      } catch (error) {
        console.error(`Scheduled execution failed for strategy ${strategyId}:`, error);
        
        // Handle persistent failures
        const strategy = await this.getStrategy(strategyId);
        if (strategy && strategy.state.failureCount >= DCA_CONFIG.MAX_CONSECUTIVE_FAILURES) {
          await this.pauseStrategy(strategyId, 'repeated_failures');
        }
      }
    }
  }

  stopScheduler() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.schedulerRunning = false;
    
    // Clear all scheduled jobs
    for (const timeoutId of this.scheduledJobs.values()) {
      clearTimeout(timeoutId);
    }
    this.scheduledJobs.clear();
    
    console.log('DCA execution scheduler stopped');
  }

  /**
   * Get engine statistics and health metrics
   */
  getEngineStats() {
    const activeStrategies = Array.from(this.strategies.values())
      .filter(s => !s.encrypted && s.state.status === STRATEGY_STATUS.ACTIVE).length;
    
    const totalStrategies = this.strategies.size;
    const activeExecutions = this.activeExecutions.size;
    const scheduledJobs = this.scheduledJobs.size;

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
      scheduler: {
        running: this.schedulerRunning,
        lastCheck: Date.now()
      },
      memory: {
        strategiesSize: this.strategies.size,
        executionHistorySize: Array.from(this.executionHistory.values()).reduce((sum, arr) => sum + arr.length, 0),
        activeCacheSize: this.activeExecutions.size
      },
      initialized: this.initialized
    };
  }

  /**
   * Emergency stop all active strategies
   */
  async emergencyStop(reason = 'manual_emergency_stop') {
    console.warn(`Emergency stop initiated: ${reason}`);
    
    const stoppedStrategies = [];
    
    try {
      // Stop scheduler
      this.stopScheduler();
      
      // Pause all active strategies
      for (const [strategyId, strategy] of this.strategies.entries()) {
        if (!strategy.encrypted && strategy.state.status === STRATEGY_STATUS.ACTIVE) {
          await this.pauseStrategy(strategyId, reason);
          stoppedStrategies.push(strategyId);
        }
      }
      
      // Clear active executions
      this.activeExecutions.clear();
      
      console.log(`Emergency stop completed: ${stoppedStrategies.length} strategies paused`);
      
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

  /**
   * Cleanup resources and prepare for shutdown
   */
  destroy() {
    this.stopScheduler();
    this.strategies.clear();
    this.activeExecutions.clear();
    this.executionHistory.clear();
    this.priceCache.clear();
    this.scheduledJobs.clear();
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

// ===== SIMPLE ALIASES (for hooks & UI) =====
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
  EXECUTION_STATUS,
  DCA_FREQUENCIES,
  SIZING_METHODS
};
