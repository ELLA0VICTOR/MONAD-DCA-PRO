import { formatUnits, parseUnits } from 'viem';
import { MONAD_CONFIG, GAS_LIMITS, CONTRACTS, ERROR_CODES } from '../../utils/constants.js';
import { monadClient } from './monadClient.js';

// ===== GAS ESTIMATION CONSTANTS =====

/**
 * Operation-specific gas estimates based on Monad network characteristics
 */
const OPERATION_GAS_ESTIMATES = {
  // Basic operations
  TRANSFER_NATIVE: 21000,
  TRANSFER_ERC20: 65000,
  APPROVE_ERC20: 46000,
  
  // Smart Account operations (Account Abstraction)
  ACCOUNT_DEPLOYMENT: 500000,      // First user operation
  USER_OPERATION_BASE: 150000,     // Base user operation cost
  USER_OPERATION_VALIDATION: 100000, // Signature validation
  USER_OPERATION_EXECUTION: 50000,   // Execution overhead
  
  // Delegation Framework operations
  CREATE_DELEGATION: 120000,
  REDEEM_DELEGATION: 80000,
  REVOKE_DELEGATION: 60000,
  UPDATE_DELEGATION: 90000,
  
  // Uniswap V3 operations
  SWAP_EXACT_INPUT: 180000,
  SWAP_EXACT_OUTPUT: 220000,
  MULTI_HOP_SWAP: 350000,
  ADD_LIQUIDITY: 300000,
  REMOVE_LIQUIDITY: 250000,
  COLLECT_FEES: 100000,
  UNISWAP_SWAP: 200000,
  
  // Oracle operations
  PYTH_PRICE_UPDATE: 45000,
  PRICE_FEED_READ: 25000,
  
  // DCA specific operations
  DCA_STRATEGY_CREATE: 200000,
  DCA_STRATEGY_EXECUTE: 250000,    // Includes swap + delegation
  DCA_STRATEGY_PAUSE: 50000,
  DCA_STRATEGY_CANCEL: 75000,
  
  // Multicall operations
  MULTICALL_OVERHEAD: 30000,       // Per additional call
  MULTICALL_BASE: 50000,
};

/**
 * Gas price tiers for different transaction priorities
 */
const GAS_PRICE_TIERS = {
  SLOW: {
    multiplier: 1.0,
    description: 'Standard speed (50 gwei)',
    expectedTime: '1-2 blocks (400-800ms)',
  },
  STANDARD: {
    multiplier: 1.2,
    description: 'Faster confirmation (60 gwei)',
    expectedTime: '1 block (400ms)',
  },
  FAST: {
    multiplier: 1.5,
    description: 'Priority confirmation (75 gwei)',
    expectedTime: '1 block guaranteed (400ms)',
  },
  URGENT: {
    multiplier: 2.0,
    description: 'Maximum priority (100 gwei)',
    expectedTime: 'Next block (400ms)',
  },
};

// ===== GAS ESTIMATOR CLASS =====

/**
 * Advanced gas estimator for Monad network operations
 */
export class MonadGasEstimator {
  constructor(client = monadClient) {
    this.client = client;
    this.baseGasPrice = MONAD_CONFIG.baseFee;
    this.gasHistory = [];
    this.maxHistorySize = 100;
    
    // Network state tracking
    this.networkCongestion = 'low';
    this.avgBlockGasUsed = 0n;
    this.lastUpdate = 0;
    
    // Start monitoring if client is available
    if (this.client && this.client.publicClient) {
      this.startGasMonitoring();
    }
  }
  
