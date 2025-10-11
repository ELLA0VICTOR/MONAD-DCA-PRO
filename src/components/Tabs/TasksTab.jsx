import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { useDCAStrategy } from '../../hooks/useDCAStrategy';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { formatDateTime, formatTokenAmount } from '../../utils/formatters';
import { UI_CONFIG, DCA_CONFIG } from '../../utils/constants';

const TasksTab = ({ onTaskClick }) => {
  const { strategies, pauseDCAStrategy, resumeDCAStrategy, cancelDCAStrategy } = useDCAStrategy();
  const { smartAccounts } = useSmartAccount();
  
  const [accountFilter, setAccountFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredStrategies = useMemo(() => {
    return strategies.filter(s => {
      if (accountFilter !== 'all' && s.smartAccount !== accountFilter) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      return true;
    });
  }, [strategies, accountFilter, statusFilter]);

  const handleAction = async (strategyId, action) => {
    try {
      if (action === 'pause') await pauseDCAStrategy(strategyId);
      else if (action === 'resume') await resumeDCAStrategy(strategyId);
      else if (action === 'cancel') await cancelDCAStrategy(strategyId);
      toast.success(`Strategy ${action}d successfully`);
    } catch (error) {
      toast.error(error.message || 'Action failed');
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'active': return 'var(--primary)';
      case 'paused': return 'var(--warning)';
      case 'completed': return 'var(--success)';
      default: return 'var(--error)';
    }
  };

  const renderTaskCard = (strategy, index) => {
    const progress = ((strategy.executionsCompleted || 0) / strategy.executionCount) * 100;
    
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
          <div style={styles.tokenPair}>
            {strategy.fromToken.symbol} → {strategy.toToken.symbol}
          </div>
          <div style={{...styles.statusBadge, background: getStatusColor(strategy.status)}}>
            {strategy.status}
          </div>
        </div>

        <div style={styles.cardBody}>
          <div style={styles.infoRow}>
            <span>Next execution:</span>
            <span>{strategy.nextExecutionAt ? formatDateTime(strategy.nextExecutionAt, {format: 'short'}) : 'N/A'}</span>
          </div>
          <div style={styles.progressSection}>
            <div style={styles.progressLabel}>
              {strategy.executionsCompleted || 0} / {strategy.executionCount} executed
            </div>
            <div style={styles.progressBar}>
              <div style={{...styles.progressFill, width: `${progress}%`, background: getStatusColor(strategy.status)}} />
            </div>
          </div>
        </div>

        <div style={styles.cardActions} onClick={(e) => e.stopPropagation()}>
          {strategy.status === 'active' && (
            <>
              <button onClick={() => handleAction(strategy.id, 'pause')} style={styles.actionBtn}>
                ⏸ Pause
              </button>
              <button onClick={() => handleAction(strategy.id, 'cancel')} style={{...styles.actionBtn, color: 'var(--error)'}}>
                ✕ Cancel
              </button>
            </>
          )}
          {strategy.status === 'paused' && (
            <>
              <button onClick={() => handleAction(strategy.id, 'resume')} style={styles.actionBtn}>
                ▶ Resume
              </button>
              <button onClick={() => handleAction(strategy.id, 'cancel')} style={{...styles.actionBtn, color: 'var(--error)'}}>
                ✕ Cancel
              </button>
            </>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Tasks</h2>
        <div style={styles.filters}>
          {smartAccounts.length > 1 && (
            <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} style={styles.filterSelect}>
              <option value="all">All Accounts</option>
              {smartAccounts.map(acc => (
                <option key={acc.address} value={acc.address}>{acc.address.slice(0, 8)}...</option>
              ))}
            </select>
          )}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={styles.filterSelect}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {filteredStrategies.length > 0 ? (
        <div style={styles.tasksGrid}>
          {filteredStrategies.map((strategy, index) => renderTaskCard(strategy, index))}
        </div>
      ) : (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📋</div>
          <div style={styles.emptyTitle}>No Tasks Found</div>
          <div style={styles.emptyText}>
            {statusFilter !== 'all' || accountFilter !== 'all' 
              ? 'No tasks match your filters' 
              : 'Create a strategy in the Swap tab to get started'}
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
  filters: { display: 'flex', gap: '0.5rem' },
  filterSelect: { padding: '0.5rem 1rem', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.875rem' },
  tasksGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' },
  taskCard: { padding: '1.5rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', cursor: 'pointer', transition: '200ms ease' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  tokenPair: { fontFamily: 'var(--font-primary)', fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--text-primary)' },
  statusBadge: { padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '600', color: 'var(--bg-primary)', textTransform: 'capitalize' },
  cardBody: { marginBottom: '1rem' },
  infoRow: { display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '1rem' },
  progressSection: { marginBottom: '0.5rem' },
  progressLabel: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' },
  progressBar: { height: '8px', background: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden' },
  progressFill: { height: '100%', transition: '300ms ease' },
  cardActions: { display: 'flex', gap: '0.5rem' },
  actionBtn: { flex: 1, padding: '0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.875rem', cursor: 'pointer' },
  emptyState: { padding: '4rem 2rem', textAlign: 'center' },
  emptyIcon: { fontSize: '4rem', marginBottom: '1rem' },
  emptyTitle: { fontFamily: 'var(--font-primary)', fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '0.5rem' },
  emptyText: { fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)' },
};

export default TasksTab;