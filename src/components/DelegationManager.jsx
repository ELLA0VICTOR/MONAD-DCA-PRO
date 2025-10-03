import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { useDelegation } from '../../hooks/useDelegation';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { UI_CONFIG, DELEGATION_CONFIG } from '../../utils/constants';
import { formatAddress, formatDateTime, formatDuration } from '../../utils/formatters';

/**
 * DelegationManager Component
 * 
 * Purpose:
 * Comprehensive delegation management interface for MetaMask Smart Accounts.
 * Displays active delegations, allows creation of new delegations, revocation,
 * and tracking of redemption history. Professional dashboard with filters,
 * search, and detailed delegation cards.
 * 
 * Features:
 * - Active delegation list with status indicators
 * - Create new delegations (root, swap, DCA strategy)
 * - Revoke delegations with reason
 * - Filter by status, type, date range
 * - Search by delegate address
 * - Delegation detail modal
 * - Redemption history
 * - Gas estimation for operations
 * - Real-time status updates
 * 
 * Dependencies:
 * - useDelegation hook
 * - useSmartAccount hook
 * - framer-motion (animations)
 * - react-hot-toast (notifications)
 */

const DelegationManager = ({ onCreateDelegation }) => {
  const {
    delegations,
    activeDelegations,
    redemptions,
    isLoading,
    error,
    stats,
    createRootDelegation,
    revokeDelegation,
    loadDelegations,
    getDelegationsByStatus,
    getDelegationsByType,
    formatDelegationForDisplay,
    estimateCreationGas,
    DELEGATION_STATUS,
    DELEGATION_TYPES
  } = useDelegation();

  const { smartAccount, accountAddress, isDeployed } = useSmartAccount();

  // UI State
  const [view, setView] = useState('list'); // 'list' | 'create' | 'details'
  const [selectedDelegation, setSelectedDelegation] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [isRevoking, setIsRevoking] = useState(false);

  // Load delegations on mount
  useEffect(() => {
    if (isDeployed && accountAddress) {
      loadDelegations();
    }
  }, [isDeployed, accountAddress]);

  // Filter delegations
  const filteredDelegations = delegations.filter(delegation => {
    // Status filter
    if (filterStatus !== 'all' && delegation.status !== filterStatus) {
      return false;
    }

    // Type filter
    if (filterType !== 'all' && delegation.type !== filterType) {
      return false;
    }

    // Search filter
    if (searchQuery && !delegation.delegate.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    return true;
  });

  const handleViewDetails = (delegation) => {
    setSelectedDelegation(delegation);
    setView('details');
  };

  const handleRevoke = async () => {
    if (!selectedDelegation) return;

    setIsRevoking(true);
    try {
      await revokeDelegation(selectedDelegation.id, revokeReason || 'User revoked');
      toast.success('Delegation revoked successfully');
      setShowRevokeModal(false);
      setRevokeReason('');
      setView('list');
      loadDelegations();
    } catch (err) {
      console.error('Revoke failed:', err);
      toast.error(err?.message || String(err) || 'Unexpected error');
    } finally {
      setIsRevoking(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case DELEGATION_STATUS.ACTIVE:
        return UI_CONFIG.colors.success;
      case DELEGATION_STATUS.REDEEMED:
        return UI_CONFIG.colors.info;
      case DELEGATION_STATUS.EXPIRED:
        return UI_CONFIG.colors.warning;
      case DELEGATION_STATUS.REVOKED:
        return UI_CONFIG.colors.error;
      default:
        return 'rgba(255, 255, 255, 0.5)';
    }
  };

  if (!isDeployed) {
    return (
      <div className="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="empty-icon">
          <path
            d="M24 4L4 14v10c0 12 8 23.2 20 26 12-2.8 20-14 20-26V14L24 4z"
            stroke="rgba(255, 255, 255, 0.3)"
            strokeWidth="2"
            fill="none"
          />
        </svg>
        <h3 className="empty-title">Account Not Deployed</h3>
        <p className="empty-text">Deploy your smart account to manage delegations</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="delegation-manager"
    >
      {/* Header */}
      <div className="delegation-header">
        <div className="delegation-header-left">
          <h2 className="delegation-title">Delegations</h2>
          <div className="delegation-stats-bar">
            <div className="stat-item">
              <span className="stat-value">{stats.total}</span>
              <span className="stat-label">Total</span>
            </div>
            <div className="stat-divider" />
            <div className="stat-item">
              <span className="stat-value stat-value-success">
                {stats.active}
              </span>
              <span className="stat-label">Active</span>
            </div>
            <div className="stat-divider" />
            <div className="stat-item">
              <span className="stat-value">{stats.redeemed}</span>
              <span className="stat-label">Redeemed</span>
            </div>
          </div>
        </div>
        {view === 'list' && (
          <button
            onClick={() => setView('create')}
            className="btn btn-primary delegation-create-btn"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 3v10M3 8h10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            New Delegation
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {view === 'list' && (
          <motion.div
            key="list-view"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            {/* Filters */}
            <div className="delegation-filters">
              <div className="filter-group">
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Status</option>
                  <option value={DELEGATION_STATUS.ACTIVE}>Active</option>
                  <option value={DELEGATION_STATUS.REDEEMED}>Redeemed</option>
                  <option value={DELEGATION_STATUS.EXPIRED}>Expired</option>
                  <option value={DELEGATION_STATUS.REVOKED}>Revoked</option>
                </select>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Types</option>
                  <option value={DELEGATION_TYPES.SWAP_EXECUTION}>Swap</option>
                  <option value={DELEGATION_TYPES.DCA_STRATEGY}>DCA Strategy</option>
                  <option value={DELEGATION_TYPES.BATCH_OPERATION}>Batch</option>
                </select>
              </div>
              <input
                type="text"
                placeholder="Search by delegate address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>

            {/* Delegations List */}
            {isLoading ? (
              <div className="loading-container">
                <div className="spinner spinner-lg" />
                <p className="loading-text">Loading delegations...</p>
              </div>
            ) : filteredDelegations.length === 0 ? (
              <div className="empty-state">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="empty-icon">
                  <path
                    d="M24 4L4 14v10c0 12 8 23.2 20 26 12-2.8 20-14 20-26V14L24 4z"
                    stroke="rgba(255, 255, 255, 0.3)"
                    strokeWidth="2"
                    fill="none"
                  />
                </svg>
                <h3 className="empty-title">No Delegations Found</h3>
                <p className="empty-text">
                  {searchQuery || filterStatus !== 'all' || filterType !== 'all'
                    ? 'No delegations match your filter'
                    : 'You dont have any delegations yet. Create one to get started'}
                </p>
              </div>
            ) : (
              <div className="delegation-list">
                {filteredDelegations.map((delegation) => {
                  const formatted = formatDelegationForDisplay(delegation);
                  return (
                    <motion.div
                      key={delegation.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      whileHover={{ scale: 1.02 }}
                      transition={{ duration: 0.2 }}
                      className="delegation-card glass-card"
                      onClick={() => handleViewDetails(delegation)}
                    >
                      {/* Card Header */}
                      <div className="delegation-card-header">
                        <div className="card-header-left">
                          <span className="delegation-type">{formatted.typeLabel}</span>
                          <div
                            className="status-badge"
                            style={{
                              borderColor: getStatusColor(delegation.status),
                            }}
                          >
                            <span
                              className="status-dot"
                              style={{
                                backgroundColor: getStatusColor(delegation.status),
                              }}
                            />
                            <span className="status-text">{formatted.statusLabel}</span>
                          </div>
                        </div>
                        <button
                          className="card-action-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewDetails(delegation);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path
                              d="M6 12l4-4-4-4"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>

                      {/* Delegate Info */}
                      <div className="delegate-info">
                        <span className="delegate-label">Delegate</span>
                        <code className="delegate-address">{formatAddress(delegation.delegate)}</code>
                      </div>

                      {/* Caveats Summary */}
                      {delegation.caveats && delegation.caveats.length > 0 && (
                        <div className="caveats-section">
                          <span className="caveats-label">
                            {delegation.caveats.length} Restriction{delegation.caveats.length !== 1 ? 's' : ''}
                          </span>
                          <div className="caveats-list">
                            {delegation.caveats.slice(0, 2).map((caveat, idx) => (
                              <span key={idx} className="caveat-tag">
                                {caveat.type}
                              </span>
                            ))}
                            {delegation.caveats.length > 2 && (
                              <span className="caveat-tag">+{delegation.caveats.length - 2}</span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Footer */}
                      <div className="delegation-card-footer">
                        <span className="footer-text">
                          {formatted.expiryLabel || 'No expiry'}
                        </span>
                        {delegation.metadata?.createdAt && (
                          <span className="footer-text">
                            {formatDateTime(delegation.metadata.createdAt, { format: 'short' })}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {view === 'details' && selectedDelegation && (
          <motion.div
            key="details-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="details-view"
          >
            <button onClick={() => setView('list')} className="btn btn-ghost back-button">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M10 12L6 8l4-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Back to List
            </button>

            <div className="details-card glass-card">
              <div className="details-header">
                <h3 className="details-title">Delegation Details</h3>
                <div
                  className="status-badge"
                  style={{
                    borderColor: getStatusColor(selectedDelegation.status),
                  }}
                >
                  <span
                    className="status-dot"
                    style={{
                      backgroundColor: getStatusColor(selectedDelegation.status),
                    }}
                  />
                  <span className="status-text">{selectedDelegation.status}</span>
                </div>
              </div>

              <div className="details-grid">
                <div className="detail-item">
                  <span className="detail-label">ID</span>
                  <code className="detail-value">{formatAddress(selectedDelegation.id)}</code>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Type</span>
                  <span className="detail-value">{selectedDelegation.type}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Delegator</span>
                  <code className="detail-value">{formatAddress(selectedDelegation.delegator)}</code>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Delegate</span>
                  <code className="detail-value">{formatAddress(selectedDelegation.delegate)}</code>
                </div>
                {selectedDelegation.expiryTime && (
                  <div className="detail-item">
                    <span className="detail-label">Expires</span>
                    <span className="detail-value">
                      {formatDateTime(selectedDelegation.expiryTime * 1000)}
                    </span>
                  </div>
                )}
              </div>

              {selectedDelegation.caveats && selectedDelegation.caveats.length > 0 && (
                <div className="caveats-detail">
                  <h4 className="section-title">Restrictions</h4>
                  {selectedDelegation.caveats.map((caveat, idx) => (
                    <div key={idx} className="caveat-detail">
                      <span className="caveat-type">{caveat.type}</span>
                      <pre className="caveat-terms">
                        {JSON.stringify(caveat.terms, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}

              {selectedDelegation.status === DELEGATION_STATUS.ACTIVE && (
                <button
                  onClick={() => setShowRevokeModal(true)}
                  className="btn btn-danger revoke-button"
                >
                  Revoke Delegation
                </button>
              )}
            </div>
          </motion.div>
        )}

        {view === 'create' && (
          <motion.div
            key="create-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <button onClick={() => setView('list')} className="btn btn-ghost back-button">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M10 12L6 8l4-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Back to List
            </button>

            <div className="empty-state">
              <h3 className="empty-title">Create New Delegation</h3>
              <p className="empty-text">
                Use the DCA Strategy Builder or Swap components to create delegations
              </p>
              {onCreateDelegation && (
                <button onClick={onCreateDelegation} className="btn btn-primary">
                  Go to Strategy Builder
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Revoke Modal */}
      <AnimatePresence>
        {showRevokeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-overlay"
            onClick={() => setShowRevokeModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal glass-card"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="modal-title">Revoke Delegation</h3>
              <p className="modal-text">
                This will permanently revoke the delegation. The delegate will no longer be able to
                execute actions on your behalf.
              </p>
              <div className="form-group">
                <label className="form-label">Reason (optional)</label>
                <input
                  type="text"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="e.g., No longer needed"
                  className="form-input"
                />
              </div>
              <div className="modal-actions">
                <button
                  onClick={() => setShowRevokeModal(false)}
                  className="btn btn-secondary"
                  disabled={isRevoking}
                >
                  Cancel
                </button>
                <button
                  onClick={handleRevoke}
                  className="btn btn-danger"
                  disabled={isRevoking}
                >
                  {isRevoking ? (
                    <span className="btn-loading">
                      <span className="spinner" />
                      Revoking...
                    </span>
                  ) : (
                    'Revoke'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default DelegationManager;