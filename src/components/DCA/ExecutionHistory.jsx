import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  formatTokenAmount, 
  formatDateTime, 
  formatAddress,
  formatPercentage,
  formatPrice
} from '../../utils/formatters';
import { 
  UI_CONFIG, 
  SUPPORTED_TOKENS 
} from '../../utils/constants';

const ExecutionHistory = ({ 
  executions = [], 
  isLoading = false,
  onExecutionClick,
  maxItems = 50,
  showFilters = true 
}) => {
  // State
  const [filter, setFilter] = useState('all'); // 'all', 'completed', 'failed', 'skipped'
  const [sortBy, setSortBy] = useState('date'); // 'date', 'amount', 'slippage', 'gas'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc', 'desc'
  const [selectedExecution, setSelectedExecution] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  // Filter executions
  const filteredExecutions = useMemo(() => {
    let filtered = [...executions];

    // Apply status filter
    if (filter !== 'all') {
      filtered = filtered.filter(exec => exec.status === filter);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'date':
          comparison = a.executedAt - b.executedAt;
          break;
        case 'amount':
          comparison = parseFloat(a.amountIn || 0) - parseFloat(b.amountIn || 0);
          break;
        case 'slippage':
          comparison = (a.actualSlippage || 0) - (b.actualSlippage || 0);
          break;
        case 'gas':
          comparison = parseFloat(a.gasUsed || 0) - parseFloat(b.gasUsed || 0);
          break;
        default:
          comparison = 0;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Limit items
    return filtered.slice(0, maxItems);
  }, [executions, filter, sortBy, sortOrder, maxItems]);

  // Calculate statistics
  const stats = useMemo(() => {
    const completed = executions.filter(e => e.status === 'completed');
    const failed = executions.filter(e => e.status === 'failed');
    const skipped = executions.filter(e => e.status === 'skipped');

    const totalAmountIn = completed.reduce((sum, e) => sum + parseFloat(e.amountIn || 0), 0);
    const totalAmountOut = completed.reduce((sum, e) => sum + parseFloat(e.amountOut || 0), 0);
    const totalGas = completed.reduce((sum, e) => sum + parseFloat(e.gasUsed || 0), 0);
    const avgSlippage = completed.length > 0
      ? completed.reduce((sum, e) => sum + (e.actualSlippage || 0), 0) / completed.length
      : 0;

    return {
      total: executions.length,
      completed: completed.length,
      failed: failed.length,
      skipped: skipped.length,
      successRate: executions.length > 0 ? (completed.length / executions.length) * 100 : 0,
      totalAmountIn,
      totalAmountOut,
      totalGas,
      avgSlippage,
    };
  }, [executions]);

  // Handle execution click
  const handleExecutionClick = useCallback((execution) => {
    setSelectedExecution(execution);
    setShowDetails(true);
    if (onExecutionClick) {
      onExecutionClick(execution);
    }
  }, [onExecutionClick]);

  // Close details modal
  const handleCloseDetails = useCallback(() => {
    setShowDetails(false);
    setSelectedExecution(null);
  }, []);

  // Get status color
  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return UI_CONFIG.colors.success;
      case 'failed':
        return UI_CONFIG.colors.error;
      case 'skipped':
        return UI_CONFIG.colors.warning;
      case 'pending':
      case 'executing':
        return UI_CONFIG.colors.info;
      default:
        return 'rgba(255, 255, 255, 0.5)';
    }
  };

  // Get status icon
  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return '✓';
      case 'failed':
        return '✕';
      case 'skipped':
        return '⊘';
      case 'pending':
        return '⋯';
      case 'executing':
        return '↻';
      default:
        return '?';
    }
  };

  // Render statistics bar
  const renderStats = () => (
    <div style={styles.statsBar}>
      <div style={styles.statItem}>
        <div style={styles.statLabel}>Total</div>
        <div style={styles.statValue}>{stats.total}</div>
      </div>
      <div style={styles.statItem}>
        <div style={styles.statLabel}>Completed</div>
        <div style={{ ...styles.statValue, color: UI_CONFIG.colors.success }}>
          {stats.completed}
        </div>
      </div>
      <div style={styles.statItem}>
        <div style={styles.statLabel}>Failed</div>
        <div style={{ ...styles.statValue, color: UI_CONFIG.colors.error }}>
          {stats.failed}
        </div>
      </div>
      <div style={styles.statItem}>
        <div style={styles.statLabel}>Success Rate</div>
        <div style={styles.statValue}>{stats.successRate.toFixed(1)}%</div>
      </div>
      <div style={styles.statItem}>
        <div style={styles.statLabel}>Avg Slippage</div>
        <div style={styles.statValue}>{formatPercentage(stats.avgSlippage)}</div>
      </div>
      <div style={styles.statItem}>
        <div style={styles.statLabel}>Total Gas</div>
        <div style={styles.statValue}>{stats.totalGas.toFixed(4)} MON</div>
      </div>
    </div>
  );

  // Render filters
  const renderFilters = () => {
    if (!showFilters) return null;

    return (
      <div style={styles.filters}>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Status:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">All</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Sort by:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="date">Date</option>
            <option value="amount">Amount</option>
            <option value="slippage">Slippage</option>
            <option value="gas">Gas</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
          style={styles.sortButton}
        >
          {sortOrder === 'asc' ? '↑' : '↓'}
        </button>
      </div>
    );
  };

  // Render execution row
  const renderExecutionRow = (execution, index) => {
    const statusColor = getStatusColor(execution.status);
    const statusIcon = getStatusIcon(execution.status);

    return (
      <motion.div
        key={execution.id || index}
        style={styles.executionRow}
        onClick={() => handleExecutionClick(execution)}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: index * 0.05 }}
        whileHover={{ scale: 1.01, background: UI_CONFIG.colors.accent }}
      >
        <div style={styles.executionLeft}>
          <div style={{ ...styles.statusIcon, background: statusColor }}>
            {statusIcon}
          </div>
          <div style={styles.executionInfo}>
            <div style={styles.executionDate}>
              {formatDateTime(execution.executedAt, { format: 'medium' })}
            </div>
            <div style={styles.executionTokens}>
              {execution.fromToken?.symbol || 'UNKNOWN'} → {execution.toToken?.symbol || 'UNKNOWN'}
            </div>
          </div>
        </div>

        <div style={styles.executionCenter}>
          <div style={styles.executionAmount}>
            {formatTokenAmount(execution.amountIn, execution.fromToken?.decimals || 18, 4)}
            {' '}{execution.fromToken?.symbol}
          </div>
          {execution.status === 'completed' && execution.amountOut && (
            <div style={styles.executionAmountOut}>
              → {formatTokenAmount(execution.amountOut, execution.toToken?.decimals || 18, 4)}
              {' '}{execution.toToken?.symbol}
            </div>
          )}
        </div>

        <div style={styles.executionRight}>
          {execution.status === 'completed' && (
            <>
              <div style={styles.executionSlippage}>
                Slippage: {formatPercentage(execution.actualSlippage || 0)}
              </div>
              <div style={styles.executionGas}>
                Gas: {execution.gasUsed?.toFixed(4) || '0.0000'} MON
              </div>
            </>
          )}
          {execution.status === 'failed' && (
            <div style={styles.executionError}>
              {execution.error || 'Execution failed'}
            </div>
          )}
          {execution.status === 'skipped' && (
            <div style={styles.executionSkipped}>
              {execution.reason || 'Skipped by AI'}
            </div>
          )}
        </div>

        <div style={styles.executionArrow}>→</div>
      </motion.div>
    );
  };

  // Render details modal
  const renderDetailsModal = () => {
    if (!selectedExecution) return null;

    return (
      <AnimatePresence>
        {showDetails && (
          <motion.div
            style={styles.modalOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCloseDetails}
          >
            <motion.div
              style={styles.modal}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={styles.modalHeader}>
                <h3 style={styles.modalTitle}>Execution Details</h3>
                <button
                  type="button"
                  onClick={handleCloseDetails}
                  style={styles.closeButton}
                >
                  ✕
                </button>
              </div>

              <div style={styles.modalBody}>
                <div style={styles.detailSection}>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Status:</span>
                    <span style={{ ...styles.detailValue, color: getStatusColor(selectedExecution.status) }}>
                      {selectedExecution.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Executed At:</span>
                    <span style={styles.detailValue}>
                      {formatDateTime(selectedExecution.executedAt, { format: 'long' })}
                    </span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Transaction Hash:</span>
                    <span style={styles.detailValue}>
                      {selectedExecution.txHash ? (
                         
                          <a
                          href={`https://testnet.monadexplorer.com/tx/${selectedExecution.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.link}
                        >
                          {formatAddress(selectedExecution.txHash, 8, 6)}
                        </a>
                      ) : (
                        'N/A'
                      )}
                    </span>
                  </div>
                </div>

                <div style={styles.detailSection}>
                  <h4 style={styles.detailSectionTitle}>Amounts</h4>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Input:</span>
                    <span style={styles.detailValue}>
                      {formatTokenAmount(selectedExecution.amountIn, selectedExecution.fromToken?.decimals || 18, 6)}
                      {' '}{selectedExecution.fromToken?.symbol}
                    </span>
                  </div>
                  {selectedExecution.amountOut && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Output:</span>
                      <span style={styles.detailValue}>
                        {formatTokenAmount(selectedExecution.amountOut, selectedExecution.toToken?.decimals || 18, 6)}
                        {' '}{selectedExecution.toToken?.symbol}
                      </span>
                    </div>
                  )}
                  {selectedExecution.executionPrice && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Execution Price:</span>
                      <span style={styles.detailValue}>
                        {formatPrice(selectedExecution.executionPrice)}
                      </span>
                    </div>
                  )}
                </div>

                {selectedExecution.status === 'completed' && (
                  <div style={styles.detailSection}>
                    <h4 style={styles.detailSectionTitle}>Execution Metrics</h4>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Actual Slippage:</span>
                      <span style={styles.detailValue}>
                        {formatPercentage(selectedExecution.actualSlippage || 0)}
                      </span>
                    </div>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Gas Used:</span>
                      <span style={styles.detailValue}>
                        {selectedExecution.gasUsed?.toFixed(6) || '0.000000'} MON
                      </span>
                    </div>
                    {selectedExecution.priceImpact && (
                      <div style={styles.detailRow}>
                        <span style={styles.detailLabel}>Price Impact:</span>
                        <span style={styles.detailValue}>
                          {formatPercentage(selectedExecution.priceImpact)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {selectedExecution.aiDecision && (
                  <div style={styles.detailSection}>
                    <h4 style={styles.detailSectionTitle}>AI Decision</h4>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Confidence:</span>
                      <span style={styles.detailValue}>
                        {(selectedExecution.aiDecision.confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Reason:</span>
                      <span style={styles.detailValue}>
                        {selectedExecution.aiDecision.reason}
                      </span>
                    </div>
                    {selectedExecution.aiDecision.adjustedAmount && (
                      <div style={styles.detailRow}>
                        <span style={styles.detailLabel}>Amount Adjusted:</span>
                        <span style={styles.detailValue}>
                          {selectedExecution.aiDecision.adjustedAmount !== selectedExecution.amountIn ? 'Yes' : 'No'}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {selectedExecution.error && (
                  <div style={styles.errorBox}>
                    <strong>Error:</strong> {selectedExecution.error}
                  </div>
                )}
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
      <div style={styles.emptyIcon}>📊</div>
      <div style={styles.emptyTitle}>No Executions Yet</div>
      <div style={styles.emptyText}>
        Execution history will appear here once your DCA strategy starts running.
      </div>
    </div>
  );

  // Render loading state
  const renderLoadingState = () => (
    <div style={styles.loadingContainer}>
      <div className="spinner spinner-lg" />
      <div style={styles.loadingText}>Loading execution history...</div>
    </div>
  );

  // Main render
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Execution History</h3>
        {executions.length > 0 && renderStats()}
      </div>

      {renderFilters()}

      <div style={styles.historyList}>
        {isLoading ? (
          renderLoadingState()
        ) : filteredExecutions.length > 0 ? (
          filteredExecutions.map((execution, index) => renderExecutionRow(execution, index))
        ) : executions.length === 0 ? (
          renderEmptyState()
        ) : (
          <div style={styles.noResults}>No executions match the current filter</div>
        )}
      </div>

      {renderDetailsModal()}
    </div>
  );
};

// Styles
const styles = {
  container: {
    width: '100%',
  },
  header: {
    marginBottom: '1.5rem',
  },
  title: {
    margin: 0,
    marginBottom: '1rem',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.5rem',
    color: UI_CONFIG.colors.text,
  },
  statsBar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '1rem',
    padding: '1rem',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
  },
  statItem: {
    textAlign: 'center',
  },
  statLabel: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: '0.25rem',
  },
  statValue: {
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.125rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.text,
  },
  filters: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'center',
    marginBottom: '1.5rem',
    padding: '1rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  filterLabel: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.7)',
    whiteSpace: 'nowrap',
  },
  filterSelect: {
    padding: '0.5rem 0.75rem',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '6px',
    color: UI_CONFIG.colors.text,
    fontSize: '0.875rem',
    fontFamily: UI_CONFIG.fonts.secondary,
    cursor: 'pointer',
    outline: 'none',
  },
  sortButton: {
    padding: '0.5rem 0.75rem',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '6px',
    color: UI_CONFIG.colors.text,
    fontSize: '1rem',
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.fast,
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  executionRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
  },
  executionLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flex: '0 0 auto',
  },
  statusIcon: {
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
  executionInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  executionDate: {
    fontSize: '0.875rem',
    color: UI_CONFIG.colors.text,
  },
  executionTokens: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)',
    fontFamily: UI_CONFIG.fonts.primary,
  },
  executionCenter: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    padding: '0 1rem',
  },
  executionAmount: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
  },
  executionAmountOut: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  executionRight: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    alignItems: 'flex-end',
    flex: '0 0 auto',
  },
  executionSlippage: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  executionGas: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  executionError: {
    fontSize: '0.75rem',
    color: UI_CONFIG.colors.error,
    maxWidth: '200px',
    textAlign: 'right',
  },
  executionSkipped: {
    fontSize: '0.75rem',
    color: UI_CONFIG.colors.warning,
    maxWidth: '200px',
    textAlign: 'right',
  },
  executionArrow: {
    fontSize: '1.25rem',
    color: 'rgba(255, 255, 255, 0.3)',
    marginLeft: '1rem',
  },
  emptyState: {
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
    maxWidth: '400px',
    margin: '0 auto',
  },
  loadingContainer: {
    padding: '3rem 2rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
  },
  loadingText: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  noResults: {
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
    maxWidth: '600px',
    maxHeight: '90vh',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
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
    overflowY: 'auto',
  },
  detailSection: {
    marginBottom: '1.5rem',
    paddingBottom: '1.5rem',
    borderBottom: `1px solid ${UI_CONFIG.colors.border}`,
  },
  detailSectionTitle: {
    margin: '0 0 1rem 0',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1rem',
    color: UI_CONFIG.colors.text,
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 0',
  },
  detailLabel: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  detailValue: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
    textAlign: 'right',
  },
  link: {
    color: UI_CONFIG.colors.success,
    textDecoration: 'none',
    transition: UI_CONFIG.transitions.fast,
  },
  errorBox: {
    padding: '1rem',
    background: `${UI_CONFIG.colors.error}20`,
    border: `1px solid ${UI_CONFIG.colors.error}`,
    borderRadius: '8px',
    fontSize: '0.875rem',
    color: UI_CONFIG.colors.error,
    lineHeight: '1.5',
  },
};

export default ExecutionHistory;