import { formatUnits } from 'viem';
import { ORACLE_CONFIG, DCA_CONFIG, MONAD_CONFIG, GAS_LIMITS } from '../../utils/constants.js';

/**
 * AI Decision Engine for DCA Execution
 * Analyzes market conditions using multiple signals to determine:
 * 1. Whether to execute a scheduled DCA swap
 * 2. How much to swap (can reduce amount based on confidence)
 * 3. Reasoning for the decision
 * 
 * Decision Factors:
 * - TWAP divergence (mean reversion signals)
 * - Price data freshness and quality
 * - Market volatility (recent price movements)
 * - Liquidity conditions (price impact)
 * - Gas efficiency (cost vs swap value)
 */

/**
 * Main evaluation function called by dcaEngine.executeSwap()
 * 
 * @param {Object} strategy - DCA strategy config from dcaEngine
 * @param {Object} priceContext - Price data from buildPriceContext()
 * @param {Object} execution - Current execution context
 * @returns {Object} Decision with shouldExecute, confidence, adjustedAmount, reason
 */
export async function evaluateExecution(strategy, priceContext, execution) {
  // Run all analysis checks
  const checks = {
    dataFreshness: checkDataFreshness(priceContext),
    dataQuality: checkDataQuality(priceContext),
    twapSignal: analyzeTWAPSignal(priceContext, strategy),
    volatility: analyzeVolatility(priceContext, strategy),
    liquidity: checkLiquidityConditions(priceContext),
    gasEfficiency: analyzeGasEfficiency(strategy, execution, priceContext)
  };
  
  // Calculate weighted confidence score (0-1)
  const weights = {
    dataFreshness: 0.15,  // Price data must be fresh
    dataQuality: 0.15,    // Need enough historical data
    twapSignal: 0.30,     // Most important: is price favorable?
    volatility: 0.20,     // High volatility = higher risk
    liquidity: 0.10,      // Ensure we can execute without huge slippage
    gasEfficiency: 0.10   // Don't waste money on gas
  };
  
  const score = Object.keys(checks).reduce((sum, key) => {
    return sum + (checks[key].score * weights[key]);
  }, 0);
  
  // Decision threshold: require 65% confidence minimum
  const EXECUTION_THRESHOLD = 0.65;
  const shouldExecute = score >= EXECUTION_THRESHOLD;
  
  // Amount adjustment logic
  let adjustedAmount = execution.swapAmount;
  
  if (shouldExecute) {
    // If confidence is borderline (65-85%), reduce swap amount proportionally
    if (score < 0.85) {
      const adjustmentFactor = Math.floor(score * 100) / 100;
      adjustedAmount = (execution.swapAmount * BigInt(Math.floor(adjustmentFactor * 100))) / 100n;
      
      // Never reduce below 50% of original amount
      const minAmount = execution.swapAmount / 2n;
      if (adjustedAmount < minAmount) {
        adjustedAmount = minAmount;
      }
    }
    // If confidence >= 85%, keep full amount
  } else {
    // If not executing, set amount to 0
    adjustedAmount = 0n;
  }
  
  // Build human-readable reason
  const reason = buildReason(checks, score, shouldExecute);
  
  // Build detailed analysis object
  const analysis = {
    overallScore: score,
    threshold: EXECUTION_THRESHOLD,
    weights,
    checks: Object.keys(checks).reduce((acc, key) => {
      acc[key] = {
        score: checks[key].score,
        weight: weights[key],
        weightedScore: checks[key].score * weights[key],
        status: checks[key].status,
        reason: checks[key].reason,
        details: checks[key].details || {}
      };
      return acc;
    }, {}),
    timestamp: Date.now()
  };
  
  return {
    shouldExecute,
    confidence: score,
    adjustedAmount,
    originalAmount: execution.swapAmount,
    amountAdjustment: shouldExecute ? Number(formatUnits(adjustedAmount, 18)) / Number(formatUnits(execution.swapAmount, 18)) : 0,
    reason,
    analysis
  };
}

// ============================================================================
// CHECK FUNCTIONS
// ============================================================================

/**
 * Check if price data is fresh enough for decision making
 */