  /**
   * Estimate gas for a specific operation type
   * @param {string} operationType - Type of operation
   * @param {object} params - Operation parameters
   * @returns {object} Gas estimation with multiple tiers
   */
  async estimateOperationGas(operationType, params = {}) {
    // Normalize operation type to uppercase key
    const normalizedType = operationType.toUpperCase();

    // Backward compatibility: allow 'uniswap_swap'
    if (normalizedType === 'UNISWAP_SWAP' || operationType === 'uniswap_swap') {
      operationType = 'UNISWAP_SWAP';
    }

    if (!OPERATION_GAS_ESTIMATES[operationType]) {
      throw new Error(`Unknown operation type: ${operationType}`);
    }
    
    try {
      let baseGasLimit = OPERATION_GAS_ESTIMATES[operationType];
      
      // Apply operation-specific adjustments
      baseGasLimit = this.adjustGasForOperation(operationType, baseGasLimit, params);
      
      // Get current network conditions
      await this.updateNetworkConditions();
      
      // Calculate gas estimates for different priorities
      const estimates = this.calculateGasTiers(baseGasLimit);
      
      // Add Monad-specific information
      estimates.monadSpecific = {
        chargesGasLimit: true,
        baseFee: this.baseGasPrice.toString(),
        networkCongestion: this.networkCongestion,
        blockTime: MONAD_CONFIG.blockTime,
      };
      
      return estimates;
      
    } catch (error) {
      throw new Error(`Gas estimation failed for ${operationType}: ${error.message}`);
    }
  }
  
  /**
   * Estimate gas for a raw transaction
   * @param {object} transaction - Transaction parameters
   * @returns {object} Detailed gas estimation
   */
  async estimateTransactionGas(transaction) {
    if (!transaction) {
      throw new Error('Transaction parameters are required');
    }
    
    try {
      // Use client's gas estimation
      const gasEstimate = await this.client.estimateGas(transaction);
      
      // Parse the gas limit from client response
      const estimatedGasLimit = BigInt(gasEstimate.gasLimit);
      
      // Calculate gas estimates for different priorities
      const estimates = this.calculateGasTiers(estimatedGasLimit);
      
      // Add transaction-specific information
      estimates.transaction = {
        to: transaction.to,
        value: transaction.value?.toString() || '0',
        data: transaction.data || '0x',
        estimatedGasLimit: estimatedGasLimit.toString(),
      };
      
      // Add cost breakdown
      estimates.costBreakdown = this.calculateCostBreakdown(
        estimatedGasLimit,
        transaction.value || 0n
      );
      
      return estimates;
      
    } catch (error) {
      // Fallback to operation-based estimation if raw estimation fails
      console.warn('Raw gas estimation failed, using fallback:', error.message);
      
      // Determine operation type from transaction
      const operationType = this.detectOperationType(transaction);
      return await this.estimateOperationGas(operationType, { transaction });
    }
  }
  
  /**
   * Estimate gas for DCA strategy execution
   * @param {object} strategy - DCA strategy parameters
   * @returns {object} Comprehensive gas estimation for strategy lifecycle
   */
  async estimateDCAStrategyGas(strategy) {
    if (!strategy) {
      throw new Error('Strategy parameters are required');
    }
    
    try {
      // Estimate individual operation costs
      const createGas = await this.estimateOperationGas('DCA_STRATEGY_CREATE');
      const executeGas = await this.estimateOperationGas('DCA_STRATEGY_EXECUTE', {
        swapComplexity: strategy.multiHop ? 'complex' : 'simple',
        tokenPair: `${strategy.fromToken}-${strategy.toToken}`,
      });
      
      // Calculate total strategy cost
      const executionCount = strategy.executionCount || 1;
      const totalExecutionGas = executeGas.standard.gasLimit * BigInt(executionCount);
      const totalGas = createGas.standard.gasLimit + totalExecutionGas;
      
      // Calculate costs
      const standardGasPrice = this.baseGasPrice * BigInt(Math.floor(GAS_PRICE_TIERS.STANDARD.multiplier * 100)) / 100n;
      const totalCostWei = totalGas * standardGasPrice;
      
      return {
        strategy: {
          creationCost: {
            gasLimit: createGas.standard.gasLimit.toString(),
            gasCost: (createGas.standard.gasLimit * standardGasPrice).toString(),
          },
          perExecutionCost: {
            gasLimit: executeGas.standard.gasLimit.toString(),
            gasCost: (executeGas.standard.gasLimit * standardGasPrice).toString(),
          },
          totalCost: {
            gasLimit: totalGas.toString(),
            gasCost: totalCostWei.toString(),
            formatted: formatUnits(totalCostWei, 18) + ' MON',
            executionCount,
          },
        },
        breakdown: {
          creation: createGas,
          execution: executeGas,
        },
        recommendations: this.getGasRecommendations(totalCostWei, strategy),
      };
      
    } catch (error) {
      throw new Error(`DCA strategy gas estimation failed: ${error.message}`);
    }
  }
  
