import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useDCAStrategy } from '../../hooks/useDCAStrategy';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { formatTokenAmount, formatPercentage } from '../../utils/formatters';
import { SUPPORTED_TOKENS } from '../../utils/constants';

const DashboardTab = () => {
  const { activeAccount, balance } = useSmartAccount();
  const { strategies, stats } = useDCAStrategy();

  const metrics = useMemo(() => {
    const activeStrategies = strategies.filter(s => s.status === 'active').length;
    const pausedStrategies = strategies.filter(s => s.status === 'paused').length;
    const totalExecutions = stats?.totalExecutions || 0;
    const successRate = stats?.successRate || 0;
    const totalInvested = stats?.totalInvested || 0;
    const totalReceived = stats?.totalReceived || 0;
    const totalGasSpent = stats?.totalGasSpent || 0;
    const avgSlippage = stats?.avgSlippage || 0;

    const roi = totalInvested > 0 
      ? ((totalReceived - totalInvested - totalGasSpent) / totalInvested) * 100 
      : 0;

    return {
      activeStrategies,
      pausedStrategies,
      totalStrategies: strategies.length,
      totalExecutions,
      successRate,
      totalInvested,
      totalReceived,
      totalGasSpent,
      roi,
      avgSlippage
    };
  }, [strategies, stats]);

  const renderMetricCard = (label, value, change, icon) => (
    <motion.div
      style={styles.metricCard}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ borderColor: 'rgba(167, 139, 250, 0.3)' }}
    >
      <div style={styles.metricHeader}>
        <span style={styles.metricLabel}>{label}</span>
        {icon && <span style={styles.metricIcon}>{icon}</span>}
      </div>
      <div style={styles.metricValue}>{value}</div>
      {change !== undefined && (
        <div style={{
          ...styles.metricChange,
          color: change >= 0 ? '#22c55e' : '#ef4444'
        }}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(2)}%
        </div>
      )}
    </motion.div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Dashboard</h2>
          <p style={styles.subtitle}>Monitor your DCA performance</p>
        </div>
      </div>

      {/* Account Overview */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Account Overview</h3>
        <div style={styles.accountCard}>
          <div style={styles.accountRow}>
            <div style={styles.accountLeft}>
              <div style={styles.accountLabel}>Smart Account</div>
              <div style={styles.accountAddress}>
                {activeAccount?.address 
                  ? `${activeAccount.address.slice(0, 6)}...${activeAccount.address.slice(-4)}`
                  : 'Not connected'}
              </div>
            </div>
            <div style={styles.accountRight}>
              <div style={styles.accountBalance}>
                {balance?.smart?.formatted || '0.00'} MON
              </div>
              <div style={styles.accountBalanceLabel}>Available Balance</div>
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Performance Metrics</h3>
        <div style={styles.metricsGrid}>
          {renderMetricCard(
            'Active Strategies',
            metrics.activeStrategies.toString(),
            undefined,
            '📊'
          )}
          {renderMetricCard(
            'Total Executions',
            metrics.totalExecutions.toString(),
            undefined,
            '⚡'
          )}
          {renderMetricCard(
            'Success Rate',
            `${metrics.successRate.toFixed(1)}%`,
            undefined,
            '✓'
          )}
          {renderMetricCard(
            'ROI',
            formatPercentage(metrics.roi / 100),
            metrics.roi,
            metrics.roi >= 0 ? '📈' : '📉'
          )}
        </div>
      </div>

      {/* Trading Stats */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Trading Statistics</h3>
        <div style={styles.statsCard}>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>Total Invested</span>
            <span style={styles.statValue}>
              {formatTokenAmount(metrics.totalInvested.toString(), 18, 6)} MON
            </span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>Total Received</span>
            <span style={styles.statValue}>
              {formatTokenAmount(metrics.totalReceived.toString(), 18, 6)} Tokens
            </span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>Total Gas Spent</span>
            <span style={styles.statValue}>
              {formatTokenAmount(metrics.totalGasSpent.toString(), 18, 6)} MON
            </span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>Avg Slippage</span>
            <span style={styles.statValue}>
              {formatPercentage(metrics.avgSlippage)}
            </span>
          </div>
        </div>
      </div>

      {/* Strategy Breakdown */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Strategy Status</h3>
        <div style={styles.breakdownGrid}>
          <div style={styles.breakdownCard}>
            <div style={styles.breakdownValue}>{metrics.totalStrategies}</div>
            <div style={styles.breakdownLabel}>Total</div>
          </div>
          <div style={styles.breakdownCard}>
            <div style={{...styles.breakdownValue, color: '#a78bfa'}}>
              {metrics.activeStrategies}
            </div>
            <div style={styles.breakdownLabel}>Active</div>
          </div>
          <div style={styles.breakdownCard}>
            <div style={{...styles.breakdownValue, color: '#fbbf24'}}>
              {metrics.pausedStrategies}
            </div>
            <div style={styles.breakdownLabel}>Paused</div>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    width: '100%',
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '1.5rem'
  },
  header: {
    marginBottom: '2rem'
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#ffffff'
  },
  subtitle: {
    margin: '0.125rem 0 0',
    fontSize: '0.8125rem',
    color: 'rgba(255, 255, 255, 0.4)'
  },
  section: {
    marginBottom: '2rem'
  },
  sectionTitle: {
    margin: '0 0 1rem 0',
    fontSize: '1rem',
    fontWeight: '600',
    color: '#ffffff'
  },
  accountCard: {
    padding: '1.25rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px'
  },
  accountRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  accountLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem'
  },
  accountLabel: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500'
  },
  accountAddress: {
    fontSize: '0.875rem',
    fontFamily: 'monospace',
    fontWeight: '600',
    color: '#ffffff'
  },
  accountRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '0.25rem'
  },
  accountBalance: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#a78bfa'
  },
  accountBalanceLabel: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)'
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '1rem'
  },
  metricCard: {
    padding: '1.25rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    transition: 'all 0.2s'
  },
  metricHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.75rem'
  },
  metricLabel: {
    fontSize: '0.8125rem',
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500'
  },
  metricIcon: {
    fontSize: '1.25rem'
  },
  metricValue: {
    fontSize: '1.75rem',
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: '0.25rem'
  },
  metricChange: {
    fontSize: '0.8125rem',
    fontWeight: '500'
  },
  statsCard: {
    padding: '1.25rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px'
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
  },
  statLabel: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500'
  },
  statValue: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#ffffff'
  },
  breakdownGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '1rem'
  },
  breakdownCard: {
    padding: '1.25rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    textAlign: 'center'
  },
  breakdownValue: {
    fontSize: '2rem',
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: '0.5rem'
  },
  breakdownLabel: {
    fontSize: '0.8125rem',
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500'
  }
};

export default DashboardTab;