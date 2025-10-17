import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDCAStrategy } from '../../hooks/useDCAStrategy';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { formatDateTime, formatTokenAmount } from '../../utils/formatters';
import { SWAP_INTERVALS } from '../../utils/constants';
import toast from 'react-hot-toast';

const TasksTab = ({ onTaskClick }) => {
  const { 
    strategies, 
    pauseDCAStrategy, 
    resumeDCAStrategy, 
    cancelDCAStrategy,
    formatStrategyForDisplay,
    isLoading
  } = useDCAStrategy();
  
  const { smartAccounts } = useSmartAccount();
  
  const [accountFilter, setAccountFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredStrategies = useMemo(() => {
    return strategies.filter(s => {
      if (accountFilter !== 'all' && s.config?.smartAccountAddress !== accountFilter) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      return true;
    });
  }, [strategies, accountFilter, statusFilter]);

  const handleAction = async (strategyId, action, e) => {
    e.stopPropagation();
    
    try {
      if (action === 'pause') {
        await pauseDCAStrategy(strategyId);
        toast.success('Strategy paused');
      } else if (action === 'resume') {
        await resumeDCAStrategy(strategyId);
        toast.success('Strategy resumed');
      } else if (action === 'cancel') {
        if (window.confirm('Are you sure you want to cancel this strategy? This cannot be undone.')) {
          await cancelDCAStrategy(strategyId);
          toast.success('Strategy cancelled');
        }
      }
    } catch (error) {
      toast.error(error.message || 'Action failed');
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'active': return '#a78bfa';
      case 'paused': return '#fbbf24';
      case 'completed': return '#22c55e';
      case 'cancelled': return '#ef4444';
      case 'error': return '#ef4444';
      default: return 'rgba(255, 255, 255, 0.4)';
    }
  };

  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const renderTaskCard = (strategy, index) => {
    const formatted = formatStrategyForDisplay(strategy);
    const config = strategy.config || {};
    const stats = strategy.stats || {};
    
    const totalExecutions = stats.executionCount || 0;
    const nextExecution = strategy.nextExecutionAt;
    const progress = totalExecutions > 0 ? Math.min((totalExecutions / 100) * 100, 100) : 0;
    
    return (
      <motion.div
        key={strategy.id}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.05 }}
        style={styles.taskCard}
        onClick={() => onTaskClick?.(strategy)}
      >
        <div style={styles.cardHeader}>
          <div style={styles.headerLeft}>
            <div style={styles.tokenPair}>
              {config.fromToken || 'MON'} → {config.toToken || 'USDC'}
            </div>
            <div style={styles.accountBadge}>
              {formatAddress(config.smartAccountAddress)}
            </div>
          </div>
          <div style={{
            ...styles.statusBadge,
            background: getStatusColor(strategy.status),
          }}>
            {strategy.status}
          </div>
        </div>

        <div style={styles.cardBody}>
          <div style={styles.infoGrid}>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Amount</span>
              <span style={styles.infoValue}>
                {config.amountPerSwap || '0'} {config.fromToken}
              </span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Interval</span>
              <span style={styles.infoValue}>
                {SWAP_INTERVALS[config.interval]?.label || 'Unknown'}
              </span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Executions</span>
              <span style={styles.infoValue}>{totalExecutions}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Next Run</span>
              <span style={styles.infoValue}>
                {nextExecution ? formatDateTime(nextExecution, { format: 'short' }) : 'N/A'}
              </span>
            </div>
          </div>

          {totalExecutions > 0 && (
            <div style={styles.progressSection}>
              <div style={styles.progressBar}>
                <div style={{
                  ...styles.progressFill,
                  width: `${progress}%`,
                  background: getStatusColor(strategy.status)
                }} />
              </div>
            </div>
          )}
        </div>

        <div style={styles.cardActions} onClick={(e) => e.stopPropagation()}>
          {strategy.status === 'active' && (
            <>
              <button 
                onClick={(e) => handleAction(strategy.id, 'pause', e)} 
                style={styles.actionBtn}
              >
                ⏸ Pause
              </button>
              <button 
                onClick={(e) => handleAction(strategy.id, 'cancel', e)} 
                style={{...styles.actionBtn, ...styles.actionBtnDanger}}
              >
                ✕ Cancel
              </button>
            </>
          )}
          {strategy.status === 'paused' && (
            <>
              <button 
                onClick={(e) => handleAction(strategy.id, 'resume', e)} 
                style={styles.actionBtn}
              >
                ▶ Resume
              </button>
              <button 
                onClick={(e) => handleAction(strategy.id, 'cancel', e)} 
                style={{...styles.actionBtn, ...styles.actionBtnDanger}}
              >
                ✕ Cancel
              </button>
            </>
          )}
          {(strategy.status === 'completed' || strategy.status === 'cancelled') && (
            <div style={styles.completedLabel}>
              {strategy.status === 'completed' ? '✓ Completed' : '✕ Cancelled'}
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Active Tasks</h2>
          <p style={styles.subtitle}>Manage your DCA strategies</p>
        </div>
        <div style={styles.filters}>
          {smartAccounts && smartAccounts.length > 1 && (
            <select 
              value={accountFilter} 
              onChange={(e) => setAccountFilter(e.target.value)} 
              style={styles.filterSelect}
            >
              <option value="all">All Accounts</option>
              {smartAccounts.map(acc => (
                <option key={acc.address} value={acc.address}>
                  {formatAddress(acc.address)}
                </option>
              ))}
            </select>
          )}
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)} 
            style={styles.filterSelect}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div style={styles.loadingContainer}>
          <div className="spinner" style={{width: '32px', height: '32px', borderWidth: '3px'}} />
        </div>
      ) : filteredStrategies.length > 0 ? (
        <div style={styles.tasksGrid}>
          {filteredStrategies.map((strategy, index) => renderTaskCard(strategy, index))}
        </div>
      ) : (
        <div style={styles.emptyState}>
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 255, 255, 0.2)" strokeWidth="1.5">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <div style={styles.emptyTitle}>No Tasks Found</div>
          <div style={styles.emptyText}>
            {statusFilter !== 'all' || accountFilter !== 'all' 
              ? 'No tasks match your current filters' 
              : 'Create a DCA strategy in the Swap tab to get started'}
          </div>
        </div>
      )}
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
    display: 'flex', 
    justifyContent: 'space-between', 
    alignItems: 'flex-start', 
    marginBottom: '2rem', 
    flexWrap: 'wrap', 
    gap: '1rem' 
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
  filters: { 
    display: 'flex', 
    gap: '0.5rem' 
  },
  filterSelect: { 
    padding: '0.5rem 0.875rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '0.8125rem',
    fontWeight: '500',
    cursor: 'pointer',
    outline: 'none',
    transition: 'all 0.2s'
  },
  loadingContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '4rem'
  },
  tasksGrid: { 
    display: 'grid', 
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', 
    gap: '1rem' 
  },
  taskCard: { 
    padding: '1.25rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  cardHeader: { 
    display: 'flex', 
    justifyContent: 'space-between', 
    alignItems: 'flex-start', 
    marginBottom: '1rem',
    paddingBottom: '0.75rem',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
  },
  headerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem'
  },
  tokenPair: { 
    fontSize: '1rem', 
    fontWeight: '600', 
    color: '#ffffff' 
  },
  accountBadge: {
    fontSize: '0.75rem',
    fontFamily: 'monospace',
    color: 'rgba(255, 255, 255, 0.4)'
  },
  statusBadge: { 
    padding: '0.25rem 0.75rem',
    borderRadius: '6px',
    fontSize: '0.6875rem',
    fontWeight: '600',
    color: '#000000',
    textTransform: 'capitalize'
  },
  cardBody: { 
    marginBottom: '1rem' 
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '0.75rem'
  },
  infoItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  infoLabel: { 
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500'
  },
  infoValue: { 
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#ffffff'
  },
  progressSection: { 
    marginTop: '0.875rem' 
  },
  progressBar: { 
    height: '4px',
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '2px',
    overflow: 'hidden'
  },
  progressFill: { 
    height: '100%',
    transition: 'width 0.3s ease'
  },
  cardActions: { 
    display: 'flex', 
    gap: '0.5rem' 
  },
  actionBtn: { 
    flex: 1,
    padding: '0.5rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '0.8125rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  actionBtnDanger: {
    color: '#ef4444'
  },
  completedLabel: {
    flex: 1,
    textAlign: 'center',
    padding: '0.5rem',
    fontSize: '0.8125rem',
    color: 'rgba(255, 255, 255, 0.5)',
    fontStyle: 'italic'
  },
  emptyState: { 
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4rem 2rem',
    textAlign: 'center' 
  },
  emptyTitle: { 
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#ffffff',
    marginTop: '1.5rem',
    marginBottom: '0.5rem'
  },
  emptyText: { 
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.4)',
    maxWidth: '320px'
  }
};

export default TasksTab;