  /**
   * Adjust gas limit based on specific operation characteristics
   * @param {string} operationType - Operation type
   * @param {bigint} baseGasLimit - Base gas limit
   * @param {object} params - Operation parameters
   * @returns {bigint} Adjusted gas limit
   */
  adjustGasForOperation(operationType, baseGasLimit, params = {}) {
    let adjustedGas = BigInt(baseGasLimit);
    
    switch (operationType) {
      case 'DCA_STRATEGY_EXECUTE':
        // Adjust for swap complexity
        if (params.swapComplexity === 'complex') {
          adjustedGas = adjustedGas * 150n / 100n; // 50% increase for complex swaps
        }
        
        // Adjust for token pair (some pairs need more gas)
        if (params.tokenPair && params.tokenPair.includes('WBTC')) {
          adjustedGas = adjustedGas + 20000n; // WBTC transfers are more expensive
        }
        break;
        
      case 'USER_OPERATION_BASE':
        // Adjust for account deployment
        if (params.isFirstOperation) {
          adjustedGas = adjustedGas + BigInt(OPERATION_GAS_ESTIMATES.ACCOUNT_DEPLOYMENT);
        }
        
        // Adjust for paymaster usage
        if (params.usePaymaster) {
          adjustedGas = adjustedGas + 50000n;
        }
        break;
        
      case 'MULTICALL_BASE':
        // Add overhead for each additional call
        const callCount = params.callCount || 1;
        if (callCount > 1) {
          adjustedGas = adjustedGas + BigInt((callCount - 1) * OPERATION_GAS_ESTIMATES.MULTICALL_OVERHEAD);
        }
        break;
        
      case 'SWAP_EXACT_INPUT':
      case 'SWAP_EXACT_OUTPUT':
        // Adjust for multi-hop swaps
        const hopCount = params.hopCount || 1;
        if (hopCount > 1) {
          adjustedGas = adjustedGas + BigInt((hopCount - 1) * 80000);
        }
        break;
    }
    
    // Apply network congestion multiplier
    const congestionMultiplier = this.getCongestionMultiplier();
    adjustedGas = adjustedGas * BigInt(Math.floor(congestionMultiplier * 100)) / 100n;
    
    return adjustedGas;
  }
  
  /**
   * Calculate gas estimates for different priority tiers
   * @param {bigint} baseGasLimit - Base gas limit
   * @returns {object} Gas estimates for all tiers
   */
  calculateGasTiers(baseGasLimit) {
    const gasLimit = BigInt(baseGasLimit);
    const estimates = {};
    
    for (const [tier, config] of Object.entries(GAS_PRICE_TIERS)) {
      const gasPrice = this.baseGasPrice * BigInt(Math.floor(config.multiplier * 100)) / 100n;
      const gasCost = gasPrice * gasLimit;
      
      estimates[tier.toLowerCase()] = {
        gasLimit: gasLimit.toString(),
        gasPrice: gasPrice.toString(),
        gasCost: gasCost.toString(),
        formatted: {
          gasLimit: gasLimit.toLocaleString(),
          gasPrice: formatUnits(gasPrice, 9) + ' gwei',
          gasCost: formatUnits(gasCost, 18) + ' MON',
        },
        tier: tier,
        description: config.description,
        expectedTime: config.expectedTime,
        multiplier: config.multiplier,
      };
    }
    
    return estimates;
  }
  
  /**
   * Calculate detailed cost breakdown
   * @param {bigint} gasLimit - Gas limit
   * @param {bigint} value - Transaction value
   * @returns {object} Cost breakdown
   */
  calculateCostBreakdown(gasLimit, value = 0n) {
    const gasPrice = this.baseGasPrice;
    const gasCost = gasPrice * gasLimit;
    const totalCost = gasCost + value;
    
    return {
      value: {
        wei: value.toString(),
        formatted: formatUnits(value, 18) + ' MON',
      },
      gas: {
        limit: gasLimit.toString(),
        price: gasPrice.toString(),
        cost: gasCost.toString(),
        formatted: formatUnits(gasCost, 18) + ' MON',
      },
      total: {
        wei: totalCost.toString(),
        formatted: formatUnits(totalCost, 18) + ' MON',
      },
      monadSpecific: {
        chargedAmount: gasCost.toString(), // On Monad, charged = gasPrice * gasLimit
        explanation: 'Monad charges gasPrice * gasLimit (not gasUsed)',
      },
    };
  }
  
