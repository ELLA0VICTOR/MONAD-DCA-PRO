import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { useWallet } from '../../hooks/useWallet';
import { MONAD_CONFIG } from '../../utils/constants';
import { formatAddress } from '../../utils/formatters';

const SmartAccountTab = ({ onOpenDeposit, onOpenWithdraw }) => {
  const { address: eoaAddress, isConnected: walletConnected } = useWallet();
  const {
    smartAccounts,
    activeAccount,
    balance,
    isLoading,
    createSmartAccount,
    deploySmartAccount, // 🚀 We'll use this to deploy manually
    switchAccount,
    loadAccountsForEOA,
    checkDeployment
  } = useSmartAccount();
  
  const [isCreating, setIsCreating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false); // 🚀 Deploy loading state
  const [copiedAddress, setCopiedAddress] = useState(null);
  const [deploymentStatuses, setDeploymentStatuses] = useState({});

  // Load accounts when wallet connects
  useEffect(() => {
    if (walletConnected && eoaAddress) {
      loadAccountsForEOA();
    }
  }, [walletConnected, eoaAddress, loadAccountsForEOA]);

  // Poll deployment status for all accounts
  useEffect(() => {
    if (smartAccounts.length === 0) return;

    const checkAllDeployments = async () => {
      const statuses = {};
      for (const account of smartAccounts) {
        try {
          const isDeployed = await checkDeployment(account.address);
          statuses[account.address] = isDeployed;
        } catch (error) {
          console.error(`Failed to check deployment for ${account.address}:`, error);
          statuses[account.address] = false;
        }
      }
      setDeploymentStatuses(statuses);
    };

    checkAllDeployments();
    
    // Poll every 15 seconds
    const interval = setInterval(checkAllDeployments, 60000);
    return () => clearInterval(interval);
  }, [smartAccounts, checkDeployment]);

  // Handle create account
  const handleCreate = async () => {
    if (!walletConnected) {
      toast.error('Please connect your wallet first');
      return;
    }

    setIsCreating(true);
    try {
      await createSmartAccount();
      toast.success('Smart account created successfully!');
    } catch (error) {
      console.error('Create error:', error);
      if (!error.message?.includes('rejected')) {
        toast.error(error?.message || 'Failed to create account');
      }
    } finally {
      setIsCreating(false);
    }
  };

  // 🚀 Handle manual deploy
  const handleDeploy = async (e) => {
    e.stopPropagation();
    
    if (!activeAccount) {
      toast.error('No account selected');
      return;
    }
    // Guard against uninitialized or partial accounts
    if (!activeAccount.address) {
      toast.error('Invalid smart account: missing address');
      return;
    }
    // Prevent spam clicking
    if (isDeploying) return;

    setIsDeploying(true);
    try {
      console.log('🚀 Starting deployment for:', activeAccount.address);
      
      await deploySmartAccount();
      
      toast.success('Smart account deployed successfully!');
      
      // Refresh deployment status
      await loadAccountsForEOA();
      
    } catch (error) {
      console.error('Deploy error:', error);
      toast.error(error?.message || 'Failed to deploy account');
    } finally {
      setIsDeploying(false);
    }
  };

  // Handle copy address
  const handleCopy = async (address) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      toast.success('Address copied!');
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch (error) {
      toast.error('Failed to copy');
    }
  };

  // Open explorer
  const openExplorer = (address) => {
    window.open(`${MONAD_CONFIG.explorer}/address/${address}`, '_blank');
  };

  // Render account card
  const renderAccountCard = (account, index) => {
    const isActive = activeAccount?.address === account.address;
    const isDeployed = deploymentStatuses[account.address] || account.deploymentState === 'deployed';

    return (
      <motion.div
        key={account.address}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.1 }}
        style={{
          ...styles.accountCard,
          ...(isActive ? styles.accountCardActive : {})
        }}
        onClick={() => !isActive && switchAccount(account.address)}
      >
        {/* Address with status indicator */}
        <div style={styles.cardHeader}>
          <div style={styles.addressRow}>
            <span style={styles.addressLabel}>
              {formatAddress(account.address)}
            </span>
            <span 
              style={{
                ...styles.statusDot,
                background: isDeployed ? '#a78bfa' : '#fbbf24'
              }}
              title={isDeployed ? 'Deployed' : 'Not Deployed'}
            />
          </div>
          
          {/* Action icons */}
          <div style={styles.iconButtons}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCopy(account.address);
              }}
              style={styles.iconButton}
              title="Copy address"
            >
              {copiedAddress === account.address ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              )}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openExplorer(account.address);
              }}
              style={styles.iconButton}
              title="View in explorer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* Balance - only show for active account */}
        {isActive && (
          <div style={styles.balanceSection}>
            <span style={styles.balanceLabel}>MON Balance</span>
            <span style={styles.balanceValue}>
              {balance.smart.loading ? (
                <div className="spinner" style={{width: '14px', height: '14px', borderWidth: '2px'}} />
              ) : (
                `${balance.smart.formatted} MON`
              )}
            </span>
          </div>
        )}

        {/* 🚀 DEPLOY BUTTON - Only show for active account that's NOT deployed */}
        {isActive && !isDeployed && (
          <button
            onClick={handleDeploy}
            disabled={isDeploying || !activeAccount?.address}
            style={{
              ...styles.deployButton,
              opacity: isDeploying ? 0.5 : 1,
              cursor: isDeploying ? 'not-allowed' : 'pointer'
            }}
            
          >
            {isDeploying ? (
              <>
                <div className="spinner" style={{width: '14px', height: '14px', borderWidth: '2px', marginRight: '8px'}} />
                Deploying to Monad Testnet...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: '6px'}}>
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="16 12 12 8 8 12"></polyline>
                  <line x1="12" y1="16" x2="12" y2="8"></line>
                </svg>
                Deploy to Monad Testnet
              </>
            )}
          </button>
        )}

        {/* Action buttons - show for active account only */}
        {isActive && (
          <div style={styles.cardFooter}>
            <div style={styles.actionButtons}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDeposit?.(account);
                }}
                style={styles.depositButton}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: '4px'}}>
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <polyline points="19 12 12 19 5 12"></polyline>
                </svg>
                Deposit
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenWithdraw?.(account);
                }}
                style={styles.withdrawButton}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: '4px'}}>
                  <line x1="12" y1="19" x2="12" y2="5"></line>
                  <polyline points="5 12 12 5 19 12"></polyline>
                </svg>
                Withdraw
              </button>
            </div>
          </div>
        )}
      </motion.div>
    );
  };

  // Not connected state
  if (!walletConnected) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>
          <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"           
          strokeWidth="2"           
          strokeLinecap="round"
          strokeLinejoin="round"
          >
            <path d="m19 5 3-3"></path>
            <path d="m2 22 3-3"></path>
            <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"></path>
            <path d="M7.5 13.5 10 11"></path>
            <path d="M10.5 16.5 13 14"></path>
            <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z"></path>
          </svg>


        </div>
        <div style={styles.emptyTitle}>Connect Your Wallet</div>
        <div style={styles.emptyText}>
          Connect your wallet to create and manage smart accounts
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>Smart Accounts</h2>
          <span style={styles.subtitle}>
            {smartAccounts.length} account{smartAccounts.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={handleCreate}
          style={{
            ...styles.createButton,
            opacity: isCreating || isLoading ? 0.5 : 1,
            cursor: isCreating || isLoading ? 'not-allowed' : 'pointer'
          }}
          disabled={isCreating || isLoading}
        >
          {isCreating ? (
            <>
              <div className="spinner" style={{width: '14px', height: '14px', borderWidth: '2px', marginRight: '8px'}} />
              Creating...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: '6px'}}>
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Create
            </>
          )}
        </button>
      </div>

      {/* Accounts list */}
      {isLoading && smartAccounts.length === 0 ? (
        <div style={styles.loadingContainer}>
          <div className="spinner spinner-lg" />
          <div style={styles.loadingText}>Loading accounts...</div>
        </div>
      ) : smartAccounts.length > 0 ? (
        <div style={styles.accountsGrid}>
          {smartAccounts.map((account, index) => renderAccountCard(account, index))}
        </div>
      ) : (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(167, 139, 250, 0.3)" strokeWidth="1.5">
              <rect x="3" y="8" width="18" height="4" rx="1"></rect>
              <path d="M12 8v13"></path>
              <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"></path>
              <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"></path>
            </svg>
          </div>
          <div style={styles.emptyTitle}>No Smart Accounts</div>
          <div style={styles.emptyText}>
            Create your first smart account to start using DCA automation
          </div>
        </div>
      )}
    </div>
  );
};

