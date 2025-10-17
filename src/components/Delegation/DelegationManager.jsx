import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { useDelegation } from '../../hooks/useDelegation';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { formatAddress, formatDateTime } from '../../utils/formatters';

const DelegationManager = ({ onCreateDelegation }) => {
  const {
    delegations,
    isLoading,
    stats,
    revokeDelegation,
    loadDelegations,
    formatDelegationForDisplay,
    DELEGATION_STATUS,
    DELEGATION_TYPES
  } = useDelegation();

  const { accountAddress, isDeployed } = useSmartAccount();

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDelegation, setSelectedDelegation] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [isRevoking, setIsRevoking] = useState(false);

  useEffect(() => {
    if (isDeployed && accountAddress) {
      loadDelegations();
    }
  }, [isDeployed, accountAddress]);

  const filteredDelegations = delegations.filter(delegation => {
    if (filterStatus !== 'all' && delegation.status !== filterStatus) return false;
    if (filterType !== 'all' && delegation.type !== filterType) return false;
    if (searchQuery && !delegation.delegate.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const handleRevoke = async () => {
    if (!selectedDelegation) return;
    setIsRevoking(true);
    try {
      await revokeDelegation(selectedDelegation.id, revokeReason || 'User revoked');
      toast.success('Delegation revoked successfully');
      setShowRevokeModal(false);
      setRevokeReason('');
      setShowDetails(false);
      loadDelegations();
    } catch (err) {
      toast.error(err?.message || 'Failed to revoke delegation');
    } finally {
      setIsRevoking(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case DELEGATION_STATUS.ACTIVE: return '#a78bfa';
      case DELEGATION_STATUS.REDEEMED: return '#60a5fa';
      case DELEGATION_STATUS.EXPIRED: return '#fbbf24';
      case DELEGATION_STATUS.REVOKED: return '#ef4444';
      default: return 'rgba(255, 255, 255, 0.5)';
    }
  };

  if (!isDeployed) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
            <path d="M12 2L2 7v6c0 5.5 3.8 10.7 10 12 6.2-1.3 10-6.5 10-12V7l-10-5z"/>
          </svg>
          <h3 style={styles.emptyTitle}>Account Not Deployed</h3>
          <p style={styles.emptyText}>Deploy your smart account to manage delegations</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Delegations</h2>
          <p style={styles.subtitle}>Manage permissions for automated actions</p>
        </div>
        <button onClick={() => onCreateDelegation?.()} style={styles.createButton}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          New Delegation
        </button>
      </div>

      {/* Stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.total}</div>
          <div style={styles.statLabel}>Total</div>
        </div>
        <div style={styles.statCard}>
          <div style={{...styles.statValue, color: '#a78bfa'}}>{stats.active}</div>
          <div style={styles.statLabel}>Active</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.redeemed}</div>
          <div style={styles.statLabel}>Redeemed</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.expired || 0}</div>
          <div style={styles.statLabel}>Expired</div>
        </div>
      </div>

      {/* Filters */}
      <div style={styles.filtersRow}>
        <div style={styles.filterGroup}>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={styles.select}>
            <option value="all">All Status</option>
            <option value={DELEGATION_STATUS.ACTIVE}>Active</option>
            <option value={DELEGATION_STATUS.REDEEMED}>Redeemed</option>
            <option value={DELEGATION_STATUS.EXPIRED}>Expired</option>
            <option value={DELEGATION_STATUS.REVOKED}>Revoked</option>
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={styles.select}>
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
          style={styles.searchInput}
        />
      </div>

      {/* Delegations List */}
      {isLoading ? (
        <div style={styles.loadingContainer}>
          <div className="spinner" style={{width: '32px', height: '32px', borderWidth: '3px'}} />
          <p style={styles.loadingText}>Loading delegations...</p>
        </div>
      ) : filteredDelegations.length === 0 ? (
        <div style={styles.emptyState}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
            <path d="M12 2L2 7v6c0 5.5 3.8 10.7 10 12 6.2-1.3 10-6.5 10-12V7l-10-5z"/>
          </svg>
          <h3 style={styles.emptyTitle}>No Delegations Found</h3>
          <p style={styles.emptyText}>
            {searchQuery || filterStatus !== 'all' || filterType !== 'all'
              ? 'No delegations match your filters'
              : 'Create your first delegation to get started'}
          </p>
        </div>
      ) : (
        <div style={styles.delegationsList}>
          {filteredDelegations.map((delegation) => {
            const formatted = formatDelegationForDisplay(delegation);
            return (
              <motion.div
                key={delegation.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                style={styles.delegationCard}
                onClick={() => {
                  setSelectedDelegation(delegation);
                  setShowDetails(true);
                }}
              >
                <div style={styles.cardHeader}>
                  <div style={styles.cardHeaderLeft}>
                    <span style={styles.delegationType}>{formatted.typeLabel}</span>
                    <div style={styles.statusBadge}>
                      <div style={{...styles.statusDot, background: getStatusColor(delegation.status)}} />
                      <span style={styles.statusText}>{formatted.statusLabel}</span>
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>

                <div style={styles.cardBody}>
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Delegate</span>
                    <code style={styles.infoValue}>{formatAddress(delegation.delegate)}</code>
                  </div>
                  {delegation.caveats && delegation.caveats.length > 0 && (
                    <div style={styles.caveatsRow}>
                      <span style={styles.caveatsLabel}>
                        {delegation.caveats.length} Restriction{delegation.caveats.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                </div>

                <div style={styles.cardFooter}>
                  <span style={styles.footerText}>{formatted.expiryLabel || 'No expiry'}</span>
                  {delegation.metadata?.createdAt && (
                    <span style={styles.footerText}>
                      {formatDateTime(delegation.metadata.createdAt, { format: 'short' })}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Details Modal */}
      <AnimatePresence>
        {showDetails && selectedDelegation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={styles.modalOverlay}
            onClick={() => setShowDetails(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={styles.modal}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={styles.modalHeader}>
                <h3 style={styles.modalTitle}>Delegation Details</h3>
                <button onClick={() => setShowDetails(false)} style={styles.closeButton}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              <div style={styles.modalBody}>
                <div style={styles.detailSection}>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Status</span>
                    <div style={styles.statusBadge}>
                      <div style={{...styles.statusDot, background: getStatusColor(selectedDelegation.status)}} />
                      <span style={styles.statusText}>{selectedDelegation.status}</span>
                    </div>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Type</span>
                    <span style={styles.detailValue}>{selectedDelegation.type}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Delegator</span>
                    <code style={styles.detailValueCode}>{formatAddress(selectedDelegation.delegator)}</code>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Delegate</span>
                    <code style={styles.detailValueCode}>{formatAddress(selectedDelegation.delegate)}</code>
                  </div>
                  {selectedDelegation.expiryTime && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Expires</span>
                      <span style={styles.detailValue}>
                        {formatDateTime(selectedDelegation.expiryTime * 1000)}
                      </span>
                    </div>
                  )}
                </div>

                {selectedDelegation.caveats && selectedDelegation.caveats.length > 0 && (
                  <div style={styles.detailSection}>
                    <h4 style={styles.sectionTitle}>Restrictions</h4>
                    {selectedDelegation.caveats.map((caveat, idx) => (
                      <div key={idx} style={styles.caveatCard}>
                        <span style={styles.caveatType}>{caveat.type}</span>
                        <pre style={styles.caveatTerms}>{JSON.stringify(caveat.terms, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                )}

                {selectedDelegation.status === DELEGATION_STATUS.ACTIVE && (
                  <button onClick={() => setShowRevokeModal(true)} style={styles.revokeButton}>
                    Revoke Delegation
                  </button>
                )}
              </div>
            </motion.div>
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
            style={styles.modalOverlay}
            onClick={() => setShowRevokeModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={styles.modal}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={styles.modalHeader}>
                <h3 style={styles.modalTitle}>Revoke Delegation</h3>
                <button onClick={() => setShowRevokeModal(false)} style={styles.closeButton}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              <div style={styles.modalBody}>
                <p style={styles.warningText}>
                  This will permanently revoke the delegation. The delegate will no longer be able to execute actions on your behalf.
                </p>
                <div style={styles.formGroup}>
                  <label style={styles.formLabel}>Reason (optional)</label>
                  <input
                    type="text"
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    placeholder="e.g., No longer needed"
                    style={styles.input}
                  />
                </div>
                <div style={styles.modalActions}>
                  <button onClick={() => setShowRevokeModal(false)} style={styles.cancelButton} disabled={isRevoking}>
                    Cancel
                  </button>
                  <button onClick={handleRevoke} style={styles.confirmRevokeButton} disabled={isRevoking}>
                    {isRevoking ? (
                      <>
                        <div className="spinner" style={{width: '14px', height: '14px', borderWidth: '2px', marginRight: '8px'}} />
                        Revoking...
                      </>
                    ) : (
                      'Revoke'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const styles = {
  container: { width: '100%', maxWidth: '1200px', margin: '0 auto', padding: '2rem' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' },
  title: { margin: 0, fontSize: '1.5rem', fontWeight: '600', color: '#ffffff' },
  subtitle: { margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)' },
  createButton: { padding: '0.625rem 1.25rem', background: '#a78bfa', border: 'none', borderRadius: '8px', color: '#000000', fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2rem' },
  statCard: { padding: '1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', textAlign: 'center' },
  statValue: { fontSize: '1.75rem', fontWeight: '700', color: '#ffffff', marginBottom: '0.25rem' },
  statLabel: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  filtersRow: { display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' },
  filterGroup: { display: 'flex', gap: '0.5rem', flex: '1' },
  select: { padding: '0.625rem 1rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#ffffff', fontSize: '0.875rem', cursor: 'pointer', flex: '1', minWidth: '150px' },
  searchInput: { padding: '0.625rem 1rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#ffffff', fontSize: '0.875rem', flex: '2', minWidth: '200px' },
  delegationsList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' },
  delegationCard: { padding: '1.25rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  cardHeaderLeft: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  delegationType: { fontSize: '0.875rem', fontWeight: '600', color: '#ffffff' },
  statusBadge: { display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0.625rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px' },
  statusDot: { width: '6px', height: '6px', borderRadius: '50%' },
  statusText: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)' },
  cardBody: { marginBottom: '1rem' },
  infoRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' },
  infoLabel: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' },
  infoValue: { fontSize: '0.875rem', fontFamily: 'monospace', color: '#ffffff' },
  caveatsRow: { marginTop: '0.75rem' },
  caveatsLabel: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' },
  cardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.1)' },
  footerText: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' },
  emptyState: { padding: '4rem 2rem', textAlign: 'center' },
  emptyTitle: { fontSize: '1.25rem', fontWeight: '600', color: '#ffffff', marginTop: '1rem', marginBottom: '0.5rem' },
  emptyText: { fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)', maxWidth: '400px', margin: '0 auto' },
  loadingContainer: { padding: '4rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' },
  loadingText: { fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' },
  modal: { width: '100%', maxWidth: '600px', maxHeight: '90vh', background: 'rgba(20,20,20,0.98)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '16px', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  modalHeader: { padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { margin: 0, fontSize: '1.25rem', fontWeight: '600', color: '#ffffff' },
  closeButton: { width: '32px', height: '32px', padding: 0, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' },
  modalBody: { padding: '1.5rem', overflowY: 'auto' },
  detailSection: { marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)' },
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0' },
  detailLabel: { fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)' },
  detailValue: { fontSize: '0.875rem', fontWeight: '500', color: '#ffffff' },
  detailValueCode: { fontSize: '0.875rem', fontFamily: 'monospace', fontWeight: '500', color: '#ffffff' },
  sectionTitle: { margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: '600', color: '#ffffff' },
  caveatCard: { padding: '1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', marginBottom: '0.75rem' },
  caveatType: { fontSize: '0.875rem', fontWeight: '600', color: '#a78bfa', display: 'block', marginBottom: '0.5rem' },
  caveatTerms: { fontSize: '0.75rem', fontFamily: 'monospace', color: 'rgba(255,255,255,0.7)', background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '6px', overflow: 'auto', margin: 0 },
  revokeButton: { width: '100%', padding: '0.875rem', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: '8px', color: '#ef4444', fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s' },
  warningText: { fontSize: '0.875rem', color: 'rgba(255,255,255,0.7)', lineHeight: '1.6', marginBottom: '1.5rem' },
  formGroup: { marginBottom: '1.5rem' },
  formLabel: { display: 'block', fontSize: '0.875rem', fontWeight: '500', color: 'rgba(255,255,255,0.7)', marginBottom: '0.5rem' },
  input: { width: '100%', padding: '0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#ffffff', fontSize: '0.875rem' },
  modalActions: { display: 'flex', gap: '0.75rem' },
  cancelButton: { flex: 1, padding: '0.875rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: 'rgba(255,255,255,0.7)', fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s' },
  confirmRevokeButton: { flex: 1, padding: '0.875rem', background: '#ef4444', border: 'none', borderRadius: '8px', color: '#ffffff', fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center' }
};

const spinnerCSS = `
  .spinner {
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 50%;
    border-top-color: #a78bfa;
    width: 16px;
    height: 16px;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = spinnerCSS;
  document.head.appendChild(style);
}

export default DelegationManager;