function checkDataFreshness(priceContext) {
  const ageMs = priceContext.priceAge;
  const maxAge = ORACLE_CONFIG.maxPriceAge; // 60000ms = 1 minute
  
  if (ageMs > maxAge * 3) {
    return {
      score: 0,
      status: 'critical_stale',
      reason: `Price data critically stale (${(ageMs / 1000).toFixed(0)}s old, max ${(maxAge / 1000)}s)`,
      details: { ageMs, maxAge, ratio: ageMs / maxAge }
    };
  }
  
  if (ageMs > maxAge * 2) {
    return {
      score: 0.3,
      status: 'very_stale',
      reason: `Price data very stale (${(ageMs / 1000).toFixed(0)}s old)`,
      details: { ageMs, maxAge, ratio: ageMs / maxAge }
    };
  }
  
  if (ageMs > maxAge) {
    return {
      score: 0.6,
      status: 'stale',
      reason: `Price data slightly stale (${(ageMs / 1000).toFixed(0)}s old)`,
      details: { ageMs, maxAge, ratio: ageMs / maxAge }
    };
  }
  
  return {
    score: 1.0,
    status: 'fresh',
    reason: `Price data fresh (${(ageMs / 1000).toFixed(0)}s old)`,
    details: { ageMs, maxAge, ratio: ageMs / maxAge }
  };
}

/**
 * Check if we have enough historical data points for TWAP calculation
 */
function checkDataQuality(priceContext) {
  const dataPoints = priceContext.dataPoints || 0;
  
  // Need at least 5 points for meaningful TWAP
  if (dataPoints < 5) {
    return {
      score: 0.2,
      status: 'insufficient',
      reason: `Insufficient data points for TWAP (${dataPoints}/5 minimum)`,
      details: { dataPoints, required: 5 }
    };
  }
  
  // 5-10 points: poor quality
  if (dataPoints < 10) {
    return {
      score: 0.5,
      status: 'poor',
      reason: `Limited data points (${dataPoints}, prefer 15+)`,
      details: { dataPoints, preferred: 15 }
    };
  }
  
  // 10-15 points: fair quality
  if (dataPoints < 15) {
    return {
      score: 0.75,
      status: 'fair',
      reason: `Fair data points (${dataPoints})`,
      details: { dataPoints }
    };
  }
  
  // 15+ points: good quality
  return {
    score: 1.0,
    status: 'good',
    reason: `Sufficient data points (${dataPoints})`,
    details: { dataPoints }
  };
}

/**
 * Analyze TWAP divergence to find favorable entry points
 * 
 * TWAP Strategy (for buying/DCA):
 * - Spot < TWAP = Favorable (buying at discount vs average)
 * - Spot > TWAP = Unfavorable (buying at premium)
 * - Extreme divergence (>5%) = Suspicious (may be oracle issue)
 */
function analyzeTWAPSignal(priceContext, strategy) {
  const divergence = priceContext.twapDivergence; // percentage
  
  // For DCA strategies, we're typically buying (accumulating)
  const isBuying = true;
  
  if (isBuying) {
    // Extreme negative divergence: spot WAY below TWAP
    // Could be oracle error or flash crash - be cautious
    if (divergence < -10) {
      return {
        score: 0.2,
        status: 'extreme_anomaly',
        reason: `Spot ${divergence.toFixed(2)}% below TWAP (possible oracle error)`,
        details: { divergence, twapSpot: 'extreme_divergence' }
      };
    }
    
    // Large negative divergence: -5% to -10%
    // Very favorable but verify it's real
    if (divergence < -5) {
      return {
        score: 0.7,
        status: 'very_favorable_cautious',
        reason: `Spot ${divergence.toFixed(2)}% below TWAP (verify not anomaly)`,
        details: { divergence, twapSpot: 'large_discount' }
      };
    }
    
    // Moderate negative divergence: -2% to -5%
    // Excellent entry point (mean reversion opportunity)
    if (divergence < -2) {
      return {
        score: 1.0,
        status: 'very_favorable',
        reason: `Spot ${divergence.toFixed(2)}% below TWAP (excellent entry)`,
        details: { divergence, twapSpot: 'discount' }
      };
    }
    
    // Small negative divergence: -0.5% to -2%
    // Good entry point
    if (divergence < -0.5) {
      return {
        score: 0.9,
        status: 'favorable',
        reason: `Spot ${divergence.toFixed(2)}% below TWAP (good entry)`,
        details: { divergence, twapSpot: 'small_discount' }
      };
    }
    
    // Near TWAP: -0.5% to +0.5%
    // Neutral - fair price
    if (divergence < 0.5) {
      return {
        score: 0.75,
        status: 'neutral',
        reason: `Spot near TWAP (${divergence.toFixed(2)}% divergence)`,
        details: { divergence, twapSpot: 'fair_value' }
      };
    }
    
    // Small positive divergence: +0.5% to +2%
    // Slightly unfavorable
    if (divergence < 2) {
      return {
        score: 0.6,
        status: 'slightly_unfavorable',
        reason: `Spot ${divergence.toFixed(2)}% above TWAP (minor premium)`,
        details: { divergence, twapSpot: 'small_premium' }
      };
    }
    
    // Moderate positive divergence: +2% to +5%
    // Unfavorable - buying at premium
    if (divergence < 5) {
      return {
        score: 0.4,
        status: 'unfavorable',
        reason: `Spot ${divergence.toFixed(2)}% above TWAP (significant premium)`,
        details: { divergence, twapSpot: 'premium' }
      };
    }
    
    // Large positive divergence: >5%
    // Very unfavorable - wait for better price
    return {
      score: 0.2,
      status: 'very_unfavorable',
      reason: `Spot ${divergence.toFixed(2)}% above TWAP (avoid execution)`,
      details: { divergence, twapSpot: 'large_premium' }
    };
  }
  
  // Fallback for other strategy types
  return {
    score: 0.7,
    status: 'neutral',
    reason: 'TWAP analysis neutral',
    details: { divergence }
  };
}

