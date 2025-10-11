import { motion } from 'framer-motion';
import { formatPercentage } from '../../utils/formatters';

const AIRecommendationModal = ({ isOpen, onClose, recommendation }) => {
  if (!isOpen || !recommendation) return null;

  const { originalAmount, suggestedAmount, reason, confidence, onAccept, onReject } = recommendation;

  return (
    <motion.div
      style={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        style={styles.modal}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.header}>
          <div style={styles.headerContent}>
            <div style={styles.aiIcon}>🤖</div>
            <div>
              <h3 style={styles.title}>AI Recommendation</h3>
              <div style={styles.confidence}>
                Confidence: {formatPercentage(confidence)}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        <div style={styles.body}>
          <div style={styles.recommendation}>
            <div style={styles.recommendationLabel}>Suggested Amount</div>
            <div style={styles.recommendationValue}>{suggestedAmount}</div>
            <div style={styles.comparisonRow}>
              <span style={styles.originalAmount}>Original: {originalAmount}</span>
              <span style={styles.changeIndicator}>
                {((parseFloat(suggestedAmount) - parseFloat(originalAmount)) / parseFloat(originalAmount) * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          <div style={styles.reasonBox}>
            <div style={styles.reasonLabel}>Reason</div>
            <div style={styles.reasonText}>{reason}</div>
          </div>

          <div style={styles.infoBox}>
            ℹ️ The AI has analyzed market conditions and suggests this adjustment for optimal execution.
          </div>
        </div>

        <div style={styles.footer}>
          <button 
            onClick={() => {
              onReject?.();
              onClose();
            }} 
            style={styles.btnSecondary}
          >
            Keep Original
          </button>
          <button 
            onClick={() => {
              onAccept?.();
              onClose();
            }} 
            style={styles.btnPrimary}
          >
            Use AI Amount
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const styles = {
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '2rem' },
  modal: { width: '100%', maxWidth: '480px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' },
  header: { padding: '1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  headerContent: { display: 'flex', alignItems: 'center', gap: '1rem' },
  aiIcon: { fontSize: '2rem' },
  title: { margin: 0, fontFamily: 'var(--font-primary)', fontSize: '1.25rem', color: 'var(--text-primary)' },
  confidence: { fontSize: '0.75rem', color: 'var(--primary)', marginTop: '0.25rem' },
  closeButton: { width: '32px', height: '32px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  body: { padding: '1.5rem' },
  recommendation: { padding: '1.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '12px', marginBottom: '1.5rem', textAlign: 'center' },
  recommendationLabel: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' },
  recommendationValue: { fontFamily: 'var(--font-primary)', fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '0.75rem' },
  comparisonRow: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', fontSize: '0.875rem' },
  originalAmount: { color: 'rgba(255,255,255,0.6)' },
  changeIndicator: { padding: '4px 8px', background: 'rgba(168,85,247,0.2)', border: '1px solid var(--primary)', borderRadius: '6px', color: 'var(--primary)', fontSize: '0.75rem', fontWeight: '600' },
  reasonBox: { padding: '1rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '1rem' },
  reasonLabel: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' },
  reasonText: { fontSize: '0.875rem', color: 'var(--text-primary)', lineHeight: '1.6' },
  infoBox: { padding: '0.75rem', background: 'rgba(168,85,247,0.1)', border: '1px solid var(--primary)', borderRadius: '8px', fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)', lineHeight: '1.5' },
  footer: { padding: '1.5rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '1rem' },
  btnPrimary: { flex: 1, padding: '0.75rem', background: 'linear-gradient(135deg, var(--primary), var(--primary-hover))', border: 'none', borderRadius: '8px', color: 'var(--bg-primary)', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' },
  btnSecondary: { flex: 1, padding: '0.75rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '1rem', fontWeight: '600', cursor: 'pointer' },
};

export default AIRecommendationModal;