  /**
   * Detect operation type from transaction parameters
   * @param {object} transaction - Transaction parameters
   * @returns {string} Detected operation type
   */
  detectOperationType(transaction) {
    const { to, data, value } = transaction;
    
    // Simple transfer
    if (!data || data === '0x') {
      return value && value > 0n ? 'TRANSFER_NATIVE' : 'TRANSFER_NATIVE';
    }
    
    // Contract interactions based on target address
    if (to) {
      const targetAddress = to.toLowerCase();
      
      // Uniswap interactions
      if (targetAddress === CONTRACTS.SwapRouter02?.toLowerCase()) {
        if (data.includes('414bf389')) return 'SWAP_EXACT_INPUT'; // exactInputSingle
        if (data.includes('db3e2198')) return 'SWAP_EXACT_OUTPUT'; // exactOutputSingle
        return 'SWAP_EXACT_INPUT'; // Default to input swap
      }
      
      // Token interactions (ERC-20)
      if (data.startsWith('0xa9059cbb')) return 'TRANSFER_ERC20'; // transfer
      if (data.startsWith('0x095ea7b3')) return 'APPROVE_ERC20';  // approve
      
      // Smart account operations
      if (data.length > 200) return 'USER_OPERATION_BASE'; // Complex user operation
    }
    
    // Default fallback
    return 'USER_OPERATION_BASE';
  }
  
  /**
   * Update network conditions for dynamic gas estimation
   */
  async updateNetworkConditions() {
    try {
      // Avoid excessive API calls
      const now = Date.now();
      if (now - this.lastUpdate < 10000) return; // Update max once per 10 seconds
      
      // Get recent block information
      const block = await this.client.publicClient.getBlock();
      
      // Calculate network congestion based on gas usage
      const gasUtilization = Number(block.gasUsed) / Number(block.gasLimit);
      
      if (gasUtilization > 0.8) {
        this.networkCongestion = 'high';
      } else if (gasUtilization > 0.5) {
        this.networkCongestion = 'medium';
      } else {
        this.networkCongestion = 'low';
      }
      
      this.avgBlockGasUsed = block.gasUsed;
      this.lastUpdate = now;
      
      // Store gas history for analysis
      this.gasHistory.push({
        blockNumber: Number(block.number),
        gasUsed: Number(block.gasUsed),
        gasLimit: Number(block.gasLimit),
        utilization: gasUtilization,
        timestamp: now,
      });
      
      // Keep history size manageable
      if (this.gasHistory.length > this.maxHistorySize) {
        this.gasHistory = this.gasHistory.slice(-this.maxHistorySize);
      }
      
    } catch (error) {
      console.warn('Failed to update network conditions:', error.message);
      // Keep previous state on error
    }
  }
  
  /**
   * Get network congestion multiplier
   * @returns {number} Multiplier for gas estimates
   */
  getCongestionMultiplier() {
    switch (this.networkCongestion) {
      case 'high': return 1.3;
      case 'medium': return 1.1;
      case 'low': 
      default: return 1.0;
    }
  }
  
  /**
   * Get gas optimization recommendations
   * @param {bigint} estimatedCost - Estimated gas cost in wei
   * @param {object} context - Context for recommendations
   * @returns {object} Recommendations
   */
  getGasRecommendations(estimatedCost, context = {}) {
    const recommendations = [];
    const warnings = [];
    
    const costMON = Number(formatUnits(estimatedCost, 18));
    
    // Cost-based recommendations
    if (costMON > 1.0) {
      warnings.push('High gas cost detected. Consider using slower tier for non-urgent transactions.');
    }
    
    if (costMON > 0.1) {
      recommendations.push('Consider batching multiple operations to reduce per-operation costs.');
    }
    
    // Network congestion recommendations
    if (this.networkCongestion === 'high') {
      recommendations.push('Network congestion is high. Consider delaying non-urgent transactions.');
      recommendations.push('Use FAST or URGENT tier for time-sensitive operations.');
    }
    
    // Operation-specific recommendations
    if (context.executionCount && context.executionCount > 10) {
      recommendations.push('For strategies with many executions, consider longer intervals to reduce total gas costs.');
    }
    
    return {
      recommendations,
      warnings,
      networkConditions: {
        congestion: this.networkCongestion,
        averageGasUsed: this.avgBlockGasUsed.toString(),
        baseFee: this.baseGasPrice.toString(),
      },
    };
  }
  