/**
 * Analyze recent price volatility
 * High volatility = higher risk = lower confidence
 */
function analyzeVolatility(priceContext, strategy) {
  const volatility = priceContext.volatility; // percentage change
  const maxSlippage = strategy.config.maxSlippage * 100; // convert to percentage
  
  // Extreme volatility: >10%
  // Market is chaotic, avoid execution
  if (volatility > 10) {
    return {
      score: 0.2,
      status: 'extreme',
      reason: `Extreme volatility (${volatility.toFixed(2)}%, avoid execution)`,
      details: { volatility, maxSlippage, ratio: volatility / maxSlippage }
    };
  }
  
  // High volatility: 5-10%
  // Risky conditions
  if (volatility > 5) {
    return {
      score: 0.5,
      status: 'high',
      reason: `High volatility (${volatility.toFixed(2)}%, risky conditions)`,
      details: { volatility, maxSlippage, ratio: volatility / maxSlippage }
    };
  }
  
  // Moderate volatility: 2-5%
  // Acceptable but monitor closely
  if (volatility > 2) {
    return {
      score: 0.8,
      status: 'moderate',
      reason: `Moderate volatility (${volatility.toFixed(2)}%)`,
      details: { volatility, maxSlippage }
    };
  }
  
  // Low volatility: <2%
  // Stable conditions, favorable for execution
  return {
    score: 1.0,
    status: 'low',
    reason: `Low volatility (${volatility.toFixed(2)}%, stable market)`,
    details: { volatility, maxSlippage }
  };
}

/**
 * Check liquidity conditions and price impact
 */
function checkLiquidityConditions(priceContext) {
  // Check if pool has sufficient liquidity
  if (!priceContext.hasLiquidity) {
    return {
      score: 0,
      status: 'no_liquidity',
      reason: 'No liquidity available in pool',
      details: { hasLiquidity: false }
    };
  }
  
  const priceImpact = priceContext.priceImpactEstimate || 0;
  
  // Very high impact: >5%
  if (priceImpact > 5) {
    return {
      score: 0.2,
      status: 'very_low_liquidity',
      reason: `Very high price impact (${priceImpact.toFixed(2)}%)`,
      details: { priceImpact, threshold: 5 }
    };
  }
  
  // High impact: 2-5%
  if (priceImpact > 2) {
    return {
      score: 0.5,
      status: 'low_liquidity',
      reason: `High price impact (${priceImpact.toFixed(2)}%)`,
      details: { priceImpact, threshold: 2 }
    };
  }
  
  // Moderate impact: 1-2%
  if (priceImpact > 1) {
    return {
      score: 0.8,
      status: 'fair_liquidity',
      reason: `Moderate price impact (${priceImpact.toFixed(2)}%)`,
      details: { priceImpact, threshold: 1 }
    };
  }
  
  // Low impact: <1%
  return {
    score: 1.0,
    status: 'good_liquidity',
    reason: `Low price impact (${priceImpact.toFixed(2)}%)`,
    details: { priceImpact }
  };
}

/**
 * Analyze gas efficiency
 * Don't execute if gas cost is too high relative to swap value
 */
