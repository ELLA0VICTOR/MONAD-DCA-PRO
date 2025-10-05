import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { useDCAStrategy } from '../../hooks/useDCAStrategy';
import { 
  formatTokenAmount, 
  formatDateTime,
  formatDCAFrequency,
  formatPercentage,
  formatDuration
} from '../../utils/formatters';
import { 
  UI_CONFIG,
  DCA_CONFIG 
} from '../../utils/constants';

const ActiveStrategies = ({ onStrategyClick, onCreateNew }) => {
  // Hooks
  const {
    strategies,
    activeStrategy,
    pauseDCAStrategy,
    resumeDCAStrategy,
    cancelDCAStrategy,
    executeStrategySwap,
    isLoading
  } = useDCAStrategy();

  // State
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all', 'active', 'paused', 'completed'

  // Filter strategies
  const filteredStrategies = useMemo(() => {
    if (filter === 'all') return strategies;
    return strategies.filter(s => s.status === filter);
  }, [strategies, filter]);

  // Get active strategies count
  const activeCount = useMemo(() => {
    return strategies.filter(s => s.status === 'active').length;
  }, [strategies]);

  // Handle strategy action
  const handleAction = useCallback((strategy, action) => {
    setSelectedStrategy(strategy);
    setConfirmAction(action);
    setShowConfirmModal(true);
  }, []);

  // Confirm action
  const handleConfirm = useCallback(async () => {
    if (!selectedStrategy || !confirmAction) return;

    setShowConfirmModal(false);

    try {
      switch (confirmAction) {
        case 'pause':
          await pauseDCAStrategy(selectedStrategy.id, 'User paused');
          toast.success('Strategy paused successfully');
          break;
        case 'resume':
          await resumeDCAStrategy(selectedStrategy.id);
          toast.success('Strategy resumed successfully');
          break;
        case 'cancel':
          await cancelDCAStrategy(selectedStrategy.id, 'User cancelled');
          toast.success('Strategy cancelled successfully');
          break;
        case 'execute':
          await executeStrategySwap(selectedStrategy.id, 'Manual user execution');
          toast.success('Manual execution initiated');
          break;
        default:
          break;
      }
    } catch (error) {
      console.error('Action error:', error);
      toast.error(error.message || 'Action failed');
    } finally {
      setSelectedStrategy(null);
      setConfirmAction(null);
    }
  }, [selectedStrategy, confirmAction, pauseDCAStrategy, resumeDCAStrategy, cancelDCAStrategy, executeStrategySwap]);

  // Cancel confirmation
  const handleCancelConfirm = useCallback(() => {
    setShowConfirmModal(false);
    setSelectedStrategy(null);
    setConfirmAction(null);
  }, []);

  // Get status color
  const getStatusColor = (status) => {
    switch (status) {
      case 'active':
        return UI_CONFIG.colors.success;
      case 'paused':
        return UI_CONFIG.colors.warning;
      case 'completed':
        return UI_CONFIG.colors.info;
      case 'cancelled':
      case 'error':
        return UI_CONFIG.colors.error;
      default:
        return 'rgba(255, 255, 255, 0.5)';
    }
  };

  // Get status label
  const getStatusLabel = (status) => {
    const labels = {
      active: 'Active',
      paused: 'Paused',
      completed: 'Completed',
      cancelled: 'Cancelled',
      error: 'Error',
      created: 'Created'
    };
    return labels[status] || status;
  };

  // Calculate progress
  const calculateProgress = (strategy) => {
    const total = strategy.executionCount || 1;
    const completed = strategy.executionsCompleted || 0;
    return total ? (completed / total) * 100 : 0;
  };

  // Render strategy card
  const renderStrategyCard = (strategy, index) => {
    const statusColor = getStatusColor(strategy.status);
    const progress = calculateProgress(strategy);
    const isActive = activeStrategy?.id === strategy.id;

    return (
      <motion.div
        key={strategy.id}
        style={{
          ...styles.strategyCard,
          ...(isActive ? styles.strategyCardActive : {})
        }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: index * 0.05 }}
        whileHover={{ scale: 1.01 }}
        onClick={() => onStrategyClick?.(strategy)}
      >
        {/* Header */}
        <div style={styles.cardHeader}>
          <div style={styles.cardHeaderLeft}>
            <div style={styles.tokenPair}>
              {strategy.fromToken.symbol} → {strategy.toToken.symbol}
            </div>
            <div style={{ ...styles.statusBadge, background: statusColor }}>
              {getStatusLabel(strategy.status)}
            </div>
          </div>
          <div style={styles.cardHeaderRight}>
            <div style={styles.strategyId}>#{strategy.id.slice(0, 8)}</div>
          </div>
        </div>

        {/* Metrics */}
        <div style={styles.cardMetrics}>
          <div style={styles.metricItem}>
            <div style={styles.metricLabel}>Amount per Execution</div>
            <div style={styles.metricValue}>
              {formatTokenAmount(strategy.amount, strategy.fromToken?.decimals ?? 18, 4)} {strategy.fromToken?.symbol ??  '—'}
            </div>
          </div>
          <div style={styles.metricItem}>
            <div style={styles.metricLabel}>Frequency</div>
            <div style={styles.metricValue}>
              {formatDCAFrequency(DCA_CONFIG.schedules[strategy.frequency].interval)}
            </div>
          </div>
          <div style={styles.metricItem}>
            <div style={styles.metricLabel}>Progress</div>
            <div style={styles.metricValue}>
              {strategy.executionsCompleted || 0} / {strategy.executionCount}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={styles.progressBar}>
          <motion.div
            style={{
              ...styles.progressFill,
              background: statusColor,
            }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, delay: index * 0.05 }}
          />
        </div>

        {/* Stats */}
        <div style={styles.cardStats}>
          <div style={styles.statItem}>
            <span style={styles.statLabel}>Invested:</span>
            <span style={styles.statValue}>
              {formatTokenAmount(strategy.totalInvested || '0', strategy.fromToken.decimals, 4)} {strategy.fromToken.symbol}
            </span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statLabel}>Received:</span>
            <span style={styles.statValue}>
              {formatTokenAmount(strategy.totalReceived || '0', strategy.toToken.decimals, 4)} {strategy.toToken.symbol}
            </span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statLabel}>Avg Price:</span>
            <span style={styles.statValue}>
              {strategy.avgExecutionPrice ? strategy.avgExecutionPrice.toFixed(6) : 'N/A'}
            </span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statLabel}>Next Execution:</span>
            <span style={styles.statValue}>
              {strategy.nextExecutionAt && strategy.status === 'active'
                ? formatDateTime(strategy.nextExecutionAt, { format: 'short' })
                : 'N/A'}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div style={styles.cardActions} onClick={(e) => e.stopPropagation()}>
          {strategy.status === 'active' && (
            <>
              <button
                type="button"
                onClick={() => handleAction(strategy, 'pause')}
                style={styles.actionButton}
                disabled={isLoading}
              >
                ⏸ Pause
              </button>
              <button
                type="button"
                onClick={() => handleAction(strategy, 'execute')}
                style={styles.actionButton}
                disabled={isLoading}
              >
                ▶ Execute Now
              </button>
            </>
          )}
          {strategy.status === 'paused' && (
            <button
              type="button"
              onClick={() => handleAction(strategy, 'resume')}
              style={styles.actionButton}
              disabled={isLoading}
            >
              ▶ Resume
            </button>
          )}
          {(strategy.status === 'active' || strategy.status === 'paused') && (
            <button
              type="button"
              onClick={() => handleAction(strategy, 'cancel')}
              style={{ ...styles.actionButton, ...styles.actionButtonDanger }}
              disabled={isLoading}
            >
              ✕ Cancel
            </button>
          )}
        </div>
      </motion.div>
    );
  };

  // Render confirmation modal
  const renderConfirmModal = () => {
    if (!selectedStrategy || !confirmAction) return null;

    const actionLabels = {
      pause: 'Pause Strategy',
      resume: 'Resume Strategy',
      cancel: 'Cancel Strategy',
      execute: 'Execute Swap Now'
    };

    const actionMessages = {
      pause: 'Are you sure you want to pause this strategy? It will stop executing until resumed.',
      resume: 'Are you sure you want to resume this strategy? Executions will continue as scheduled.',
      cancel: 'Are you sure you want to cancel this strategy? This action cannot be undone.',
      execute: 'Are you sure you want to execute a swap immediately? This will not affect the regular schedule.'
    };

    return (
      <AnimatePresence>
        {showConfirmModal && (
          <motion.div
            style={styles.modalOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCancelConfirm}
          >
            <motion.div
              style={styles.modal}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={styles.modalHeader}>
                <h3 style={styles.modalTitle}>{actionLabels[confirmAction]}</h3>
                <button
                  type="button"
                  onClick={handleCancelConfirm}
                  style={styles.closeButton}
                >
                  ✕
                </button>
              </div>

              <div style={styles.modalBody}>
                <p style={styles.modalText}>{actionMessages[confirmAction]}</p>
                
                <div style={styles.strategyInfo}>
                  <div style={styles.infoRow}>
                    <span>Strategy:</span>
                    <span>{selectedStrategy.fromToken.symbol} → {selectedStrategy.toToken.symbol}</span>
                  </div>
                  <div style={styles.infoRow}>
                    <span>Status:</span>
                    <span>{getStatusLabel(selectedStrategy.status)}</span>
                  </div>
                  <div style={styles.infoRow}>
                    <span>Progress:</span>
                    <span>{selectedStrategy.executionsCompleted || 0} / {selectedStrategy.executionCount}</span>
                  </div>
                </div>
              </div>

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={handleCancelConfirm}
                  style={styles.btnSecondary}
                  disabled={isLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  style={confirmAction === 'cancel' ? styles.btnDanger : styles.btnPrimary}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <div className="spinner" style={{ marginRight: '8px' }} />
                      Processing...
                    </>
                  ) : (
                    'Confirm'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  };

  // Render empty state
  const renderEmptyState = () => (
    <div style={styles.emptyState}>
      <div style={styles.emptyIcon}>📈</div>
      <div style={styles.emptyTitle}>No Active Strategies</div>
      <div style={styles.emptyText}>
        Create your first DCA strategy to start automated token swaps
      </div>
      {onCreateNew && (
        <button
          type="button"
          onClick={onCreateNew}
          style={styles.createButton}
        >
          + Create Strategy
        </button>
      )}
    </div>
  );

  // Main render
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h3 style={styles.title}>Active Strategies</h3>
          <div style={styles.badge}>{activeCount} Active</div>
        </div>
        <div style={styles.headerRight}>
          {onCreateNew && strategies.length > 0 && (
            <button
              type="button"
              onClick={onCreateNew}
              style={styles.createButtonSmall}
            >
              + New Strategy
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      {strategies.length > 0 && (
        <div style={styles.filters}>
          {['all', 'active', 'paused', 'completed'].map(status => (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              style={{
                ...styles.filterButton,
                ...(filter === status ? styles.filterButtonActive : {})
              }}
            >
              {status === 'all' ? 'All' : getStatusLabel(status)}
            </button>
          ))}
        </div>
      )}

      {/* Strategies grid */}
      <div style={styles.strategiesGrid}>
        {filteredStrategies.length > 0 ? (
          filteredStrategies.map((strategy, index) => renderStrategyCard(strategy, index))
        ) : strategies.length === 0 ? (
          renderEmptyState()
        ) : (
          <div style={styles.noResults}>No strategies match the current filter</div>
        )}
      </div>

      {renderConfirmModal()}
    </div>
  );
};

// Styles
const styles = {
  container: {
    width: '100%',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  headerRight: {
    display: 'flex',
    gap: '0.5rem',
  },
  title: {
    margin: 0,
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.5rem',
    color: UI_CONFIG.colors.text,
  },
  badge: {
    padding: '0.25rem 0.75rem',
    background: `${UI_CONFIG.colors.success}30`,
    border: `1px solid ${UI_CONFIG.colors.success}`,
    borderRadius: '12px',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.success,
  },
  createButtonSmall: {
    padding: '0.5rem 1rem',
    background: `linear-gradient(135deg, ${UI_CONFIG.colors.success}, #00cc70)`,
    border: 'none',
    borderRadius: '8px',
    color: UI_CONFIG.colors.background,
    fontSize: '0.875rem',
    fontWeight: 'bold',
    fontFamily: UI_CONFIG.fonts.primary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
  },
  filters: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1.5rem',
  },
  filterButton: {
    padding: '0.5rem 1rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: '0.875rem',
    fontFamily: UI_CONFIG.fonts.secondary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.fast,
  },
  filterButtonActive: {
    background: `${UI_CONFIG.colors.success}30`,
    borderColor: UI_CONFIG.colors.success,
    color: UI_CONFIG.colors.success,
  },
  strategiesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
    gap: '1.5rem',
  },
  strategyCard: {
    padding: '1.5rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '12px',
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
  },
  strategyCardActive: {
    borderColor: UI_CONFIG.colors.success,
    boxShadow: `0 0 0 2px ${UI_CONFIG.colors.success}40`,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '1rem',
  },
  cardHeaderLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  cardHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  tokenPair: {
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.text,
  },
  statusBadge: {
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.background,
    display: 'inline-block',
  },
  strategyId: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)',
    fontFamily: UI_CONFIG.fonts.primary,
  },
  cardMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '1rem',
    marginBottom: '1rem',
  },
  metricItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  metricLabel: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  metricValue: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
  },
  progressBar: {
    height: '4px',
    background: UI_CONFIG.colors.accent,
    borderRadius: '2px',
    overflow: 'hidden',
    marginBottom: '1rem',
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.5s ease',
  },
  cardStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '0.5rem',
    marginBottom: '1rem',
    padding: '1rem',
    background: UI_CONFIG.colors.accent,
    borderRadius: '8px',
  },
  statItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.75rem',
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  statValue: {
    color: UI_CONFIG.colors.text,
    fontWeight: '600',
  },
  cardActions: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
  },
  actionButton: {
    flex: 1,
    minWidth: '100px',
    padding: '0.5rem 1rem',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '6px',
    color: UI_CONFIG.colors.text,
    fontSize: '0.875rem',
    fontFamily: UI_CONFIG.fonts.secondary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.fast,
  },
  actionButtonDanger: {
    borderColor: UI_CONFIG.colors.error,
    color: UI_CONFIG.colors.error,
  },
  emptyState: {
    gridColumn: '1 / -1',
    padding: '4rem 2rem',
    textAlign: 'center',
  },
  emptyIcon: {
    fontSize: '3rem',
    marginBottom: '1rem',
  },
  emptyTitle: {
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.text,
    marginBottom: '0.5rem',
  },
  emptyText: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: '1.5rem',
  },
  createButton: {
    padding: '0.75rem 2rem',
    background: `linear-gradient(135deg, ${UI_CONFIG.colors.success}, #00cc70)`,
    border: 'none',
    borderRadius: '8px',
    color: UI_CONFIG.colors.background,
    fontSize: '1rem',
    fontWeight: 'bold',
    fontFamily: UI_CONFIG.fonts.primary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
  },
  noResults: {
    gridColumn: '1 / -1',
    padding: '2rem',
    textAlign: 'center',
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.8)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: '2rem',
  },
  modal: {
    width: '100%',
    maxWidth: '500px',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
    overflow: 'hidden',
  },
  modalHeader: {
    padding: '1.5rem',
    borderBottom: `1px solid ${UI_CONFIG.colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    margin: 0,
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.25rem',
    color: UI_CONFIG.colors.text,
  },
  closeButton: {
    width: '32px',
    height: '32px',
    padding: 0,
    background: 'transparent',
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '6px',
    color: UI_CONFIG.colors.text,
    fontSize: '1.25rem',
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.fast,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    padding: '1.5rem',
  },
  modalText: {
    margin: '0 0 1.5rem 0',
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: '1.6',
  },
  strategyInfo: {
    padding: '1rem',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.5rem 0',
    fontSize: '0.875rem',
    borderBottom: `1px solid ${UI_CONFIG.colors.border}`,
  },
  modalActions: {
    padding: '1.5rem',
    borderTop: `1px solid ${UI_CONFIG.colors.border}`,
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end',
  },
  btnPrimary: {
    padding: '0.75rem 2rem',
    background: `linear-gradient(135deg, ${UI_CONFIG.colors.success}, #00cc70)`,
    border: 'none',
    borderRadius: '8px',
    color: UI_CONFIG.colors.background,
    fontSize: '1rem',
    fontWeight: 'bold',
    fontFamily: UI_CONFIG.fonts.primary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondary: {
    padding: '0.75rem 2rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    color: UI_CONFIG.colors.text,
    fontSize: '1rem',
    fontWeight: '600',
    fontFamily: UI_CONFIG.fonts.primary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
  },
  btnDanger: {
    padding: '0.75rem 2rem',
    background: `linear-gradient(135deg, ${UI_CONFIG.colors.error}, #cc0000)`,
    border: 'none',
    borderRadius: '8px',
    color: UI_CONFIG.colors.text,
    fontSize: '1rem',
    fontWeight: 'bold',
    fontFamily: UI_CONFIG.fonts.primary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

export default ActiveStrategies;