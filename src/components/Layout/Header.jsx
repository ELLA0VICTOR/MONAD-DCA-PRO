import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWallet } from '../../hooks/useWallet';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { formatAddress, formatTokenAmount } from '../../utils/formatters';
import { MONAD_CONFIG } from '../../utils/constants';

/**
 * Header Component (Purple Theme + EOA Wallet + Tab Navigation)
 * 
 * Features:
 * - EOA wallet connection with MetaMask
 * - Tab navigation (no React Router)
 * - Network badge
 * - Balance display
 * - Account dropdown
 * - Minimal, professional design
 */
function Header({ activeTab, onTabChange }) {
  const { 
    address: eoaAddress,
    shortAddress: eoaShortAddress,
    isConnected: isWalletConnected,
    connect: connectWallet,
    disconnect: disconnectWallet,
    isConnecting
  } = useWallet();

  const {
    balance,
    isDeployed
  } = useSmartAccount();

  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Track scroll
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowAccountDropdown(false);
    if (showAccountDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showAccountDropdown]);

  const tabs = [
    { id: 'smart-account', label: 'Smart Account' },
    { id: 'delegations', label: 'Delegations', requiresWallet: true },
    { id: 'swap', label: 'Swap', requiresWallet: true },
    { id: 'tasks', label: 'Tasks', requiresWallet: true },
    { id: 'dashboard', label: 'Dashboard', requiresWallet: true },
    { id: 'history', label: 'Execution History', requiresWallet: true },
  ];

  const visibleTabs = tabs.filter(tab => 
    !tab.requiresWallet || (tab.requiresWallet && isWalletConnected)
  );

  const handleCopyAddress = () => {
    if (eoaAddress) {
      navigator.clipboard.writeText(eoaAddress);
      // Could add toast here
    }
  };

  const handleOpenExplorer = () => {
    if (eoaAddress) {
      window.open(`${MONAD_CONFIG.explorer}/address/${eoaAddress}`, '_blank');
    }
  };

  return (
    <header className={`header ${scrolled ? 'scrolled' : ''}`}>
      <div className="header-container">
        {/* Logo */}
        <div className="header-logo">
          <div className="logo-icon">M</div>
          <span className="logo-text">MONAD DCA PRO</span>
        </div>

        {/* Tab Navigation */}
        <nav className="header-tabs">
          {visibleTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Right Section */}
        <div className="header-actions">
          {isWalletConnected ? (
            <>
              {/* Network Badge */}
              <div className="network-badge">
                <span className="network-dot" />
                {MONAD_CONFIG.name}
              </div>

              {/* Balance (if smart account deployed) */}
              {isDeployed && balance && (
                <div className="balance-display">
                  {formatTokenAmount(balance.mon, 18, 4)} MON
                </div>
              )}

              {/* EOA Address with Dropdown */}
              <div className="account-dropdown-wrapper">
                <button
                  className="account-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAccountDropdown(!showAccountDropdown);
                  }}
                >
                  <span className="account-dot" />
                  {eoaShortAddress}
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M6 8L2 4h8z"/>
                  </svg>
                </button>

                <AnimatePresence>
                  {showAccountDropdown && (
                    <motion.div
                      className="account-dropdown"
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button className="dropdown-item" onClick={handleCopyAddress}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                        </svg>
                        Copy Address
                      </button>
                      <button className="dropdown-item" onClick={handleOpenExplorer}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                        </svg>
                        View in Explorer
                      </button>
                      <div className="dropdown-divider" />
                      <div className="dropdown-info">
                        <span className="dropdown-label">Network</span>
                        <span className="dropdown-value">{MONAD_CONFIG.name}</span>
                      </div>
                      <div className="dropdown-info">
                        <span className="dropdown-label">Chain ID</span>
                        <span className="dropdown-value">{MONAD_CONFIG.chainId}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Disconnect Button */}
              <button className="btn-ghost" onClick={disconnectWallet}>
                Disconnect
              </button>
            </>
          ) : (
            <button 
              className="btn-primary" 
              onClick={connectWallet}
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .header {
          position: sticky;
          top: 0;
          z-index: 1000;
          border-bottom: 1px solid var(--border);
          background: var(--bg-primary);
          transition: all 200ms ease;
        }

        .header.scrolled {
          background: rgba(0, 0, 0, 0.95);
          backdrop-filter: blur(10px);
        }

        .header-container {
          max-width: 1600px;
          margin: 0 auto;
          padding: 1rem 2rem;
          display: flex;
          align-items: center;
          gap: 2rem;
        }

        .header-logo {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-family: 'Orbitron', monospace;
          font-weight: 700;
          font-size: 1.125rem;
          letter-spacing: 0.5px;
          color: var(--text-primary);
        }

        .logo-icon {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1rem;
          font-weight: 900;
          color: var(--bg-primary);
        }

        .header-tabs {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex: 1;
        }

        .tab-button {
          background: transparent;
          border: none;
          padding: 0.5rem 1rem;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: 6px;
          transition: all 200ms ease;
          position: relative;
        }

        .tab-button:hover {
          color: var(--primary);
          background: rgba(168, 85, 247, 0.1);
        }

        .tab-button.active {
          color: var(--primary);
        }

        .tab-button.active::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--primary);
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .network-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: rgba(168, 85, 247, 0.1);
          border: 1px solid var(--border-hover);
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          color: var(--primary);
        }

        .network-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--primary);
          box-shadow: 0 0 8px var(--primary-glow);
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .balance-display {
          padding: 0.5rem 1rem;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          font-family: 'Inter', sans-serif;
        }

        .account-dropdown-wrapper {
          position: relative;
        }

        .account-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 8px;
          font-size: 14px;
          font-family: 'JetBrains Mono', monospace;
          color: var(--text-primary);
          cursor: pointer;
          transition: all 200ms ease;
        }

        .account-button:hover {
          border-color: var(--border-hover);
        }

        .account-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--primary);
        }

        .account-dropdown {
          position: absolute;
          top: calc(100% + 0.5rem);
          right: 0;
          width: 280px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 0.5rem;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }

        .dropdown-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
          background: transparent;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 200ms ease;
          text-align: left;
        }

        .dropdown-item:hover {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
        }

        .dropdown-divider {
          height: 1px;
          background: var(--border);
          margin: 0.5rem 0;
        }

        .dropdown-info {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 1rem;
          font-size: 12px;
        }

        .dropdown-label {
          color: var(--text-muted);
        }

        .dropdown-value {
          color: var(--text-secondary);
          font-weight: 600;
        }

        .btn-primary, .btn-ghost {
          padding: 0.5rem 1rem;
          font-size: 14px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          transition: all 200ms ease;
          border: none;
          font-family: 'Inter', sans-serif;
        }

        .btn-primary {
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
          color: white;
        }

        .btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px var(--primary-glow);
        }

        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        .btn-ghost {
          background: transparent;
          color: var(--primary);
          border: 1px solid var(--border);
        }

        .btn-ghost:hover {
          background: rgba(168, 85, 247, 0.1);
          border-color: var(--border-hover);
        }

        @media (max-width: 768px) {
          .header-container {
            padding: 1rem;
            flex-wrap: wrap;
          }

          .header-tabs {
            order: 3;
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }

          .tab-button {
            white-space: nowrap;
          }

          .network-badge,
          .balance-display {
            display: none;
          }
        }
      `}</style>
    </header>
  );
}

export default Header;