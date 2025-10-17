import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDateTime, formatTokenAmount, formatAddress } from '../../utils/formatters';

const ExecutionHistory = ({ 
  executions = [],
  isLoading = false,
  onExecutionClick
}) => {
  const [filter, setFilter] = useState('all');
  const [selectedExecution, setSelectedExecution] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const filteredExecutions = useMemo(() => {
    if (filter === 'all') return executions;
    return executions.filter(exec => exec.status === filter);
  }, [executions, filter]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return '#22c55e';
      case 'failed': return '#ef4444';
      case 'pending': return '#fbbf24';
      default: return 'rgba(255, 255, 255, 0.4)';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return '✓';
      case 'failed': return '✕';
      case 'pending': return '⋯';
      default: return '?';
    }
  };

  const handleExecutionClick = (execution) => {
    setSelectedExecution(execution);
    setShowDetails(true);
    if (onExecutionClick) onExecutionClick(execution);
  };

  const handleCloseDetails = () => {
    setShowDetails(false);
    setSelectedExecution(null);
  };

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
        transition={{ delay: index * 0.03 }}
      >
        <div style={styles.executionLeft}>
          <div style={{ ...styles.statusIcon, background: statusColor }}>
            {statusIcon}
          </div>
          <div style={styles.executionInfo}>
            <div style={styles.executionTokens}>
              {execution.fromToken?.symbol || 'MON'} → {execution.toToken?.symbol || 'USDC'}
            </div>
            <div style={styles.executionDate}>
              {formatDateTime(execution.executedAt || Date.now(), { format: 'medium' })}
            </div>
          </div>
        </div>

        <div style={styles.executionCenter}>
          <div style={styles.executionAmount}>
            {formatTokenAmount(execution.amountIn || '0', execution.fromToken?.decimals || 18, 4)}
            {' '}{execution.fromToken?.symbol || 'MON'}
          </div>
          {execution.status === 'completed' && execution.amountOut && (
            <div style={styles.executionAmountOut}>
              → {formatTokenAmount(execution.amountOut, execution.toToken?.decimals || 18, 4)}
              {' '}{execution.toToken?.symbol || 'USDC'}
            </div>
          )}
        </div>

        <div style={styles.executionRight}>
          {execution.txHash && (
            <a
              href={`https://testnet.monadexplorer.com/tx/${execution.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.txLink}
              onClick={(e) => e.stopPropagation()}
            >
              View Tx ↗
            </a>
          )}
        </div>
      </motion.div>
    );
  };

  const renderDetailsModal = () => {
    if (!selectedExecution) return null;

    return (
      <AnimatePresence>
        {showDetails && (
          <>
            <motion.div
              style={styles.modalOverlay}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseDetails}
            />
            <motion.div
              style={styles.modal}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div style={styles.modalHeader}>
                <h3 style={styles.modalTitle}>Execution Details</h3>
                <button onClick={handleCloseDetails} style={styles.closeButton}>
                  ✕
                </button>
              </div>

              <div style={styles.modalBody}>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Status</span>
                  <span style={{ 
                    ...styles.detailValue, 
                    color: getStatusColor(selectedExecution.status) 
                  }}>
                    {selectedExecution.status}
                  </span>
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Time</span>
                  <span style={styles.detailValue}>
                    {formatDateTime(selectedExecution.executedAt || Date.now(), { format: 'long' })}
                  </span>
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>From</span>
                  <span style={styles.detailValue}>
                    {formatTokenAmount(selectedExecution.amountIn || '0', selectedExecution.fromToken?.decimals || 18, 6)}
                    {' '}{selectedExecution.fromToken?.symbol || 'MON'}
                  </span>
                </div>
                {selectedExecution.amountOut && (
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>To</span>
                    <span style={styles.detailValue}>
                      {formatTokenAmount(selectedExecution.amountOut, selectedExecution.toToken?.decimals || 18, 6)}
                      {' '}{selectedExecution.toToken?.symbol || 'USDC'}
                    </span>
                  </div>
                )}
                {selectedExecution.txHash && (
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Transaction</span>
                    <a
                      href={`https://testnet.monadexplorer.com/tx/${selectedExecution.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={styles.detailLink}
                    >
                      {formatAddress(selectedExecution.txHash, 8, 6)} ↗
                    </a>
                  </div>
                )}
                {selectedExecution.gasUsed && (
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Gas Used</span>
                    <span style={styles.detailValue}>
                      {selectedExecution.gasUsed.toFixed(6)} MON
                    </span>
                  </div>
                )}
                {selectedExecution.error && (
                  <div style={styles.errorBox}>
                    {selectedExecution.error}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  };

  const renderEmptyState = () => (
    <div style={styles.emptyState}>
      <svg width="80" height="80" viewBox="0 0 24 24" fill="none" style={styles.emptyIcon}>
        <circle cx="12" cy="12" r="10" stroke="rgba(255, 255, 255, 0.2)" strokeWidth="1.5"/>
        <path d="M12 8v4M12 16h.01" stroke="rgba(255, 255, 255, 0.2)" strokeWidth="2" strokeLinecap="round"/>
      </svg>
      <div style={styles.emptyTitle}>No Execution History</div>
      <div style={styles.emptyText}>
        Swap executions will appear here once your strategies start running
      </div>
    </div>
  );

  const renderLoadingState = () => (
    <div style={styles.loadingContainer}>
      <div className="spinner" style={{width: '32px', height: '32px', borderWidth: '3px'}} />
    </div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Execution History</h3>
          <p style={styles.subtitle}>Track your DCA swap executions</p>
        </div>
        {executions.length > 0 && (
          <select 
            value={filter} 
            onChange={(e) => setFilter(e.target.value)} 
            style={styles.filterSelect}
          >
            <option value="all">All</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
        )}
      </div>

      <div style={styles.historyList}>
        {isLoading ? (
          renderLoadingState()
        ) : filteredExecutions.length > 0 ? (
          filteredExecutions.map((execution, index) => renderExecutionRow(execution, index))
        ) : executions.length === 0 ? (
          renderEmptyState()
        ) : (
          <div style={styles.noResults}>
            No executions match the current filter
          </div>
        )}
      </div>

      {renderDetailsModal()}
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
    marginBottom: '1.5rem',
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
  filterSelect: {
    padding: '0.5rem 0.875rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '0.8125rem',
    fontWeight: '500',
    cursor: 'pointer',
    outline: 'none'
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  executionRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    gap: '1rem'
  },
  executionLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.875rem',
    flex: '0 0 auto'
  },
  statusIcon: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.875rem',
    fontWeight: 'bold',
    color: '#000000',
    flexShrink: 0
  },
  executionInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  executionTokens: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#ffffff'
  },
  executionDate: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)'
  },
  executionCenter: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    minWidth: 0
  },
  executionAmount: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#ffffff'
  },
  executionAmountOut: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)'
  },
  executionRight: {
    flex: '0 0 auto'
  },
  txLink: {
    fontSize: '0.8125rem',
    color: '#a78bfa',
    textDecoration: 'none',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4rem 2rem',
    textAlign: 'center'
  },
  emptyIcon: {
    marginBottom: '1.5rem'
  },
  emptyTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: '0.5rem'
  },
  emptyText: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.4)',
    maxWidth: '320px'
  },
  loadingContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '4rem'
  },
  noResults: {
    padding: '3rem 2rem',
    textAlign: 'center',
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.5)'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(4px)',
    zIndex: 1000
  },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '90%',
    maxWidth: '500px',
    background: 'rgba(20, 20, 20, 0.98)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '12px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
    zIndex: 1001,
    overflow: 'hidden'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.25rem',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
  },
  modalTitle: {
    margin: 0,
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#ffffff'
  },
  closeButton: {
    width: '32px',
    height: '32px',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: 'rgba(255, 255, 255, 0.6)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.125rem',
    transition: 'all 0.2s'
  },
  modalBody: {
    padding: '1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.625rem 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
  },
  detailLabel: {
    fontSize: '0.8125rem',
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500'
  },
  detailValue: {
    fontSize: '0.8125rem',
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'right'
  },
  detailLink: {
    fontSize: '0.8125rem',
    color: '#a78bfa',
    textDecoration: 'none',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  errorBox: {
    padding: '0.875rem',
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '8px',
    fontSize: '0.8125rem',
    color: '#ef4444',
    lineHeight: '1.4'
  }
};

export default ExecutionHistory;