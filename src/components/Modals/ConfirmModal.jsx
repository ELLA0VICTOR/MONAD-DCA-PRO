import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { parseUnits } from 'viem';
import { useWallet } from '../../hooks/useWallet';
import { useMonadBalance } from '../../hooks/useMonadBalance';
import { userOperationsService } from '../../services/smartAccount/userOperations';
import { formatTokenAmount } from '../../utils/formatters';
import { SUPPORTED_TOKENS } from '../../utils/constants';

const WithdrawModal = ({ isOpen, onClose, smartAccount }) => {
  const { address: eoaAddress } = useWallet();
  const { balances } = useMonadBalance(smartAccount?.address);
  
  const [selectedToken, setSelectedToken] = useState(SUPPORTED_TOKENS[0].address);
  const [amount, setAmount] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const token = SUPPORTED_TOKENS.find(t => t.address === selectedToken);
  const tokenBalance = balances[token?.symbol];

  const handleQuickAmount = useCallback((percentage) => {
    if (!tokenBalance) return;
    const reserveGas = token.isNative ? 0.01 : 0; // Reserve 0.01 MON for gas
    const maxWithdrawable = Math.max(0, parseFloat(tokenBalance.formatted) - reserveGas);
    const value = maxWithdrawable * (percentage / 100);
    setAmount(value.toFixed(6));
  }, [tokenBalance, token]);

  const handleWithdraw = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter valid amount');
      return;
    }

    if (!smartAccount || !eoaAddress) {
      toast.error('Invalid account state');
      return;
    }

    setIsWithdrawing(true);
    try {
      const amountWei = parseUnits(amount, token.decimals);
      
      await userOperationsService.createTokenTransfer({
        smartAccountClient: smartAccount,
        to: eoaAddress,
        amount: amountWei,
        tokenAddress: token.isNative ? null : token.address,
      });

      toast.success('Withdrawal successful!');
      onClose();
      setAmount('');
    } catch (error) {
      console.error('Withdraw error:', error);
      toast.error(error?.message || 'Withdrawal failed');
    } finally {
      setIsWithdrawing(false);
    }
  }, [amount, token, smartAccount, eoaAddress, onClose]);

  if (!isOpen) return null;

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
          <h3 style={styles.title}>Withdraw from Smart Account</h3>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        <div style={styles.body}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Token</label>
            <select
              value={selectedToken}
              onChange={(e) => setSelectedToken(e.target.value)}
              style={styles.select}
            >
              {SUPPORTED_TOKENS.map(t => (
                <option key={t.address} value={t.address}>{t.symbol}</option>
              ))}
            </select>
          </div>

          <div style={styles.formGroup}>
            <div style={styles.labelRow}>
              <label style={styles.label}>Amount</label>
              {tokenBalance && (
                <span style={styles.balance}>
                  Available: {tokenBalance.formatted} {token.symbol}
                </span>
              )}
            </div>
            <div style={styles.quickButtons}>
              {[25, 50, 75].map(pct => (
                <button key={pct} onClick={() => handleQuickAmount(pct)} style={styles.quickBtn}>
                  {pct}%
                </button>
              ))}
              <button onClick={() => handleQuickAmount(100)} style={styles.quickBtn}>Max</button>
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              style={styles.input}
            />
          </div>

          {token?.isNative && (
            <div style={styles.warningBox}>
              ⚠️ 0.01 MON will be reserved for gas fees
            </div>
          )}

          <div style={styles.recipientBox}>
            <div style={styles.recipientLabel}>Recipient (Your EOA)</div>
            <div style={styles.recipientAddress}>{eoaAddress?.slice(0, 10)}...{eoaAddress?.slice(-8)}</div>
          </div>
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.btnSecondary} disabled={isWithdrawing}>
            Cancel
          </button>
          <button onClick={handleWithdraw} style={styles.btnPrimary} disabled={isWithdrawing}>
            {isWithdrawing ? (
              <>
                <div className="spinner" style={{marginRight: '8px'}} />
                Withdrawing...
              </>
            ) : (
              'Confirm Withdrawal'
            )}
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
  title: { margin: 0, fontFamily: 'var(--font-primary)', fontSize: '1.25rem', color: 'var(--text-primary)' },
  closeButton: { width: '32px', height: '32px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  body: { padding: '1.5rem' },
  formGroup: { marginBottom: '1.5rem' },
  labelRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' },
  label: { fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)' },
  balance: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' },
  select: { width: '100%', padding: '0.75rem', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '1rem' },
  quickButtons: { display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' },
  quickBtn: { flex: 1, padding: '0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.75rem', cursor: 'pointer' },
  input: { width: '100%', padding: '1rem', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 'bold' },
  warningBox: { padding: '0.75rem', background: 'rgba(245,158,11,0.1)', border: '1px solid var(--warning)', borderRadius: '8px', fontSize: '0.875rem', color: 'var(--warning)', marginBottom: '1rem' },
  recipientBox: { padding: '1rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px' },
  recipientLabel: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' },
  recipientAddress: { fontFamily: 'var(--font-primary)', fontSize: '0.875rem', color: 'var(--text-primary)' },
  footer: { padding: '1.5rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '1rem', justifyContent: 'flex-end' },
  btnPrimary: { padding: '0.75rem 2rem', background: 'linear-gradient(135deg, var(--primary), var(--primary-hover))', border: 'none', borderRadius: '8px', color: 'var(--bg-primary)', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center' },
  btnSecondary: { padding: '0.75rem 2rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '1rem', fontWeight: '600', cursor: 'pointer' },
};

export default WithdrawModal;