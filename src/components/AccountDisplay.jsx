import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { UI_CONFIG, MONAD_CONFIG } from '../../utils/constants';
import { formatAddress, formatTokenAmount } from '../../utils/formatters';

/**
 * AccountDisplay Component
 * 
 * Purpose:
 * Displays MetaMask Smart Account information with live balance tracking,
 * deployment status, network info, and account actions. Professional dashboard
 * card with glassmorphic design and real-time updates.
 * 
 * Features:
 * - Live MON balance with auto-refresh
 * - Deployment status badge
 * - Copy address to clipboard
 * - Network indicator (Monad testnet)
 * - Disconnect action
 * - Explorer link integration
 * - Balance refresh control
 * - Loading states with skeletons
 * 
 * Props:
 * - onDisconnect: callback when user disconnects account
 * - showActions: boolean to show/hide action buttons (default: true)
 * - compact: boolean for condensed view (default: false)
 * 
 * Dependencies:
 * - useSmartAccount hook
 * - framer-motion (animations)
 * - react-hot-toast (notifications)
 */

const AccountDisplay = ({ onDisconnect, showActions = true, compact = false }) => {
  const {
    smartAccount,
    accountAddress,
    status,
    isDeployed,
    balance,
    isConnected,
    fetchBalance,
    disconnect,
    getAccountInfo
  } = useSmartAccount();

  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [accountInfo, setAccountInfo] = useState(null);

  // Load account info on mount
  useEffect(() => {
    if (isConnected) {
      loadAccountInfo();
    }
  }, [isConnected, accountAddress]);

  const loadAccountInfo = async () => {
    try {
      const info = await getAccountInfo();
      setAccountInfo(info);
    } catch (err) {
      console.error(err)
      toast.error(err?.message || String(err) || 'Unexpected error')
    }
  };

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(accountAddress);
      setCopied(true);
      toast.success('Address copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err)
      toast.error(err?.message || String(err) || 'Unexpected error');
    }
  };

  const handleRefreshBalance = async () => {
    setIsRefreshing(true);
    try {
      await fetchBalance();
      toast.success('Balance refreshed');
    } catch (err) {
      console.error(err)
      toast.error(err?.message || String(err) || 'Unexpeted error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    if (onDisconnect) {
      onDisconnect();
    }
    toast.success('Account disconnected');
  };

  const openExplorer = () => {
    const explorerUrl = `${MONAD_CONFIG.explorer}/address/${accountAddress}`;
    window.open(explorerUrl, '_blank', 'noopener,noreferrer');
  };

  if (!isConnected) {
    return null;
  }

  // Compact view for headers/sidebars
  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="account-display-compact"
      >
        <div className="compact-address">
          <span className="compact-label">Account:</span>
          <code className="compact-code">{formatAddress(accountAddress)}</code>
        </div>
        <div className="compact-balance">
          <span className="balance-amount">
            {balance.loading ? '...' : balance.formatted}
          </span>
          <span className="balance-symbol">MON</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.4 }}
      className="account-display glass-card"
    >
      {/* Header */}
      <div className="account-display-header">
        <div className="account-header-left">
          <h3 className="account-display-title">Smart Account</h3>
          <div className="status-badge">
            <span 
              className="status-dot"
              style={{
                backgroundColor: isDeployed ? UI_CONFIG.colors.success : UI_CONFIG.colors.warning
              }}
            />
            <span className="status-text">
              {isDeployed ? 'Deployed' : 'Not Deployed'}
            </span>
          </div>
        </div>
        <div className="network-badge">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <circle cx="4" cy="4" r="4" fill={UI_CONFIG.colors.success} />
          </svg>
          <span className="network-text">Monad Testnet</span>
        </div>
      </div>

      {/* Address Section */}
      <div className="address-section">
        <div className="address-label">Address</div>
        <div className="address-display">
          <code className="address-code">{accountAddress}</code>
          <button
            onClick={handleCopyAddress}
            className="icon-button"
            title="Copy address"
          >
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path 
                  d="M13.5 4L6 11.5L2.5 8" 
                  stroke={UI_CONFIG.colors.success} 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M3 11V3C3 2.44772 3.44772 2 4 2H11" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            )}
          </button>
          <button
            onClick={openExplorer}
            className="icon-button"
            title="View in explorer"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path 
                d="M12 8.66667V12.6667C12 13.0203 11.8595 13.3594 11.6095 13.6095C11.3594 13.8595 11.0203 14 10.6667 14H3.33333C2.97971 14 2.64057 13.8595 2.39052 13.6095C2.14048 13.3594 2 13.0203 2 12.6667V5.33333C2 4.97971 2.14048 4.64057 2.39052 4.39052C2.64057 4.14048 2.97971 4 3.33333 4H7.33333M10 2H14M14 2V6M14 2L6.66667 9.33333" 
                stroke="currentColor" 
                strokeWidth="1.5" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Balance Section */}
      <div className="balance-section">
        <div className="balance-header">
          <span className="balance-label">Balance</span>
          <button
            onClick={handleRefreshBalance}
            disabled={isRefreshing}
            className={`refresh-button ${isRefreshing ? 'refresh-button-active' : ''}`}
            title="Refresh balance"
          >
            <svg 
              width="14" 
              height="14" 
              viewBox="0 0 14 14" 
              fill="none"
              className={isRefreshing ? 'refresh-icon-spin' : ''}
            >
              <path 
                d="M13 7C13 10.3137 10.3137 13 7 13C3.68629 13 1 10.3137 1 7C1 3.68629 3.68629 1 7 1C8.65685 1 10.1569 1.67157 11.2426 2.75736M11 1V4H8" 
                stroke="currentColor" 
                strokeWidth="1.5" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <div className="balance-display">
          {balance.loading ? (
            <div className="balance-skeleton skeleton" />
          ) : (
            <>
              <span className="balance-value">{balance.formatted}</span>
              <span className="balance-unit">MON</span>
            </>
          )}
        </div>
        {!balance.loading && balance.mon === 0n && (
          <div className="low-balance-warning">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path 
                d="M7 0L0 12h14L7 0zm1 10H6V8h2v2zm0-3H6V4h2v3z" 
                fill={UI_CONFIG.colors.warning}
              />
            </svg>
            <span className="warning-text">
              Fund your account at{' '}
              <a 
                href="https://faucet.monad.xyz" 
                target="_blank" 
                rel="noopener noreferrer"
                className="faucet-link"
              >
                faucet.monad.xyz
              </a>
            </span>
          </div>
        )}
      </div>

      {/* Account Info Grid */}
      {accountInfo && (
        <div className="info-grid">
          <div className="info-item">
            <span className="info-label">Type</span>
            <span className="info-value">Hybrid</span>
          </div>
          <div className="info-item">
            <span className="info-label">Network</span>
            <span className="info-value">Chain {MONAD_CONFIG.chainId}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Status</span>
            <span className="info-value">{status}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Supports</span>
            <span className="info-value">Delegations</span>
          </div>
        </div>
      )}

      {/* Actions */}
      {showActions && (
        <div className="account-actions">
          <button
            onClick={openExplorer}
            className="btn btn-secondary action-button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path 
                d="M12 8.66667V12.6667C12 13.0203 11.8595 13.3594 11.6095 13.6095C11.3594 13.8595 11.0203 14 10.6667 14H3.33333C2.97971 14 2.64057 13.8595 2.39052 13.6095C2.14048 13.3594 2 13.0203 2 12.6667V5.33333C2 4.97971 2.14048 4.64057 2.39052 4.39052C2.64057 4.14048 2.97971 4 3.33333 4H7.33333M10 2H14M14 2V6M14 2L6.66667 9.33333" 
                stroke="currentColor" 
                strokeWidth="1.5" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              />
            </svg>
            View Explorer
          </button>
          <button
            onClick={handleDisconnect}
            className="btn disconnect-button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path 
                d="M6 14H3.33333C2.97971 14 2.64057 13.8595 2.39052 13.6095C2.14048 13.3594 2 13.0203 2 12.6667V3.33333C2 2.97971 2.14048 2.64057 2.39052 2.39052C2.64057 2.14048 2.97971 2 3.33333 2H6M10.6667 11.3333L14 8M14 8L10.6667 4.66667M14 8H6" 
                stroke="currentColor" 
                strokeWidth="1.5" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              />
            </svg>
            Disconnect
          </button>
        </div>
      )}
    </motion.div>
  );
};

export default AccountDisplay;