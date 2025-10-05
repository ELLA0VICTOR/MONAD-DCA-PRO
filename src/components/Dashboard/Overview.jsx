import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { useDCAStrategy } from '../../hooks/useDCAStrategy';
import { useMonadBalance } from '../../hooks/useMonadBalance';
import { 
  formatTokenAmount, 
  formatPrice,
  formatPercentage,
  formatDateTime
} from '../../utils/formatters';
import { 
  UI_CONFIG, 
  MONAD_CONFIG,
  SUPPORTED_TOKENS 
} from '../../utils/constants';

const Overview = () => {
  // Hooks
  const { smartAccount, accountAddress, isDeployed, balance } = useSmartAccount();
  const { strategies, stats, isLoading: strategiesLoading } = useDCAStrategy();
  const { balances, totalBalanceUSD } = useMonadBalance(accountAddress);

  // Calculate portfolio metrics
  const portfolioMetrics = useMemo(() => {
    if (!stats) {
      return {
        totalInvested: 0,
        totalReceived: 0,
        totalGasSpent: 0,
        roi: 0,
        roiPercent: 0,
        activeStrategies: 0,
        totalExecutions: 0,
      };
    }

    const totalInvested = stats.totalInvested || 0;
    const totalReceived = stats.totalReceived || 0;
    const totalGasSpent = stats.totalGasSpent || 0;
    const roi = totalReceived - totalInvested - totalGasSpent;
    const roiPercent = parseFloat(((roi / totalInvested) * 100).toFixed(2));

    return {
      totalInvested,
      totalReceived,
      totalGasSpent,
      roi,
      roiPercent,
      activeStrategies: strategies.filter(s => s.status === 'active').length,
      totalExecutions: stats.totalExecutions || 0,
    };
  }, [stats, strategies]);

  // Get recent activity
  const recentActivity = useMemo(() => {
    const allExecutions = strategies.flatMap(s => 
      (s.executionHistory || []).map(exec => ({
        ...exec,
        strategyId: s.id,
        strategyName: `${s.fromToken.symbol} → ${s.toToken.symbol}`,
      }))
    );

    return allExecutions
      .sort((a, b) => b.executedAt - a.executedAt)
      .slice(0, 5);
  }, [strategies]);

  // Network status
  const networkStatus = useMemo(() => ({
    chainId: MONAD_CONFIG.chainId,
    name: MONAD_CONFIG.name,
    blockTime: MONAD_CONFIG.blockTime,
    baseFee: MONAD_CONFIG.baseFee,
  }), []);

  // Render metric card
  const renderMetricCard = (label, value, subValue, colorClass = '', trend = null) => (
    <motion.div
      style={styles.metricCard}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      whileHover={{ scale: 1.02 }}
    >
      <div style={styles.metricLabel}>{label}</div>
      <div style={{ ...styles.metricValue, ...(colorClass && { color: UI_CONFIG.colors[colorClass] }) }}>
        {value}
      </div>
      {subValue && (
        <div style={styles.metricSub}>{subValue}</div>
      )}
      {trend !== null && (
        <div style={{
          ...styles.metricTrend,
          color: trend >= 0 ? UI_CONFIG.colors.success : UI_CONFIG.colors.error
        }}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(2)}%
        </div>
      )}
    </motion.div>
  );

  // Render account status
  const renderAccountStatus = () => (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Account Status</h3>
      <div style={styles.accountCard}>
        <div style={styles.accountRow}>
          <span style={styles.accountLabel}>Smart Account:</span>
          <span style={styles.accountValue}>
            {accountAddress ? (
              <>
                {accountAddress.slice(0, 6)}...{accountAddress.slice(-4)}
                {isDeployed && (
                  <span style={styles.deployedBadge}>Deployed</span>
                )}
              </>
            ) : (
              'Not Connected'
            )}
          </span>
        </div>
        <div style={styles.accountRow}>
          <span style={styles.accountLabel}>Network:</span>
          <span style={styles.accountValue}>
            {networkStatus.name}
            <span style={styles.networkDot} />
          </span>
        </div>
        <div style={styles.accountRow}>
          <span style={styles.accountLabel}>MON Balance:</span>
          <span style={styles.accountValue}>
            {balance ? `${balance.displayValue} MON` : '0.0 MON'}
          </span>
        </div>
        <div style={styles.accountRow}>
          <span style={styles.accountLabel}>Portfolio Value:</span>
          <span style={styles.accountValue}>
            ${totalBalanceUSD ? formatPrice(totalBalanceUSD) : '0.00'}
          </span>
        </div>
      </div>
    </div>
  );

  // Render portfolio metrics
  const renderPortfolioMetrics = () => (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Portfolio Performance</h3>
      <div style={styles.metricsGrid}>
        {renderMetricCard(
          'Total Invested',
          `${portfolioMetrics.totalInvested.toFixed(4)} MON`,
          'Across all strategies'
        )}
        {renderMetricCard(
          'Total Received',
          `${portfolioMetrics.totalReceived.toFixed(4)} tokens`,
          'Total output amount'
        )}
        {renderMetricCard(
          'ROI',
          formatPercentage(portfolioMetrics.roiPercent / 100),
          `${portfolioMetrics.roi >= 0 ? '+' : ''}${portfolioMetrics.roi.toFixed(4)} MON`,
          portfolioMetrics.roi >= 0 ? 'success' : 'error',
          portfolioMetrics.roiPercent
        )}
        {renderMetricCard(
          'Total Gas Spent',
          `${portfolioMetrics.totalGasSpent.toFixed(6)} MON`,
          'Execution costs'
        )}
        {renderMetricCard(
          'Active Strategies',
          portfolioMetrics.activeStrategies.toString(),
          `${strategies.length} total`
        )}
        {renderMetricCard(
          'Total Executions',
          portfolioMetrics.totalExecutions.toString(),
          'Completed swaps'
        )}
      </div>
    </div>
  );

  // Render token balances
  const renderTokenBalances = () => (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Token Balances</h3>
      <div style={styles.balanceList}>
        {SUPPORTED_TOKENS.map(token => {
          const tokenBalance = balances[token.symbol];
          return (
            <div key={token.address} style={styles.balanceRow}>
              <div style={styles.balanceLeft}>
                <div style={styles.tokenIcon}>
                  {token.isNative ? 'M' : token.symbol[0]}
                </div>
                <div style={styles.tokenInfo}>
                  <div style={styles.tokenSymbol}>{token.symbol}</div>
                  <div style={styles.tokenName}>{token.name}</div>
                </div>
              </div>
              <div style={styles.balanceRight}>
                {tokenBalance ? (
                  <>
                    <div style={styles.balanceAmount}>
                      {tokenBalance.formatted}
                    </div>
                    {tokenBalance.usdValue && (
                      <div style={styles.balanceUsd}>
                        ${formatPrice(tokenBalance.usdValue)}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={styles.balanceAmount}>0.0</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // Render recent activity
  const renderRecentActivity = () => (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Recent Activity</h3>
      {recentActivity.length > 0 ? (
        <div style={styles.activityList}>
          {recentActivity.map((activity, index) => (
            <motion.div
              key={`${activity.strategyId}-${activity.executedAt}-${index}`}
              style={styles.activityRow}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: index * 0.05 }}
            >
              <div style={{
                ...styles.activityStatus,
                background: activity.status === 'completed' 
                  ? UI_CONFIG.colors.success 
                  : activity.status === 'failed'
                  ? UI_CONFIG.colors.error
                  : UI_CONFIG.colors.warning
              }}>
                {activity.status === 'completed' ? '✓' : activity.status === 'failed' ? '✕' : '⊘'}
              </div>
              <div style={styles.activityInfo}>
                <div style={styles.activityName}>{activity.strategyName}</div>
                <div style={styles.activityTime}>
                  {formatDateTime(activity.executedAt, { format: 'short' })}
                </div>
              </div>
              <div style={styles.activityAmount}>
                {activity.amountIn && (
                  <>
                    {formatTokenAmount(activity.amountIn, activity.fromToken?.decimals || 18, 4)}
                    {activity.status === 'completed' && activity.amountOut && (
                      <div style={styles.activityAmountOut}>
                        → {formatTokenAmount(activity.amountOut, activity.toToken?.decimals || 18, 4)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📊</div>
          <div style={styles.emptyText}>No recent activity</div>
        </div>
      )}
    </div>
  );

  // Render quick stats
  const renderQuickStats = () => (
    <div style={styles.quickStats}>
      <div style={styles.quickStat}>
        <div style={styles.quickStatLabel}>Avg Slippage</div>
        <div style={styles.quickStatValue}>
          {stats?.avgSlippage ? formatPercentage(stats.avgSlippage) : '0.00%'}
        </div>
      </div>
      <div style={styles.quickStat}>
        <div style={styles.quickStatLabel}>Success Rate</div>
        <div style={styles.quickStatValue}>
          {stats?.successRate ? `${stats.successRate.toFixed(1)}%` : '0.0%'}
        </div>
      </div>
      <div style={styles.quickStat}>
        <div style={styles.quickStatLabel}>Avg Gas/Exec</div>
        <div style={styles.quickStatValue}>
          {stats?.avgGasPerExecution 
            ? `${stats.avgGasPerExecution.toFixed(5)} MON` 
            : '0.00000 MON'
          }
        </div>
      </div>
    </div>
  );

  // Main render
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Dashboard Overview</h2>
        <div style={styles.subtitle}>
          Monitor your DCA strategies and portfolio performance
        </div>
      </div>

      {strategiesLoading ? (
        <div style={styles.loadingContainer}>
          <div className="spinner spinner-lg" />
          <div style={styles.loadingText}>Loading dashboard...</div>
        </div>
      ) : (
        <>
          {renderQuickStats()}
          {renderAccountStatus()}
          {renderPortfolioMetrics()}
          
          <div style={styles.gridLayout}>
            <div style={styles.gridLeft}>
              {renderTokenBalances()}
            </div>
            <div style={styles.gridRight}>
              {renderRecentActivity()}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// Styles
const styles = {
  container: {
    width: '100%',
    padding: '2rem',
  },
  header: {
    marginBottom: '2rem',
  },
  title: {
    margin: 0,
    marginBottom: '0.5rem',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '2rem',
    color: UI_CONFIG.colors.text,
  },
  subtitle: {
    margin: 0,
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  quickStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem',
  },
  quickStat: {
    padding: '1rem',
    background: `linear-gradient(135deg, ${UI_CONFIG.colors.success}20, ${UI_CONFIG.colors.success}10)`,
    border: `1px solid ${UI_CONFIG.colors.success}`,
    borderRadius: '8px',
    textAlign: 'center',
  },
  quickStatLabel: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: '0.5rem',
  },
  quickStatValue: {
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.success,
  },
  section: {
    marginBottom: '2rem',
  },
  sectionTitle: {
    margin: 0,
    marginBottom: '1rem',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.25rem',
    color: UI_CONFIG.colors.text,
  },
  accountCard: {
    padding: '1.5rem',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '12px',
  },
  accountRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 0',
    borderBottom: `1px solid ${UI_CONFIG.colors.border}`,
  },
  accountLabel: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  accountValue: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  deployedBadge: {
    padding: '0.125rem 0.5rem',
    background: `${UI_CONFIG.colors.success}30`,
    border: `1px solid ${UI_CONFIG.colors.success}`,
    borderRadius: '4px',
    fontSize: '0.625rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.success,
  },
  networkDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: UI_CONFIG.colors.success,
    animation: 'pulse 2s ease-in-out infinite',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
  },
  metricCard: {
    padding: '1.5rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '12px',
    transition: UI_CONFIG.transitions.default,
    cursor: 'pointer',
  },
  metricLabel: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: '0.5rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  metricValue: {
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.text,
    marginBottom: '0.25rem',
  },
  metricSub: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  metricTrend: {
    marginTop: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: '600',
  },
  balanceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  balanceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
  },
  balanceLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  tokenIcon: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.125rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.text,
  },
  tokenInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  tokenSymbol: {
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '0.875rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.text,
  },
  tokenName: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  balanceRight: {
    textAlign: 'right',
  },
  balanceAmount: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
  },
  balanceUsd: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  activityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  activityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '1rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
  },
  activityStatus: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.background,
  },
  activityInfo: {
    flex: 1,
  },
  activityName: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
    marginBottom: '0.25rem',
  },
  activityTime: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  activityAmount: {
    textAlign: 'right',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
  },
  activityAmountOut: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: '0.25rem',
  },
  gridLayout: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '2rem',
  },
  gridLeft: {
    minWidth: 0,
  },
  gridRight: {
    minWidth: 0,
  },
  emptyState: {
    padding: '3rem 2rem',
    textAlign: 'center',
  },
  emptyIcon: {
    fontSize: '3rem',
    marginBottom: '1rem',
  },
  emptyText: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  loadingContainer: {
    padding: '4rem 2rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
  },
  loadingText: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
};

export default Overview;