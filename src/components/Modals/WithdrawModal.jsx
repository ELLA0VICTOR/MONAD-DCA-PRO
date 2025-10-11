import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { parseUnits, encodeFunctionData } from 'viem';
import { useWallet } from '../../hooks/useWallet';
import { useMonadBalance } from '../../hooks/useMonadBalance';
import { sendUserOperation } from '../../services/smartAccount/userOperations';
import { formatTokenAmount } from '../../utils/formatters';
import { SUPPORTED_TOKENS } from '../../utils/constants';

const WithdrawModal = ({ isOpen, onClose, smartAccount }) => {
  const { address: eoaAddress } = useWallet();
  const { balances } = useMonadBalance(smartAccount?.address);
  
  const [selectedToken, setSelectedToken] = useState(SUPPORTED_TOKENS[0].address);
  const [amount, setAmount] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const token = SUPPORTED_TOKENS.find(t => t.address === selectedToken);
  const tokenBalance = balances[token?.symbol];

  // Set recipient to EOA by default
  useEffect(() => {
    if (eoaAddress && !recipientAddress) {
      setRecipientAddress(eoaAddress);
    }
  }, [eoaAddress, recipientAddress]);

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

    if (!recipientAddress || recipientAddress.length !== 42) {
      toast.error('Enter valid recipient address');
      return;
    }

    if (!smartAccount) {
      toast.error('No smart account selected');
      return;
    }

    // Check if account is deployed
    if (smartAccount.deploymentState !== 'deployed') {
      toast.error('Smart account not deployed yet. Please contact support.');
      return;
    }

    setIsWithdrawing(true);
    
    try {
      const amountWei = parseUnits(amount, token.decimals);
      
      toast.loading('Processing withdrawal...', { id: 'withdraw' });
      
      // Create withdrawal call
      let call;
      
      if (token.isNative) {
        // Native MON withdrawal
        call = {
          to: recipientAddress,
          value: amountWei,
          data: '0x'
        };
      } else {
        // ERC-20 withdrawal
        call = {
          to: token.address,
          value: 0n,
          data: encodeFunctionData({
            abi: [{
              name: 'transfer',
              type: 'function',
              stateMutability: 'nonpayable',
              inputs: [
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' }
              ],
              outputs: [{ type: 'bool' }]
            }],
            functionName: 'transfer',
            args: [recipientAddress, amountWei]
          })
        };
      }
      
      // Send as user operation
      const userOpHash = await sendUserOperation(
        smartAccount,
        [call]
      );
      
      toast.success('Withdrawal successful!', { id: 'withdraw' });
      
      onClose();
      setAmount('');
      
    } catch (error) {
      console.error('Withdraw error:', error);
      toast.error(error?.shortMessage || error?.message || 'Withdrawal failed', { id: 'withdraw' });
    } finally {
      setIsWithdrawing(false);
    }
  }, [amount, token, smartAccount, recipientAddress, onClose]);

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
          {/* Token Selector */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Token</label>
            <select
              value={selectedToken}
              onChange={(e) => setSelectedToken(e.target.value)}
              style={styles.select}
              disabled={isWithdrawing}
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
                  Available: {tokenBalance.formatted} {token.symbol}
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
                  disabled={isWithdrawing || !tokenBalance}
                >
                  {pct}%
                </button>
              ))}
              <button 
                onClick={() => handleQuickAmount(100)} 
                style={styles.quickBtn}
                disabled={isWithdrawing || !tokenBalance}
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
              disabled={isWithdrawing}
              step="any"
            />
          </div>

          

          {/* Recipient Address */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Recipient Address</label>
            <input
              type="text"
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              placeholder="0x..."
              style={styles.addressInput}
              disabled={isWithdrawing}
            />
            <button
              onClick={() => setRecipientAddress(eoaAddress)}
              style={styles.useMyAddressBtn}
              disabled={isWithdrawing}
            >
              Use My Address
            </button>
          </div>
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.btnSecondary} disabled={isWithdrawing}>
            Cancel
          </button>
          <button 
            onClick={handleWithdraw} 
            style={{
              ...styles.btnPrimary,
              opacity: isWithdrawing || !amount || parseFloat(amount) <= 0 ? 0.5 : 1,
              cursor: isWithdrawing || !amount || parseFloat(amount) <= 0 ? 'not-allowed' : 'pointer'
            }}
            disabled={isWithdrawing || !amount || parseFloat(amount) <= 0}
          >
            {isWithdrawing ? (
              <>
                <div className="spinner" style={{marginRight: '8px', width: '16px', height: '16px', borderWidth: '2px'}} />
                Processing...
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
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '1rem',
    cursor: 'pointer',
    outline: 'none'
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
  warningBox: {
    padding: '0.75rem',
    background: 'rgba(245, 158, 11, 0.1)',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    borderRadius: '8px',
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'flex-start',
    fontSize: '0.75rem',
    color: 'rgba(245, 158, 11, 0.9)',
    lineHeight: '1.4',
    marginBottom: '1rem'
  },
  addressInput: {
    width: '100%',
    padding: '0.75rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '0.875rem',
    fontFamily: 'monospace',
    outline: 'none',
    marginBottom: '0.5rem'
  },
  useMyAddressBtn: {
    padding: '0.5rem 1rem',
    background: 'rgba(167, 139, 250, 0.1)',
    border: '1px solid rgba(167, 139, 250, 0.3)',
    borderRadius: '6px',
    color: '#a78bfa',
    fontSize: '0.75rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
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

export default WithdrawModal;