// Styles - Clean and professional (Purple theme)
const styles = {
  container: {
    width: '100%',
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '2rem'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '2rem'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '1rem'
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#ffffff'
  },
  subtitle: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.5)'
  },
  createButton: {
    padding: '0.625rem 1.25rem',
    background: '#a78bfa',
    border: 'none',
    borderRadius: '6px',
    color: '#000000',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center'
  },
  accountsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '1rem'
  },
  accountCard: {
    padding: '1.25rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  accountCardActive: {
    borderColor: '#a78bfa',
    background: 'rgba(167, 139, 250, 0.05)'
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem'
  },
  addressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  addressLabel: {
    fontSize: '0.875rem',
    fontFamily: 'monospace',
    color: '#ffffff',
    fontWeight: '500'
  },
  statusDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0
  },
  iconButtons: {
    display: 'flex',
    gap: '0.5rem'
  },
  iconButton: {
    padding: '0.25rem',
    background: 'transparent',
    border: 'none',
    color: 'rgba(255, 255, 255, 0.5)',
    cursor: 'pointer',
    transition: 'color 0.2s',
    display: 'flex',
    alignItems: 'center'
  },
  balanceSection: {
    padding: '0.75rem',
    background: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '4px',
    marginBottom: '1rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  balanceLabel: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500'
  },
  balanceValue: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  // 🚀 DEPLOY BUTTON STYLE
  deployButton: {
    width: '100%',
    padding: '0.75rem',
    background: '#a78bfa',
    border: 'none',
    borderRadius: '6px',
    color: '#000000',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s'
  },
  cardFooter: {
    display: 'flex',
    gap: '0.5rem'
  },
  actionButtons: {
    display: 'flex',
    gap: '0.5rem',
    width: '100%'
  },
  depositButton: {
    flex: 1,
    padding: '0.625rem',
    background: 'rgba(167, 139, 250, 0.1)',
    border: '1px solid #a78bfa',
    borderRadius: '6px',
    color: '#a78bfa',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  withdrawButton: {
    flex: 1,
    padding: '0.625rem',
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '6px',
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyState: {
    padding: '4rem 2rem',
    textAlign: 'center'
  },
  emptyIcon: {
    marginBottom: '1rem',
    opacity: 0.5,
    display: 'flex',
    justifyContent: 'center'
  },
  emptyTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: '0.5rem'
  },
  emptyText: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.5)',
    maxWidth: '400px',
    margin: '0 auto',
    lineHeight: '1.5'
  },
  loadingContainer: {
    padding: '4rem 2rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem'
  },
  loadingText: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.5)'
  }
};

export default SmartAccountTab;