import { useState, useEffect, useCallback, useRef } from 'react';
import { calculateNextExecution, cancelDCAStrategy } from '../services/dca/dcaEngine';
import { formatUnits, parseUnits } from 'viem';
import toast from 'react-hot-toast';

// Services
import { 
  createStrategy,
  startStrategy,
  pauseStrategy,
  resumeStrategy,
  cancelStrategy,
  executeSwap,
  getStrategy,
  getAllStrategies,
  getStrategyPerformance,
  STRATEGY_STATUS,
  EXECUTION_STATUS
} from '../services/dca/dcaEngine';

import { getPrice, getTWAP, subscribeToPrice } from '../services/dca/priceOracle';
import { estimateSwapGas } from '../services/dca/swapExecutor';

// Utils
import { 
  validateDCAStrategy,
  validateDCASchedule,
  validateTokenAmount,
  validateSlippage
} from '../utils/validators';

import {
  formatTokenAmount,
  formatPrice,
  formatDCAFrequency,
  formatDCAStatus,
  formatDateTime,
  formatDuration,
  getTokenInfo
} from '../utils/formatters';

import {
  DCA_CONFIG,
  SUPPORTED_TOKENS,
  ERROR_CODES,
  MONAD_CONFIG
} from '../utils/constants';

/**
 * useDCAStrategy Hook
 * 
 * Manages DCA strategy lifecycle: creation, execution, monitoring, performance tracking.
 * Integrates with smart accounts, delegations, oracles, and swap execution.
 * 
 * @param {Object} smartAccount - Smart account from useSmartAccount
 * @returns {Object} Strategy management interface
 */