  /**
   * Start monitoring gas conditions
   */
  startGasMonitoring() {
    // Update network conditions every 30 seconds
    setInterval(() => {
      this.updateNetworkConditions();
    }, 30000);
    
    // Initial update
    this.updateNetworkConditions();
  }
  
  /**
   * Get gas history for analysis
   * @param {number} blocks - Number of recent blocks to return
   * @returns {array} Gas history data
   */
  getGasHistory(blocks = 10) {
    return this.gasHistory.slice(-blocks);
  }
}

// ===== SINGLETON INSTANCE =====

/**
 * Default gas estimator instance
 */
export const gasEstimator = new MonadGasEstimator();

// ===== UTILITY FUNCTIONS =====

/**
 * Quick gas estimate for common operations
 * @param {string} operation - Operation type
 * @param {object} params - Operation parameters
 * @returns {Promise<string>} Gas limit as string
 */
export const quickGasEstimate = async (operation, params = {}) => {
  try {
    const estimate = await gasEstimator.estimateOperationGas(operation, params);
    return estimate.standard.gasLimit;
  } catch (error) {
    // Fallback to static estimate
    const fallbackGas = OPERATION_GAS_ESTIMATES[operation] || 200000;
    return (BigInt(fallbackGas) * BigInt(120) / BigInt(100)).toString(); // 20% buffer
  }
};

/**
 * Calculate gas cost in MON for display
 * @param {string|bigint} gasLimit - Gas limit
 * @param {string} tier - Gas price tier
 * @returns {string} Formatted gas cost
 */
export const calculateGasCostMON = (gasLimit, tier = 'standard') => {
  try {
    const limit = BigInt(gasLimit);
    const tierConfig = GAS_PRICE_TIERS[tier.toUpperCase()] || GAS_PRICE_TIERS.STANDARD;
    const gasPrice = MONAD_CONFIG.baseFee * BigInt(Math.floor(tierConfig.multiplier * 100)) / BigInt(100);
    const cost = limit * gasPrice;
    
    return formatUnits(cost, 18);
  } catch (error) {
    return '0';
  }
};

/**
 * Validate if user has sufficient MON for gas
 * @param {string} userAddress - User address
 * @param {bigint} gasLimit - Required gas limit
 * @param {bigint} transactionValue - Transaction value
 * @returns {Promise<object>} Validation result
 */
export const validateSufficientGas = async (userAddress, gasLimit, transactionValue = 0n) => {
  try {
    // Get user's MON balance
    const balance = await monadClient.getBalance(userAddress);
    const balanceWei = BigInt(balance.balance);
    
    // Calculate required amount (value + gas cost)
    const gasCost = gasLimit * MONAD_CONFIG.baseFee;
    const totalRequired = transactionValue + gasCost;
    
    const hasSufficient = balanceWei >= totalRequired;
    const shortage = hasSufficient ? 0n : totalRequired - balanceWei;
    
    return {
      hasSufficient,
      balance: balanceWei.toString(),
      required: totalRequired.toString(),
      shortage: shortage.toString(),
      formatted: {
        balance: formatUnits(balanceWei, 18) + ' MON',
        required: formatUnits(totalRequired, 18) + ' MON',
        shortage: shortage > 0n ? formatUnits(shortage, 18) + ' MON' : '0 MON',
      },
    };
    
  } catch (error) {
    throw new Error(`Gas validation failed: ${error.message}`);
  }
};

// ===== EXPORTS =====
export default {
  MonadGasEstimator,
  gasEstimator,
  OPERATION_GAS_ESTIMATES,
  GAS_PRICE_TIERS,
  quickGasEstimate,
  calculateGasCostMON,
  validateSufficientGas,
};