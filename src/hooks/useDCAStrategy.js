import { useState, useEffect, useCallback, useRef } from 'react';
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

import { estimateSwapGas } from '../services/dca/swapExecutor';

// Utils
import { 
  validateDCAStrategy,
  validateDCASchedule,
  validateTokenAmount
} from '../utils/validators';

import {
  formatTokenAmount,
  formatDCAFrequency,
  formatDCAStatus,
  formatDateTime,
  formatDuration,
  getTokenInfo
} from '../utils/formatters';

import {
  DCA_CONFIG,
  SWAP_INTERVALS,
  ERROR_CODES
} from '../utils/constants';

/**
 * useDCAStrategy Hook
 * 
 * Manages DCA strategy lifecycle (NO ORACLE/PRICE FEEDS)
 * 
 * @param {Object} smartAccount - Smart account from useSmartAccount
 * @returns {Object} Strategy management interface
 */
export const useDCAStrategy = (smartAccount) => {
  // ===== STATE =====
  const [strategies, setStrategies] = useState([]);
  const [activeStrategy, setActiveStrategy] = useState(null);
  const [executions, setExecutions] = useState([]);
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
  const refreshInterval = useRef(null);
  const isMounted = useRef(true);

  // ===== COMPUTED STATE =====
  const hasStrategies = strategies.length > 0;
  const hasActiveStrategies = strategies.some(s => s.state?.status === STRATEGY_STATUS.ACTIVE);
  const canCreateStrategy = smartAccount?.isDeployed && !isLoading;

  // ===== STRATEGY LOADING =====
  const loadStrategies = useCallback(async () => {
    if (!smartAccount?.accountAddress) return;

    try {
      setIsLoading(true);
      setError(null);

      const result = await getAllStrategies({
        smartAccount: smartAccount.accountAddress
      }, {
        includePerformance: true
      });
      
      if (isMounted.current) {
        const allStrategies = result?.strategies || [];
        setStrategies(allStrategies);
        updateStats(allStrategies);
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
      const intervalConfig = SWAP_INTERVALS[config.interval?.toUpperCase()];
      if (!intervalConfig) {
        throw new Error('Invalid swap interval');
      }

      // Get token info
      const fromToken = getTokenInfo(config.fromToken);
      const toToken = getTokenInfo(config.toToken);

      if (!fromToken || !toToken) {
        throw new Error('Invalid token addresses');
      }

      // Create strategy through DCA engine
      const result = await createStrategy(
        {
          ...config,
          smartAccount: smartAccount.accountAddress,
          owner: smartAccount.accountAddress,
          tokenInDecimals: fromToken.decimals,
          tokenOutDecimals: toToken.decimals
        },
        {
          autoStart: config.autoStart !== false,
          createDelegation: true,
          encrypt: true
        }
      );

      if (isMounted.current && result.success) {
        const newStrategy = result.strategy;
        setStrategies(prev => {
          const newList = [...prev, newStrategy];
          updateStats(newList);
          return newList;
        });
        setActiveStrategy(newStrategy);

        toast.success(`Strategy created: ${fromToken.symbol} → ${toToken.symbol}`);
      }

      return result.strategy;

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

      const result = await startStrategy(strategyId);

      if (isMounted.current && result.success) {
        // Reload strategy to get updated state
        const updatedStrategy = await getStrategy(strategyId);
        setStrategies(prev => 
          prev.map(s => s.id === strategyId ? updatedStrategy : s)
        );

        toast.success('Strategy started');
      }

      return result;

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

      const result = await pauseStrategy(strategyId, reason);

      if (isMounted.current && result.success) {
        const updatedStrategy = await getStrategy(strategyId);
        setStrategies(prev => 
          prev.map(s => s.id === strategyId ? updatedStrategy : s)
        );

        toast.success('Strategy paused');
      }

      return result;

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

      const result = await resumeStrategy(strategyId);

      if (isMounted.current && result.success) {
        const updatedStrategy = await getStrategy(strategyId);
        setStrategies(prev => 
          prev.map(s => s.id === strategyId ? updatedStrategy : s)
        );

        toast.success('Strategy resumed');
      }

      return result;

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

      const result = await cancelStrategy(strategyId, reason);

      if (isMounted.current && result.success) {
        const updatedStrategy = await getStrategy(strategyId);
        setStrategies(prev => 
          prev.map(s => s.id === strategyId ? updatedStrategy : s)
        );

        toast.success('Strategy cancelled');
      }

      return result;

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
  }, []);

  // ===== MANUAL EXECUTION =====
  const executeStrategySwap = useCallback(async (strategyId) => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await executeSwap(strategyId);

      if (isMounted.current && result.success) {
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
        tokenIn: strategy.config.tokenIn,
        tokenOut: strategy.config.tokenOut,
        amountIn: parseUnits(
          strategy.config.swapAmount.toString(), 
          strategy.config.tokenInDecimals || 18
        ),
        tokenInDecimals: strategy.config.tokenInDecimals || 18,
        tokenOutDecimals: strategy.config.tokenOutDecimals || 18
      });

      return gasEstimate;

    } catch (err) {
      console.error('[useDCAStrategy] Estimate gas error:', err);
      throw err;
    }
  }, [strategies]);

  // ===== DISPLAY HELPERS =====
  const formatStrategyForDisplay = useCallback((strategy) => {
    const fromToken = getTokenInfo(strategy.config?.tokenIn);
    const toToken = getTokenInfo(strategy.config?.tokenOut);
    const intervalConfig = SWAP_INTERVALS[strategy.config?.interval?.toUpperCase()];

    const statusInfo = formatDCAStatus(
      strategy.state?.status, 
      strategy.state?.nextExecutionAt
    );
    
    return {
      ...strategy,
      fromTokenInfo: fromToken,
      toTokenInfo: toToken,
      formattedAmount: formatTokenAmount(
        strategy.config?.swapAmount || 0,
        fromToken?.decimals || 18,
        4
      ),
      formattedFrequency: intervalConfig?.label || 'Unknown',
      formattedNextExecution: strategy.state?.nextExecutionAt 
        ? formatDateTime(strategy.state.nextExecutionAt)
        : 'Not scheduled',
      timeUntilNext: strategy.state?.nextExecutionAt
        ? formatDuration((strategy.state.nextExecutionAt - Date.now()) / 1000)
        : null,
      statusInfo,
      progressPercent: strategy.config?.maxExecutions
        ? ((strategy.state?.totalExecutions || 0) / strategy.config.maxExecutions) * 100
        : 0,
      remainingExecutions: strategy.config?.maxExecutions 
        ? strategy.config.maxExecutions - (strategy.state?.totalExecutions || 0)
        : 'Unlimited'
    };
  }, []);

  // ===== QUERY METHODS =====
  const getStrategyById = useCallback((strategyId) => {
    return strategies.find(s => s.id === strategyId);
  }, [strategies]);

  const getStrategiesByStatus = useCallback((status) => {
    return strategies.filter(s => s.state?.status === status);
  }, [strategies]);

  const getStrategiesByToken = useCallback((tokenAddress) => {
    return strategies.filter(
      s => s.config?.tokenIn === tokenAddress || s.config?.tokenOut === tokenAddress
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
      if (strategy.state?.status === STRATEGY_STATUS.ACTIVE) stats.active++;
      if (strategy.state?.status === STRATEGY_STATUS.PAUSED) stats.paused++;
      if (strategy.state?.status === STRATEGY_STATUS.COMPLETED) stats.completed++;

      stats.totalInvested += Number(strategy.state?.totalInvested || 0);
      stats.totalReceived += Number(strategy.state?.totalReceived || 0);
      stats.totalGasSpent += Number(strategy.metadata?.gasSpent || 0);
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
    };
  }, [smartAccount?.accountAddress, loadStrategies, startRefreshInterval, stopRefreshInterval]);

  

  // ===== EXPORTS =====
  return {
    // State
    strategies,
    activeStrategy,
    executions,
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

    // Performance
    getStrategyPerformanceData,

    // Gas
    estimateExecutionGas,

    // Query
    getStrategyById,
    getStrategiesByStatus,
    getStrategiesByToken,

    // Reload
    loadStrategies,

    // Display
    formatStrategyForDisplay,

    // Constants
    STRATEGY_STATUS,
    EXECUTION_STATUS,
    SWAP_INTERVALS: Object.keys(SWAP_INTERVALS)
  };
};

// ===== EXPORTS =====
export default useDCAStrategy;

// Export constants for convenience
export { STRATEGY_STATUS, EXECUTION_STATUS } from '../services/dca/dcaEngine';