export const useDCAStrategy = (smartAccount) => {
  // ===== STATE =====
  const [strategies, setStrategies] = useState([]);
  const [activeStrategy, setActiveStrategy] = useState(null);
  const [executions, setExecutions] = useState([]);
  const [prices, setPrices] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    paused: 0,
    completed: 0,
    totalInvested: 0,
    totalReceived: 0,
    totalGasSpent: 0
  });

  // ===== REFS =====
  const priceSubscriptions = useRef(new Map());
  const refreshInterval = useRef(null);
  const isMounted = useRef(true);

  // ===== COMPUTED STATE =====
  const hasStrategies = strategies.length > 0;
  const hasActiveStrategies = strategies.some(s => s.status === STRATEGY_STATUS.ACTIVE);
  const canCreateStrategy = smartAccount?.isDeployed && !isLoading;

  // ===== INITIALIZATION =====
  useEffect(() => {
    isMounted.current = true;
    
    if (smartAccount?.accountAddress) {
      loadStrategies();
      startRefreshInterval();
    }

    return () => {
      isMounted.current = false;
      stopRefreshInterval();
      cleanupPriceSubscriptions();
    };
  }, [smartAccount?.accountAddress, subscribeToPriceFeed]);

  // ===== STRATEGY LOADING =====
  const loadStrategies = useCallback(async () => {
    if (!smartAccount?.accountAddress) return;

    try {
      setIsLoading(true);
      setError(null);

      const allStrategies = await getAllStrategies(smartAccount.accountAddress);
      
      if (isMounted.current) {
        setStrategies(allStrategies);
        updateStats(allStrategies);
        
        // Subscribe to price feeds for active strategies
        allStrategies
          .filter(s => s.status === STRATEGY_STATUS.ACTIVE)
          .forEach(strategy => {
            subscribeToPriceFeed(strategy.fromToken, strategy.toToken);
          });
      }
    } catch (err) {
      console.error('[useDCAStrategy] Load strategies error:', err);
      if (isMounted.current) {
        setError(err.message);
        toast.error('Failed to load strategies');
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [smartAccount?.accountAddress]);

  // ===== STRATEGY CREATION =====
  const createDCAStrategy = useCallback(async (config) => {
    if (!smartAccount?.accountAddress || !smartAccount?.isDeployed) {
      throw new Error('Smart account must be deployed');
    }

    try {
      setIsLoading(true);
      setError(null);

      // Validate configuration
      const validation = validateDCAStrategy(config);
      if (!validation.isValid) {
        throw new Error(`Invalid strategy: ${validation.errors.join(', ')}`);
      }

      // Validate schedule
      const scheduleValidation = validateDCASchedule(
        config.frequency,
        config.startTime || Date.now()
      );
      if (!scheduleValidation.isValid) {
        throw new Error(`Invalid schedule: ${scheduleValidation.errors.join(', ')}`);
      }

      // Get token info
      const fromToken = getTokenInfo(config.fromToken);
      const toToken = getTokenInfo(config.toToken);

      if (!fromToken || !toToken) {
        throw new Error('Invalid token addresses');
      }

      // Create strategy through DCA engine
      const strategy = await createStrategy(
        {
          ...config,
          smartAccount: smartAccount.accountAddress,
          owner: smartAccount.accountAddress
        },
        {
          autoStart: config.autoStart !== false,
          createDelegation: true,
          encrypt: true
        }
      );

      if (isMounted.current) {
        setStrategies(prev => {
          const newList = [...prev, strategy];
          updateStats(newList);
          return newList;
        });
        setActiveStrategy(strategy);
        
        // Subscribe to price feed
        subscribeToPriceFeed(strategy.fromToken, strategy.toToken);

        toast.success(`Strategy created: ${fromToken.symbol} → ${toToken.symbol}`);
      }

      return strategy;

    } catch (err) {
      console.error('[useDCAStrategy] Create strategy error:', err);
      if (isMounted.current) {
        setError(err.message);
        toast.error(err.message || 'Failed to create strategy');
      }
      throw err;
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [smartAccount, strategies]);

  // ===== STRATEGY CONTROL =====
  const startDCAStrategy = useCallback(async (strategyId) => {
    try {
      setIsLoading(true);
      setError(null);

      const updatedStrategy = await startStrategy(strategyId);

      if (isMounted.current) {
        setStrategies(prev => 
          prev.map(s => s.id === strategyId ? updatedStrategy : s)
        );

        subscribeToPriceFeed(updatedStrategy.fromToken, updatedStrategy.toToken);
        toast.success('Strategy started');
      }

      return updatedStrategy;

    } catch (err) {
      console.error('[useDCAStrategy] Start strategy error:', err);
      if (isMounted.current) {
        setError(err.message);
        toast.error(err.message || 'Failed to start strategy');
      }
      throw err;
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const pauseDCAStrategy = useCallback(async (strategyId, reason) => {
    try {
      setIsLoading(true);
      setError(null);

      const updatedStrategy = await pauseStrategy(strategyId, reason);

      if (isMounted.current) {
        setStrategies(prev => 
          prev.map(s => s.id === strategyId ? updatedStrategy : s)
        );

        toast.success('Strategy paused');
      }

      return updatedStrategy;

    } catch (err) {
      console.error('[useDCAStrategy] Pause strategy error:', err);
      if (isMounted.current) {
        setError(err.message);
        toast.error(err.message || 'Failed to pause strategy');
      }
      throw err;
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const resumeDCAStrategy = useCallback(async (strategyId) => {
    try {
      setIsLoading(true);
      setError(null);

      const updatedStrategy = await resumeStrategy(strategyId);

      if (isMounted.current) {
        setStrategies(prev => 
          prev.map(s => s.id === strategyId ? updatedStrategy : s)
        );

        subscribeToPriceFeed(updatedStrategy.fromToken, updatedStrategy.toToken);
        toast.success('Strategy resumed');
      }

      return updatedStrategy;

    } catch (err) {
      console.error('[useDCAStrategy] Resume strategy error:', err);
      if (isMounted.current) {
        setError(err.message);
        toast.error(err.message || 'Failed to resume strategy');
      }
      throw err;
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const cancelDCAStrategy = useCallback(async (strategyId, reason) => {
    try {
      setIsLoading(true);
      setError(null);

      const updatedStrategy = await cancelStrategy(strategyId, reason);

      if (isMounted.current) {
        setStrategies(prev => 
          prev.map(s => s.id === strategyId ? updatedStrategy : s)
        );

        // Unsubscribe from price feed
        if (updatedStrategy.fromToken && updatedStrategy.toToken) {
          unsubscribeFromPriceFeed(updatedStrategy.fromToken, updatedStrategy.toToken);
        }

        toast.success('Strategy cancelled');
      }

      return updatedStrategy;

    } catch (err) {
      console.error('[useDCAStrategy] Cancel strategy error:', err);
      if (isMounted.current) {
        setError(err.message);
        toast.error(err.message || 'Failed to cancel strategy');
      }
      throw err;
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [strategies]);

  // ===== MANUAL EXECUTION =====
  const executeStrategySwap = useCallback(async (strategyId) => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await executeSwap(strategyId);

      if (isMounted.current) {
        // Reload strategy to get updated state
        const updatedStrategy = await getStrategy(strategyId);
        setStrategies(prev => 
          prev.map(s => s.id === strategyId ? updatedStrategy : s)
        );

        if (result.execution) {
          setExecutions(prev => [result.execution, ...prev].slice(0, 100));
        }

        toast.success('Swap executed successfully');
      }

      return result;

    } catch (err) {
      console.error('[useDCAStrategy] Execute swap error:', err);
      if (isMounted.current) {
        setError(err.message);
        toast.error(err.message || 'Failed to execute swap');
      }
      throw err;
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // ===== PRICE SUBSCRIPTIONS =====
  const subscribeToPriceFeed = useCallback(async (fromToken, toToken) => {
    const pairKey = `${fromToken}-${toToken}`;
    
    if (priceSubscriptions.current.has(pairKey)) {
      return; // Already subscribed
    }

    try {
      const subscription = await subscribeToPrice(
        fromToken,
        toToken,
        (priceData) => {
          if (isMounted.current) {
            setPrices(prev => ({
              ...prev,
              [pairKey]: priceData
            }));
          }
        }
      );

      priceSubscriptions.current.set(pairKey, subscription);

      // Also get initial price
      const initialPrice = await getPrice(fromToken, toToken);
      if (isMounted.current) {
        setPrices(prev => ({
          ...prev,
          [pairKey]: initialPrice
        }));
      }

    } catch (err) {
      console.error('[useDCAStrategy] Price subscription error:', err);
    }
  }, []);

  const unsubscribeFromPriceFeed = useCallback((fromToken, toToken) => {
    const pairKey = `${fromToken}-${toToken}`;
    const subscription = priceSubscriptions.current.get(pairKey);

    if (subscription) {
      subscription.unsubscribe();
      priceSubscriptions.current.delete(pairKey);
    }

    setPrices(prev => {
      const updated = { ...prev };
      delete updated[pairKey];
      return updated;
    });
  }, []);

  const cleanupPriceSubscriptions = useCallback(() => {
    priceSubscriptions.current.forEach(subscription => {
      subscription.unsubscribe();
    });
    priceSubscriptions.current.clear();
    setPrices({});
  }, []);

  // ===== PRICE QUERIES =====
  const getCurrentPrice = useCallback(async (fromToken, toToken) => {
    try {
      const priceData = await getPrice(fromToken, toToken);
      return priceData;
    } catch (err) {
      console.error('[useDCAStrategy] Get price error:', err);
      throw err;
    }
  }, []);

  const getTWAPPrice = useCallback(async (fromToken, toToken, period = 900) => {
    try {
      const twapData = await getTWAP(fromToken, toToken, { period });
      return twapData;
    } catch (err) {
      console.error('[useDCAStrategy] Get TWAP error:', err);
      throw err;
    }
  }, []);

  // ===== PERFORMANCE TRACKING =====
  const getStrategyPerformanceData = useCallback(async (strategyId) => {
    try {
      const performance = await getStrategyPerformance(strategyId);
      return performance;
    } catch (err) {
      console.error('[useDCAStrategy] Get performance error:', err);
      throw err;
    }
  }, []);

  // ===== GAS ESTIMATION =====
  const estimateExecutionGas = useCallback(async (strategyId) => {
    try {
      const strategy = strategies.find(s => s.id === strategyId);
      if (!strategy) {
        throw new Error('Strategy not found');
      }

      const gasEstimate = await estimateSwapGas({
        tokenIn: strategy.fromToken,
        tokenOut: strategy.toToken,
        amountIn: strategy.amountPerExecution,
        slippage: strategy.slippage
      });

      return gasEstimate;

    } catch (err) {
      console.error('[useDCAStrategy] Estimate gas error:', err);
      throw err;
    }
  }, [strategies]);

  // ===== DISPLAY HELPERS =====
  const formatStrategyForDisplay = useCallback((strategy) => {
    const fromToken = getTokenInfo(strategy.fromToken);
    const toToken = getTokenInfo(strategy.toToken);
    const pairKey = `${strategy.fromToken}-${strategy.toToken}`;
    const currentPrice = prices[pairKey];

    const statusInfo = formatDCAStatus(strategy.status, strategy.nextExecutionAt);
    
    return {
      ...strategy,
      fromTokenInfo: fromToken,
      toTokenInfo: toToken,
      formattedAmount: formatTokenAmount(
        strategy.amountPerExecution,
        fromToken?.decimals || 18,
        4
      ),
      formattedFrequency: formatDCAFrequency(strategy.interval),
      formattedNextExecution: strategy.nextExecutionAt 
        ? formatDateTime(strategy.nextExecutionAt)
        : 'Not scheduled',
      timeUntilNext: strategy.nextExecutionAt
        ? formatDuration((strategy.nextExecutionAt - Date.now()) / 1000)
        : null,
      currentPrice: currentPrice ? formatPrice(currentPrice.price) : 'Loading...',
      statusInfo,
      progressPercent: strategy.maxExecutions
        ? (strategy.executionCount / strategy.maxExecutions) * 100
        : 0,
      remainingExecutions: strategy.maxExecutions 
        ? strategy.maxExecutions - strategy.executionCount
        : 'Unlimited'
    };
  }, [prices]);

  // ===== QUERY METHODS =====
  const getStrategyById = useCallback((strategyId) => {
    return strategies.find(s => s.id === strategyId);
  }, [strategies]);

  const getStrategiesByStatus = useCallback((status) => {
    return strategies.filter(s => s.status === status);
  }, [strategies]);

  const getStrategiesByToken = useCallback((tokenAddress) => {
    return strategies.filter(
      s => s.fromToken === tokenAddress || s.toToken === tokenAddress
    );
  }, [strategies]);

  // ===== STATS CALCULATION =====
  const updateStats = useCallback((strategyList) => {
    const stats = {
      total: strategyList.length,
      active: 0,
      paused: 0,
      completed: 0,
      totalInvested: 0,
      totalReceived: 0,
      totalGasSpent: 0
    };

    strategyList.forEach(strategy => {
      if (strategy.status === STRATEGY_STATUS.ACTIVE) stats.active++;
      if (strategy.status === STRATEGY_STATUS.PAUSED) stats.paused++;
      if (strategy.status === STRATEGY_STATUS.COMPLETED) stats.completed++;

      stats.totalInvested += Number(strategy.totalInvested || 0);
      stats.totalReceived += Number(strategy.totalReceived || 0);
      stats.totalGasSpent += Number(strategy.totalGasSpent || 0);
    });

    setStats(stats);
  }, []);

  // ===== AUTO-REFRESH =====
  const startRefreshInterval = useCallback(() => {
    if (refreshInterval.current) return;

    refreshInterval.current = setInterval(() => {
      if (isMounted.current && smartAccount?.accountAddress) {
        loadStrategies();
      }
    }, 30000); // Refresh every 30 seconds
  }, [smartAccount?.accountAddress, loadStrategies]);

  const stopRefreshInterval = useCallback(() => {
    if (refreshInterval.current) {
      clearInterval(refreshInterval.current);
      refreshInterval.current = null;
    }
  }, []);

  // ===== NEXT EXECUTION CALCULATION =====
  const getNextExecutionTime = useCallback((strategyId) => {
    const strategy = strategies.find(s => s.id === strategyId);
    if (!strategy) return null;

    return calculateNextExecution(strategy);
  }, [strategies]);

  // ===== EXPORTS =====
  return {
    // State
    strategies,
    activeStrategy,
    executions,
    prices,
    isLoading,
    error,
    stats,

    // Computed
    hasStrategies,
    hasActiveStrategies,
    canCreateStrategy,

    // Creation
    createDCAStrategy,

    // Control
    startDCAStrategy,
    pauseDCAStrategy,
    resumeDCAStrategy,
    cancelDCAStrategy,

    // Execution
    executeStrategySwap,

    // Price queries
    getCurrentPrice,
    getTWAPPrice,

    // Performance
    getStrategyPerformanceData,

    // Gas
    estimateExecutionGas,

    // Query
    getStrategyById,
    getStrategiesByStatus,
    getStrategiesByToken,
    getNextExecutionTime,

    // Reload
    loadStrategies,

    // Display
    formatStrategyForDisplay,

    // Constants
    STRATEGY_STATUS,
    EXECUTION_STATUS,
    DCA_FREQUENCIES: Object.keys(DCA_CONFIG.schedules)
  };
};

// ===== EXPORTS =====
export default useDCAStrategy;


// Export constants for convenience
export { STRATEGY_STATUS, EXECUTION_STATUS } from '../services/dca/dcaEngine';