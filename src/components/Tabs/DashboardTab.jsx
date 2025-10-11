import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useDCAStrategy } from '../../hooks/useDCAStrategy';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { useMonadBalance } from '../../hooks/useMonadBalance';
import { formatTokenAmount, formatPrice, formatPercentage } from '../../utils/formatters';
import { UI_CONFIG, SUPPORTED_TOKENS } from '../../utils/constants';

const DashboardTab = () => {
  const { accountAddress, balance } = useSmartAccount();
  const { strategies, stats } = useDCAStrategy();
  const { balances, totalBalanceUSD } = useMonadBalance(accountAddress);
  const [selectedView, setSelectedView] = useState('overview'); // overview | performance | gas

  const portfolioMetrics = useMemo(() => {
    const totalInvested = stats?.totalInvested || 0;
    const totalReceived = stats?.totalReceived || 0;
    const totalGasSpent = stats?.totalGasSpent || 0;
    const roi = totalReceived - totalInvested - totalGasSpent;
    const roiPercent = totalInvested > 0 ? (roi / totalInvested) * 100 : 0;

    return {
      totalInvested,
      totalReceived,
      totalGasSpent,
      roi,
      roiPercent,
      activeStrategies: strategies.filter(s => s.status === 'active').length,
      totalExecutions: stats?.totalExecutions || 0,
      successRate: stats?.successRate || 0,
      avgSlippage: stats?.avgSlippage || 0,
    };
  }, [stats, strategies]);

  const renderMetricCard = (label, value, subValue, colorClass = '') => (
    <motion.div
      style={styles.metricCard}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
    >
      <div style={styles.metricLabel}>{label}</div>
      <div style={{...styles.metricValue, ...(colorClass && {color: `var(--${colorClass})`})}}>{value}</div>
      {subValue && <div style={styles.metricSub}>{subValue}</div>}
    </motion.div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Dashboard</h2>
        <div style={styles.viewTabs}>
          {['overview', 'performance', 'gas'].map(view => (
            <button
              key={view}
              onClick={() => setSelectedView(view)}
              style={{
                ...styles.viewTab,
                ...(selectedView === view && styles.viewTabActive)
              }}
            >
              {view.charAt(0).toUpperCase() + view.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {selectedView === 'overview' && (
        <>
          {/* Account Status */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Account Status</h3>
            <div style={styles.accountCard}>
              <div style={styles.accountRow}>
                <span>MON Balance:</span>
                <span>{balance ? `${balance.displayValue} MON` : '0.0 MON'}</span>
              </div>
              <div style={styles.accountRow}>
                <span>Portfolio Value:</span>
                <span>${totalBalanceUSD ? formatPrice(totalBalanceUSD) : '0.00'}</span>
              </div>
            </div>
          </div>

          {/* Portfolio Metrics */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Portfolio Performance</h3>
            <div style={styles.metricsGrid}>
              {renderMetricCard('Total Invested', `${portfolioMetrics.totalInvested.toFixed(4)} MON`, 'Across all strategies')}
              {renderMetricCard('Total Received', `${portfolioMetrics.totalReceived.toFixed(4)} tokens`, 'Total output')}
              {renderMetricCard('ROI', formatPercentage(portfolioMetrics.roiPercent / 100), 
                `${portfolioMetrics.roi >= 0 ? '+' : ''}${portfolioMetrics.roi.toFixed(4)} MON`,
                portfolioMetrics.roi >= 0 ? 'success' : 'error'
              )}
              {renderMetricCard('Active Strategies', portfolioMetrics.activeStrategies.toString(), `${strategies.length} total`)}
              {renderMetricCard('Total Executions', portfolioMetrics.totalExecutions.toString(), 'Completed swaps')}
              {renderMetricCard('Success Rate', `${portfolioMetrics.successRate.toFixed(1)}%`, 'All executions')}
            </div>
          </div>

          {/* Token Balances */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Token Balances</h3>
            <div style={styles.balanceList}>
              {SUPPORTED_TOKENS.map(token => {
                const tokenBalance = balances[token.symbol];
                return (
                  <div key={token.address} style={styles.balanceRow}>
                    <div style={styles.balanceLeft}>
                      <div style={styles.tokenIcon}>{token.isNative ? 'M' : token.symbol[0]}</div>
                      <div>
                        <div style={styles.tokenSymbol}>{token.symbol}</div>
                        <div style={styles.tokenName}>{token.name}</div>
                      </div>
                    </div>
                    <div style={styles.balanceRight}>
                      {tokenBalance ? tokenBalance.formatted : '0.0'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {selectedView === 'performance' && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Performance Breakdown</h3>
          <div style={styles.breakdownGrid}>
            {renderMetricCard('Avg Slippage', formatPercentage(portfolioMetrics.avgSlippage), 'Per execution')}
            {renderMetricCard('Total Gas', `${portfolioMetrics.totalGasSpent.toFixed(6)} MON`, 'All executions')}
            {renderMetricCard('Avg Gas/Exec', 
              portfolioMetrics.totalExecutions > 0 
                ? `${(portfolioMetrics.totalGasSpent / portfolioMetrics.totalExecutions).toFixed(6)} MON`
                : '0 MON',
              'Per execution'
            )}
          </div>
        </div>
      )}

      {selectedView === 'gas' && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Gas Analytics</h3>
          <div style={styles.gasCard}>
            <div style={styles.gasRow}>
              <span>Total Gas Used:</span>
              <span>{portfolioMetrics.totalGasSpent.toFixed(6)} MON</span>
            </div>
            <div style={styles.gasRow}>
              <span>Avg Per Execution:</span>
              <span>
                {portfolioMetrics.totalExecutions > 0
                  ? `${(portfolioMetrics.totalGasSpent / portfolioMetrics.totalExecutions).toFixed(6)} MON`
                  : '0 MON'}
              </span>
            </div>
            <div style={styles.gasRow}>
              <span>Gas Efficiency:</span>
              <span style={{color: 'var(--success)'}}>Good</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: { width: '100%', maxWidth: '1200px', margin: '0 auto', padding: '2rem' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' },
  title: { margin: 0, fontFamily: 'var(--font-primary)', fontSize: '2rem', color: 'var(--text-primary)' },
  viewTabs: { display: 'flex', gap: '0.5rem' },
  viewTab: { padding: '0.5rem 1rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.875rem', cursor: 'pointer', transition: '200ms ease' },
  viewTabActive: { background: 'var(--primary)', color: 'var(--bg-primary)', borderColor: 'var(--primary)' },
  section: { marginBottom: '2rem' },
  sectionTitle: { margin: '0 0 1rem 0', fontFamily: 'var(--font-primary)', fontSize: '1.25rem', color: 'var(--text-primary)' },
  accountCard: { padding: '1.5rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' },
  accountRow: { display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', fontSize: '0.875rem', borderBottom: '1px solid var(--border)' },
  metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' },
  metricCard: { padding: '1.5rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', transition: '200ms ease' },
  metricLabel: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem', textTransform: 'uppercase' },
  metricValue: { fontFamily: 'var(--font-primary)', fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '0.25rem' },
  metricSub: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' },
  balanceList: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  balanceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px' },
  balanceLeft: { display: 'flex', alignItems: 'center', gap: '1rem' },
  tokenIcon: { width: '40px', height: '40px', borderRadius: '50%', background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-primary)', fontSize: '1.125rem', fontWeight: 'bold' },
  tokenSymbol: { fontFamily: 'var(--font-primary)', fontSize: '0.875rem', fontWeight: 'bold' },
  tokenName: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' },
  balanceRight: { fontSize: '0.875rem', fontWeight: '600' },
  breakdownGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' },
  gasCard: { padding: '1.5rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' },
  gasRow: { display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', fontSize: '0.875rem', borderBottom: '1px solid var(--border)' },
};

export default DashboardTab;