function analyzeGasEfficiency(strategy, execution, priceContext) {
  // Estimate gas cost in MON
  const gasLimit = GAS_LIMITS.singleSwap;
  const baseFee = MONAD_CONFIG.baseFee;
  const gasCostWei = BigInt(gasLimit) * baseFee;
  const gasCostMON = Number(formatUnits(gasCostWei, 18));
  
  // Estimate swap value in USD
  // Use spot price to convert input amount to USD
  const spotPriceUSD = Number(formatUnits(priceContext.spot, 18));
  const swapAmountTokens = Number(formatUnits(execution.swapAmount, strategy.config.tokenInDecimals || 18));
  const swapValueUSD = swapAmountTokens * spotPriceUSD;
  
  // Get MON/USD from priceContext (fetched via oracle in priceOracle.js)
  const monPriceUSD = Number(formatUnits(priceContext.monUsdPrice, 18));
  const gasCostUSD = gasCostMON * monPriceUSD;
  
  // Calculate gas cost as percentage of swap value
  const gasRatio = swapValueUSD > 0 ? gasCostUSD / swapValueUSD : 1;
  
  // Gas cost >10% of swap value: very inefficient
  if (gasRatio > 0.10) {
    return {
      score: 0.2,
      status: 'very_inefficient',
      reason: `Gas cost ${(gasRatio * 100).toFixed(1)}% of swap value (too expensive)`,
      details: { gasCostUSD, swapValueUSD, gasRatio, gasCostMON }
    };
  }
  
  // Gas cost 5-10%: inefficient
  if (gasRatio > 0.05) {
    return {
      score: 0.5,
      status: 'inefficient',
      reason: `Gas cost ${(gasRatio * 100).toFixed(1)}% of swap value (expensive)`,
      details: { gasCostUSD, swapValueUSD, gasRatio, gasCostMON }
    };
  }
  
  // Gas cost 2-5%: acceptable
  if (gasRatio > 0.02) {
    return {
      score: 0.8,
      status: 'acceptable',
      reason: `Gas cost ${(gasRatio * 100).toFixed(1)}% of swap value`,
      details: { gasCostUSD, swapValueUSD, gasRatio, gasCostMON }
    };
  }
  
  // Gas cost <2%: efficient
  return {
    score: 1.0,
    status: 'efficient',
    reason: `Gas cost ${(gasRatio * 100).toFixed(1)}% of swap value (efficient)`,
    details: { gasCostUSD, swapValueUSD, gasRatio, gasCostMON }
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Build human-readable reason for decision
 */
function buildReason(checks, score, shouldExecute) {
  const scorePercent = (score * 100).toFixed(1);
  
  if (!shouldExecute) {
    // Find the check with the lowest score (biggest problem)
    const sortedChecks = Object.entries(checks)
      .sort((a, b) => a[1].score - b[1].score);
    
    const worstCheck = sortedChecks[0];
    const worstCheckName = worstCheck[0];
    const worstCheckData = worstCheck[1];
    
    // Build failure message
    return `❌ Execution rejected (${scorePercent}% confidence, need 65%+). Primary issue: ${worstCheckName} - ${worstCheckData.reason}`;
  }
  
  // Execution approved - highlight the best signal
  const sortedChecks = Object.entries(checks)
    .sort((a, b) => b[1].score - a[1].score);
  
  const bestCheck = sortedChecks[0];
  const bestCheckName = bestCheck[0];
  const bestCheckData = bestCheck[1];
  
  // Build success message with confidence level
  let confidenceLevel;
  if (score >= 0.90) confidenceLevel = 'Very High';
  else if (score >= 0.80) confidenceLevel = 'High';
  else if (score >= 0.70) confidenceLevel = 'Good';
  else confidenceLevel = 'Acceptable';
  
  return `✅ Execution approved (${scorePercent}% confidence - ${confidenceLevel}). Primary signal: ${bestCheckName} - ${bestCheckData.reason}`;
}

/**
 * Helper function to get detailed explanation of a decision
 * Useful for debugging and transparency
 */
export function explainDecision(decision) {
  const { analysis, shouldExecute, confidence, reason } = decision;
  
  const explanation = {
    summary: reason,
    decision: shouldExecute ? 'EXECUTE' : 'SKIP',
    confidence: `${(confidence * 100).toFixed(1)}%`,
    breakdown: Object.entries(analysis.checks).map(([name, check]) => ({
      factor: name,
      score: `${(check.score * 100).toFixed(0)}%`,
      weight: `${(check.weight * 100).toFixed(0)}%`,
      contribution: `${(check.weightedScore * 100).toFixed(1)}%`,
      status: check.status,
      reason: check.reason
    })),
    timestamp: new Date(analysis.timestamp).toISOString()
  };
  
  return explanation;
}

// Export main function and utilities
export default evaluateExecution;