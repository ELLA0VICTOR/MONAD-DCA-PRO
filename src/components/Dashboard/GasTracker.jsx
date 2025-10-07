import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useDCAStrategy } from '../../hooks/useDCAStrategy';
import { useMonadBalance } from '../../hooks/useMonadBalance';
import { gasEstimator } from '../../services/monad/gasEstimator';
import { 
  formatTokenAmount,
  formatPrice,
  formatPercentage,
  formatDateTime,
  formatCompactNumber
} from '../../utils/formatters';
import { 
  UI_CONFIG, 
  MONAD_CONFIG, 
  GAS_LIMITS,
  GAS_PRICE_TIERS 
} from '../../utils/constants';

const GasTracker = ({ strategyId = null }) => {
  const { strategies, stats } = useDCAStrategy();
  const { balances } = useMonadBalance();
  
  const [networkGas, setNetworkGas] = useState(null);
  const [gasHistory, setGasHistory] = useState([]);
  const [selectedTier, setSelectedTier] = useState('STANDARD');
  const [isLoading, setIsLoading] = useState(true);

  const [timeRange, setTimeRange] = useState('7d')

  // Time range options
  const timeRanges = [
    { value: '24h', label: '24h', hours: 24 },
    { value: '7d', label: '7d', hours: 168 },
    { value: '30d', label: '30d', hours: 720 }
  ];

  // Filter strategies by time range
  const filteredStrategies = useMemo(() => {
    if (!strategies) return [];
    
    const now = Date.now();
    const range = timeRanges.find(r => r.value === timeRange);
    const cutoff = now - (range.hours * 60 * 60 * 1000);
    
    if (strategyId) {
      const strategy = strategies.find(s => s.id === strategyId);
      return strategy ? [strategy] : [];
    }
    
    return strategies.filter(s => {
      const createdAt = s.createdAt || now;
      return createdAt >= cutoff && s.executionHistory?.length > 0;
    });
  }, [strategies, timeRange, strategyId]);

  // Aggregate gas statistics
  const gasStats = useMemo(() => {
    if (filteredStrategies.length === 0) {
      return {
        totalGasUsed: 0,
        totalGasCost: 0,
        avgGasPerExecution: 0,
        executionCount: 0,
        gasEfficiencyScore: 0,
        estimatedMonthlyCost: 0
      };
    }

    let totalGas = 0;
    let totalCost = 0;
    let executionCount = 0;

    filteredStrategies.forEach(strategy => {
      if (strategy.executionHistory) {
        strategy.executionHistory.forEach(exec => {
          if (exec.gasUsed && exec.status === 'completed') {
            totalGas += exec.gasUsed;
            totalCost += exec.gasCost || Number(BigInt(exec.gasUsed) * BigInt(MONAD_CONFIG.baseFee));
            executionCount++;
          }
        });
      }
    });

    const avgGasPerExecution = executionCount > 0 ? totalGas / executionCount : 0;
    
    // Calculate gas efficiency score (0-100)
    // Lower gas usage relative to baseline = higher score
    const baselineGas = GAS_LIMITS.userOperation;
    const efficiencyRatio = avgGasPerExecution > 0 ? baselineGas / avgGasPerExecution : 1;
    const gasEfficiencyScore = Math.min(100, Math.max(0, efficiencyRatio * 50));

    // Estimate monthly cost based on current usage rate
    const hoursInRange = timeRanges.find(r => r.value === timeRange)?.hours || 168;
    const avgExecutionsPerHour = executionCount / hoursInRange;
    const estimatedMonthlyCost = avgExecutionsPerHour * 24 * 30 * (totalCost / executionCount || 0);

    return {
      totalGasUsed: totalGas,
      totalGasCost: totalCost,
      avgGasPerExecution,
      executionCount,
      gasEfficiencyScore,
      estimatedMonthlyCost
    };
  }, [filteredStrategies, timeRange]);

  // Fetch network gas conditions
  useEffect(() => {
    const fetchNetworkGas = async () => {
      setIsLoading(true);
      try {
        await gasEstimator.updateNetworkConditions();
        const tiers = gasEstimator.calculateGasTiers(GAS_LIMITS.userOperation);
        const history = gasEstimator.getGasHistory(20);
        
        setNetworkGas(tiers);
        setGasHistory(history);
      } catch (error) {
        console.error('Failed to fetch network gas:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchNetworkGas();
    const interval = setInterval(fetchNetworkGas, 30000); // Update every 30s

    return () => clearInterval(interval);
  }, []);

  // Calculate gas trend
  const gasTrend = useMemo(() => {
    if (gasHistory.length < 2) return { direction: 'stable', change: 0 };

    const recent = gasHistory.slice(0, 5);
    const older = gasHistory.slice(5, 10);

    const recentAvg = recent.reduce((sum, h) => sum + (h?.avgGasUsed || 0), 0) / recent.length;
    const olderAvg = older.reduce((sum, h) => sum + h.avgGasUsed, 0) / older.length;

    const change = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

    return {
      direction: change > 5 ? 'rising' : change < -5 ? 'falling' : 'stable',
      change: Math.abs(change)
    };
  }, [gasHistory]);

  // Render gas tier card
  const renderGasTierCard = (tierKey, tierData) => {
    const isSelected = selectedTier === tierKey;
    const tier = GAS_PRICE_TIERS[tierKey];

    return (
      <motion.div
        key={tierKey}
        className="glass-card"
        style={{
          padding: '1rem',
          cursor: 'pointer',
          border: isSelected 
            ? `2px solid ${UI_CONFIG.colors.success}` 
            : `1px solid ${UI_CONFIG.colors.border}`,
          transition: UI_CONFIG.transitions.default
        }}
        onClick={() => setSelectedTier(tierKey)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
          <div>
            <div style={{ 
              fontSize: '1rem', 
              fontWeight: 'bold',
              fontFamily: UI_CONFIG.fonts.primary,
              marginBottom: '0.25rem'
            }}>
              {tier.label}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>
              {tier.description}
            </div>
          </div>
          {isSelected && (
            <div style={{ 
              width: '20px', 
              height: '20px', 
              borderRadius: '50%',
              background: UI_CONFIG.colors.success,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.75rem'
            }}>
              ✓
            </div>
          )}
        </div>

        <div style={{ marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.25rem' }}>
            Gas Price
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
            {formatCompactNumber(Number(tierData.gasPrice) / 1e9)} gwei
          </div>
        </div>

        <div style={{ marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.25rem' }}>
            Estimated Cost
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 'bold', color: UI_CONFIG.colors.success }}>
            {formatTokenAmount(tierData.gasCost, 18, 6)} MON
          </div>
        </div>

        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>
          {tier.confirmationTime}
        </div>
      </motion.div>
    );
  };

  // Render statistics card
  const renderStatsCard = (label, value, icon, subtitle = null, colorClass = '') => (
    <div 
      className="glass-card"
      style={{
        padding: '1.25rem',
        background: 'rgba(26, 26, 26, 0.5)',
        border: `1px solid ${UI_CONFIG.colors.border}`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '1.5rem' }}>{icon}</span>
        <span style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)' }}>
          {label}
        </span>
      </div>
      <div style={{ 
        fontSize: '1.5rem', 
        fontWeight: 'bold',
        marginBottom: subtitle ? '0.25rem' : 0
      }} className={colorClass}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>
          {subtitle}
        </div>
      )}
    </div>
  );

  // Render network status
  const renderNetworkStatus = () => {
    const trendIcon = gasTrend.direction === 'rising' ? '📈' : gasTrend.direction === 'falling' ? '📉' : '➡️';
    const trendColor = gasTrend.direction === 'rising' 
      ? UI_CONFIG.colors.warning 
      : gasTrend.direction === 'falling' 
        ? UI_CONFIG.colors.success 
        : UI_CONFIG.colors.text;

    return (
      <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ 
          marginBottom: '1rem',
          fontSize: '1.25rem',
          fontFamily: UI_CONFIG.fonts.primary,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <span>⛽</span>
          Network Gas Status
        </h3>
        
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' }}>
              Base Fee
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {formatCompactNumber(Number(MONAD_CONFIG.baseFee) / 1e9)} gwei
            </div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.25rem' }}>
              Fixed on testnet
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' }}>
              Gas Trend
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: trendColor, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>{trendIcon}</span>
              {gasTrend.direction.charAt(0).toUpperCase() + gasTrend.direction.slice(1)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.25rem' }}>
              {gasTrend.change > 0 && `${formatPercentage(gasTrend.change / 100, 1)} change`}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' }}>
              Block Time
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {MONAD_CONFIG.blockTime}ms
            </div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.25rem' }}>
              Ultra-fast blocks
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Loading state
  if (isLoading && !networkGas) {
    return (
      <div className="glass-card" style={{ padding: '3rem', textAlign: 'center' }}>
        <div className="spinner-lg" style={{ margin: '0 auto 1rem' }} />
        <p style={{ color: 'rgba(255,255,255,0.6)' }}>Loading gas data...</p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <h2 style={{ 
          fontSize: '1.75rem',
          fontFamily: UI_CONFIG.fonts.primary,
          margin: 0
        }}>
          Gas Tracker
        </h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {timeRanges.map(range => (
            <button
              key={range.value}
              className={timeRange === range.value ? 'btn-primary' : 'btn-secondary'}
              onClick={()=> setTimeRange(range.value)}
              style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {/* Network Status */}
      {renderNetworkStatus()}

      {/* Gas Statistics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem'
      }}>
        {renderStatsCard(
          'Total Gas Used',
          formatCompactNumber(gasStats.totalGasUsed),
          '⛽',
          `${gasStats.executionCount} executions`
        )}
        {renderStatsCard(
          'Total Cost',
          formatTokenAmount(gasStats.totalGasCost, 18, 4) + ' MON',
          '💰',
          `${formatTokenAmount(gasStats.totalGasCost, 18, 4)} MON`

        )}
        {renderStatsCard(
          'Avg Per Execution',
          formatCompactNumber(gasStats.avgGasPerExecution),
          '📊',
          formatTokenAmount(gasStats.executionCount ? gasStats.totalGasCost / gasStats.executionCount : 0, 18, 6)

        )}
        {renderStatsCard(
          'Efficiency Score',
          Math.round(gasStats.gasEfficiencyScore) + '/100',
          '🎯',
          gasStats.gasEfficiencyScore >= 70 ? 'Excellent' : gasStats.gasEfficiencyScore >= 50 ? 'Good' : 'Needs improvement',
          gasStats.gasEfficiencyScore >= 70 ? 'text-success' : gasStats.gasEfficiencyScore >= 50 ? 'text-warning' : 'text-error'
        )}
      </div>

      {/* Gas Price Tiers */}
      {networkGas && (
        <>
          <h3 style={{ 
            fontSize: '1.25rem',
            fontFamily: UI_CONFIG.fonts.primary,
            marginBottom: '1rem'
          }}>
            Current Gas Prices
          </h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            {Object.entries(networkGas).map(([key, data]) => 
              renderGasTierCard(key, data)
            )}
          </div>
        </>
      )}

      {/* Monthly Estimate */}
      {gasStats.executionCount > 0 && (
        <div className="glass-card" style={{ 
          padding: '1.5rem',
          background: `linear-gradient(135deg, rgba(0,255,136,0.1), rgba(26,26,26,0.5))`,
          border: `1px solid ${UI_CONFIG.colors.success}`
        }}>
          <h3 style={{ 
            fontSize: '1.25rem',
            fontFamily: UI_CONFIG.fonts.primary,
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span>📅</span>
            Estimated Monthly Cost
          </h3>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '2.5rem', fontWeight: 'bold', color: UI_CONFIG.colors.success }}>
              {formatTokenAmount(gasStats.estimatedMonthlyCost, 18, 4)}
            </span>
            <span style={{ fontSize: '1.25rem', color: 'rgba(255,255,255,0.8)' }}>
              MON
            </span>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)', margin: 0 }}>
            Based on current usage patterns over the last {timeRange}
          </p>
        </div>
      )}
    </div>
  );
};

export default GasTracker;