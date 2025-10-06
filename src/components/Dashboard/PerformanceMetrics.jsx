import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useDCAStrategy } from '../../hooks/useDCAStrategy';
import { useMonadBalance } from '../../hooks/useMonadBalance';
import { 
  formatTokenAmount, 
  formatPrice, 
  formatPercentage,
  formatDateTime,
  formatDuration
} from '../../utils/formatters';
import { UI_CONFIG, DCA_CONFIG } from '../../utils/constants';

const PerformanceMetrics = ({ strategyId = null, timeRange = '7d' }) => {
  const { strategies, stats: globalStats, getStrategyPerformanceData } = useDCAStrategy();
  const { balances } = useMonadBalance();

  // 🧭 Time range selector state (moved from props to internal state)
  const [timeRange, setTimeRange] = useState('7d')
  
  const [selectedMetric, setSelectedMetric] = useState('roi');
  const [performanceData, setPerformanceData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Time range options
  const timeRanges = [
    { value: '24h', label: '24 Hours' },
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: 'all', label: 'All Time' }
  ];

  // Metric display options
  const metrics = [
    { 
      key: 'roi', 
      label: 'ROI', 
      description: 'Return on Investment',
      format: (val) => formatPercentage(val / 100, 2, true)
    },
    { 
      key: 'avgPrice', 
      label: 'Avg Price', 
      description: 'Average Execution Price',
      format: (val) => formatPrice(val, 'USD')
    },
    { 
      key: 'slippage', 
      label: 'Avg Slippage', 
      description: 'Average Slippage',
      format: (val) => formatPercentage(val, 2)
    },
    { 
      key: 'gasEfficiency', 
      label: 'Gas Efficiency', 
      description: 'Gas Cost vs Trade Value',
      format: (val) => formatPercentage(val, 2)
    }
  ];

  // Filter strategies by time range
  const filteredStrategies = useMemo(() => {
    if (!strategies) return [];
    
    const now = Date.now();
    const ranges = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      'all': Infinity
    };
    
    const cutoff = now - ranges[timeRange];
    
    if (strategyId) {
      const strategy = strategies.find(s => s.id === strategyId);
      return strategy ? [strategy] : [];
    }
    
    return strategies.filter(s => {
      const createdAt = s.createdAt || now;
      return createdAt >= cutoff;
    });
  }, [strategies, timeRange, strategyId]);

  // Fetch performance data
  useEffect(() => {
    const fetchPerformance = async () => {
      if (filteredStrategies.length === 0) {
        setPerformanceData(null);
        return;
      }

      setIsLoading(true);
      try {
        const allPerformance = await Promise.all(
          filteredStrategies.map(s => getStrategyPerformanceData(s.id))
        );
        
        // Aggregate performance across strategies
        const aggregated = allPerformance.reduce((acc, perf) => {
          if (!perf) return acc;
          
          return {
            totalInvested: acc.totalInvested + (perf.totalInvested || 0),
            totalReceived: acc.totalReceived + (perf.totalReceived || 0),
            totalGasSpent: acc.totalGasSpent + (perf.totalGasSpent || 0),
            totalExecutions: acc.totalExecutions + (perf.executionCount || 0),
            successfulExecutions: acc.successfulExecutions + (perf.successfulExecutions || 0),
            avgSlippage: acc.avgSlippage + (perf.averageSlippage || 0),
            avgPrice: acc.avgPrice + (perf.averagePrice || 0),
            strategies: acc.strategies + 1
          };
        }, {
          totalInvested: 0,
          totalReceived: 0,
          totalGasSpent: 0,
          totalExecutions: 0,
          successfulExecutions: 0,
          avgSlippage: 0,
          avgPrice: 0,
          strategies: 0
        });

        // Calculate averages
        if (aggregated.strategies > 0) {
          aggregated.avgSlippage = aggregated.avgSlippage / aggregated.strategies;
          aggregated.avgPrice = aggregated.avgPrice / aggregated.strategies;
        }

        // Calculate ROI
        const netProfit = aggregated.totalReceived - aggregated.totalInvested - aggregated.totalGasSpent;
        aggregated.roi = aggregated.totalInvested > 0 
          ? (netProfit / aggregated.totalInvested) * 100 
          : 0;

        // Calculate success rate
        aggregated.successRate = aggregated.totalExecutions > 0
          ? (aggregated.successfulExecutions / aggregated.totalExecutions) * 100
          : 0;

        // Calculate gas efficiency
        aggregated.gasEfficiency = aggregated.totalInvested > 0
          ? 100 -((aggregated.totalGasSpent / aggregated.totalInvested) * 100)
          : 0;

        setPerformanceData(aggregated);
      } catch (error) {
        console.error('Failed to fetch performance data:', error);
        setPerformanceData(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPerformance();
  }, [filteredStrategies, getStrategyPerformanceData]);

  // Render metric card
  const renderMetricCard = (metric) => {
    if (!performanceData) return null;

    const value = performanceData[metric.key];
    const isPositive = metric.key === 'roi' ? value > 0 : true;
    const isNegative = metric.key === 'roi' ? value < 0 : false;

    const colorClass = isPositive 
      ? 'text-success' 
      : isNegative 
        ? 'text-error' 
        : 'text-muted';

    return (
      <motion.div
        key={metric.key}
        className="glass-card"
        style={{
          padding: '1.5rem',
          cursor: 'pointer',
          border: selectedMetric === metric.key 
            ? `2px solid ${UI_CONFIG.colors.success}` 
            : `1px solid ${UI_CONFIG.colors.border}`,
          transition: UI_CONFIG.transitions.default
        }}
        onClick={() => setSelectedMetric(metric.key)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <div style={{ marginBottom: '0.5rem', fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)' }}>
          {metric.label}
        </div>
        <div style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.25rem' }} className={colorClass}>
          {metric.format(value || 0)}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>
          {metric.description}
        </div>
      </motion.div>
    );
  };

  // Render performance breakdown
  const renderBreakdown = () => {
    if (!performanceData) return null;

    const breakdownItems = [
      {
        label: 'Total Invested',
        value: formatPrice(performanceData.totalInvested, 'USD'),
        icon: '💰'
      },
      {
        label: 'Total Received',
        value: formatPrice(performanceData.totalReceived, 'USD'),
        icon: '📈'
      },
      {
        label: 'Net Profit/Loss',
        value: formatPrice(
          performanceData.totalReceived - performanceData.totalInvested - performanceData.totalGasSpent,
          'USD'
        ),
        icon: performanceData.roi >= 0 ? '✅' : '❌',
        colored: true
      },
      {
        label: 'Gas Spent',
        value: `${formatTokenAmount(performanceData.totalGasSpent, 18, 4)} MON`,
        icon: '⛽'
      },
      {
        label: 'Total Executions',
        value: performanceData.totalExecutions.toString(),
        icon: '🔄'
      },
      {
        label: 'Success Rate',
        value: formatPercentage(performanceData.successRate / 100, 1),
        icon: '🎯'
      }
    ];

    return (
      <div className="glass-card" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
        <h3 style={{ 
          marginBottom: '1.5rem', 
          fontSize: '1.25rem',
          fontFamily: UI_CONFIG.fonts.primary 
        }}>
          Performance Breakdown
        </h3>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem'
        }}>
          {breakdownItems.map((item, index) => {
            const isProfit = item.colored && performanceData.roi >= 0;
            const isLoss = item.colored && performanceData.roi < 0;
            
            return (
              <div 
                key={index}
                style={{
                  padding: '1rem',
                  background: 'rgba(26, 26, 26, 0.5)',
                  borderRadius: '8px',
                  border: `1px solid ${UI_CONFIG.colors.border}`
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>{item.icon}</span>
                  <span style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)' }}>
                    {item.label}
                  </span>
                </div>
                <div 
                  style={{ 
                    fontSize: '1.25rem', 
                    fontWeight: 'bold',
                    color: isProfit 
                      ? UI_CONFIG.colors.success 
                      : isLoss 
                        ? UI_CONFIG.colors.error 
                        : UI_CONFIG.colors.text
                  }}
                >
                  {item.value}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render empty state
  if (!isLoading && filteredStrategies.length === 0) {
    return (
      <div className="glass-card" style={{ padding: '3rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📊</div>
        <h3 style={{ 
          marginBottom: '0.5rem',
          fontSize: '1.5rem',
          fontFamily: UI_CONFIG.fonts.primary
        }}>
          No Performance Data
        </h3>
        <p style={{ color: 'rgba(255,255,255,0.6)' }}>
          {strategyId 
            ? 'Strategy not found or has no execution history'
            : 'Create a strategy to start tracking performance'}
        </p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      {/* Header with time range selector */}
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
          Performance Metrics
        </h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {timeRanges.map(range => (
            <button
              key={range.value}
              className={timeRange === range.value ? 'btn-primary' : 'btn-secondary'}
              style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
              onClick={() => setTimeRange(range.value)}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="glass-card" style={{ padding: '3rem', textAlign: 'center' }}>
          <div className="spinner-lg" style={{ margin: '0 auto 1rem' }} />
          <p style={{ color: 'rgba(255,255,255,0.6)' }}>Loading performance data...</p>
        </div>
      )}

      {/* Metrics grid */}
      {!isLoading && performanceData && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            {metrics.map(metric => renderMetricCard(metric))}
          </div>

          {/* Performance breakdown */}
          {renderBreakdown()}
        </>
      )}
    </div>
  );
};

export default PerformanceMetrics;