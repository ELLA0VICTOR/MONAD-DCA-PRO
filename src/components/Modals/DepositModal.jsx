import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { parseUnits, encodeFunctionData } from 'viem';
import { useWallet } from '../../hooks/useWallet';
import { useMonadBalance } from '../../hooks/useMonadBalance';
import { formatTokenAmount } from '../../utils/formatters';
import { SUPPORTED_TOKENS } from '../../utils/constants';

// ERC-20 ABI (for ERC-20 transfers only)
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  }
];

const DepositModal = ({ isOpen, onClose, smartAccountAddress }) => {
  const { address: eoaAddress, walletClient } = useWallet();
  const { balances } = useMonadBalance(eoaAddress);
  
  const [selectedToken, setSelectedToken] = useState(SUPPORTED_TOKENS[0].address);
  const [amount, setAmount] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);

  const token = SUPPORTED_TOKENS.find(t => t.address === selectedToken);
  const tokenBalance = balances[token?.symbol];

  const handleQuickAmount = useCallback((percentage) => {
    if (!tokenBalance) return;
    const value = (Number(tokenBalance.raw) * percentage / 100).toString();
    const formatted = formatTokenAmount(value, token.decimals, 6);
    setAmount(formatted);
  }, [tokenBalance, token]);

  const handleDeposit = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter valid amount');
      return;
    }

    if (!smartAccountAddress || !eoaAddress || !walletClient) {
      toast.error('Wallet not connected');
      return;
    }

    setIsDepositing(true);
    
    try {
      const amountWei = parseUnits(amount, token.decimals);
      
      if (token.isNative) {
        // ===== NATIVE MON DEPOSIT =====
        // Simple transfer: EOA → Smart Account
        toast.loading('Sending MON to smart account...', { id: 'deposit' });
        
        const hash = await walletClient.sendTransaction({
          account: walletClient.account,
          to: smartAccountAddress,
          value: amountWei,
          chain: walletClient.chain
        });
        const publicClient = window.publicClient || walletClient?.chain?.viemClient || null;
        if (publicClient && publicClient.waitForTransactionReceipt) {
          await walletClient.waitForTransactionReceipt({ hash });
        } else {
          // fallback: simple delay + poll for confirmation
          await new Promise(r =>setTimeout(r, 8000));
        }
        
        toast.success('MON deposited successfully!', { id: 'deposit' });
        // immediately refresh balances
        try{
          if(window.refreshBalances){
            window.refreshBalances
          }
        } catch {}
        
      } else {
        // ===== ERC-20 TOKEN DEPOSIT =====
        // Call transfer() on token contract from EOA
        toast.loading(`Sending ${token.symbol} to smart account...`, { id: 'deposit' });
        
        const hash = await walletClient.sendTransaction({
          account: walletClient.account,
          to: token.address,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'transfer',
            args: [smartAccountAddress, amountWei]
          }),
          chain: walletClient.chain
        });
        
        await walletClient.waitForTransactionReceipt({ hash });
        toast.success(`${token.symbol} deposited successfully!`, { id: 'deposit' });
        // Immediately refresh balances
        try{
          if(window.refreshBalances){
            window.refreshBalances();
          }
        } catch {}
      } 

      onClose();
      setAmount('');
      
    } catch (error) {
      console.error('Deposit error:', error);
      
      // Handle user rejection
      if (error.message?.includes('rejected') || error.message?.includes('denied')) {
        toast.error('Transaction rejected', { id: 'deposit' });
      } else {
        toast.error(error?.shortMessage || error?.message || 'Deposit failed', { id: 'deposit' });
      }
    } finally {
      setIsDepositing(false);
    }
  }, [amount, token, smartAccountAddress, eoaAddress, walletClient, onClose]);

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
          <h3 style={styles.title}>Deposit to Smart Account</h3>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        <div style={styles.body}>
          {/* Token Selector */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Token</label>
            <select
              value={selectedToken}
              onChange={(e) => setSelectedToken(e.target.value)}
              style={{
                ...styles.select,
                ...(isDepositing ? { opacity:0.6, cursor:'not-allowed'}: {}),
              }}
              onFocus={(e) => Object.assign(e.target.style, styles.selectFocus)}
              onBlur={(e) => Object.assign(e.target.style, styles.select)}
              disabled={isDepositing}
            >
              {SUPPORTED_TOKENS.map(t => (
                <option key={t.address} value={t.address}>{t.symbol}</option>
              ))}
            </select>
          </div>

          {/* Amount Input */}
          <div style={styles.formGroup}>
            <div style={styles.labelRow}>
              <label style={styles.label}>Amount</label>
              {tokenBalance && (
                <span style={styles.balance}>
                  Balance: {tokenBalance.formatted} {token.symbol}
                </span>
              )}
            </div>
            
            {/* Quick Amount Buttons */}
            <div style={styles.quickButtons}>
              {[25, 50, 75].map(pct => (
                <button 
                  key={pct} 
                  onClick={() => handleQuickAmount(pct)} 
                  style={styles.quickBtn}
                  disabled={isDepositing || !tokenBalance}
                >
                  {pct}%
                </button>
              ))}
              <button 
                onClick={() => handleQuickAmount(100)} 
                style={styles.quickBtn}
                disabled={isDepositing || !tokenBalance}
              >
                Max
              </button>
            </div>
            
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              style={styles.input}
              disabled={isDepositing}
              step="any"
            />
          </div>

          {/* Slider */}
          <div style={styles.slider}>
            <input
              type="range"
              min="0"
              max="100"
              value={tokenBalance ? (parseFloat(amount || 0) / parseFloat(tokenBalance.formatted)) * 100 : 0}
              onChange={(e) => {
                if (tokenBalance) {
                  const pct = parseFloat(e.target.value);
                  handleQuickAmount(pct);
                }
              }}
              style={styles.rangeInput}
              disabled={isDepositing || !tokenBalance}
            />
          </div>

          {/* Info Box */}
          <div style={styles.infoBox}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink: 0}}>
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span>This will send tokens from your wallet to your smart account</span>
          </div>
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.btnSecondary} disabled={isDepositing}>
            Cancel
          </button>
          <button 
            onClick={handleDeposit} 
            style={{
              ...styles.btnPrimary,
              opacity: isDepositing || !amount || parseFloat(amount) <= 0 ? 0.5 : 1,
              cursor: isDepositing || !amount || parseFloat(amount) <= 0 ? 'not-allowed' : 'pointer'
            }}
            disabled={isDepositing || !amount || parseFloat(amount) <= 0}
          >
            {isDepositing ? (
              <>
                <div className="spinner" style={{marginRight: '8px', width: '16px', height: '16px', borderWidth: '2px'}} />
                Processing...
              </>
            ) : (
              'Confirm Deposit'
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.8)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '2rem'
  },
  modal: {
    width: '100%',
    maxWidth: '480px',
    background: 'rgba(17, 17, 17, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)'
  },
  header: {
    padding: '1.5rem',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  title: {
    margin: 0,
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#ffffff'
  },
  closeButton: {
    width: '32px',
    height: '32px',
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '6px',
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: '1.25rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s'
  },
  body: {
    padding: '1.5rem'
  },
  formGroup: {
    marginBottom: '1.5rem'
  },
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem'
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#ffffff'
  },
  balance: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)'
  },
  select: {
    width: '100%',
    padding: '0.75rem',
    background: 'linear-gradient(145deg, rgba(40,40,40,0.9), rgba(25,25,25,0.9))',
    border:  '1px solid rgba(167,139,250,0.25)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '1rem',
    cursor: 'pointer',
    outline: 'none',
    appearance: 'none',
    transition: 'border-color 0.2s ease, background 0.2s ease',
    boxShadow: 'inset 0 0 4px rgba(167,139,250,0.15)',
  },

  selectFocus: {
    borderColor: 'rgba(167,139,250,0.6)',
    background: 'linear-gradient(145deg, rgba(55,55,55,1), rgba(35,35,35,1))'
  },
  
  quickButtons: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '0.5rem'
  },
  quickBtn: {
    flex: 1,
    padding: '0.5rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '6px',
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: '0.75rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  input: {
    width: '100%',
    padding: '1rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '1.25rem',
    fontWeight: '600',
    outline: 'none'
  },
  slider: {
    marginBottom: '1rem'
  },
  rangeInput: {
    width: '100%',
    height: '6px',
    borderRadius: '3px',
    background: 'rgba(255, 255, 255, 0.1)',
    outline: 'none',
    cursor: 'pointer',
    accentColor: '#a78bfa'
  },
  infoBox: {
    padding: '0.75rem',
    background: 'rgba(167, 139, 250, 0.1)',
    border: '1px solid rgba(167, 139, 250, 0.2)',
    borderRadius: '8px',
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'flex-start',
    fontSize: '0.75rem',
    color: 'rgba(167, 139, 250, 0.9)',
    lineHeight: '1.4'
  },
  footer: {
    padding: '1.5rem',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end'
  },
  btnPrimary: {
    padding: '0.75rem 2rem',
    background: '#a78bfa',
    border: 'none',
    borderRadius: '8px',
    color: '#000000',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    transition: 'all 0.2s'
  },
  btnSecondary: {
    padding: '0.75rem 2rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: '1rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  }
};

export default DepositModal;