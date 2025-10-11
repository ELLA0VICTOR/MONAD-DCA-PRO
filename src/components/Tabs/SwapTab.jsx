import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SwapTab = ({ onShowAIRecommendation }) => {
  // Mock data for demonstration
  const [formData, setFormData] = useState({
    smartAccount: '0x1234...5678',
    fromToken: 'MON',
    toToken: 'USDC',
    amount: '',
    slippage: 0.5,
  });

  const [prices, setPrices] = useState({ spot: 3.226271, loading: false });
  const [balances] = useState({ MON: '0', USDC: '0' });
  const [isCreating, setIsCreating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);

  const tokens = [
    { 
      symbol: 'MON', 
      name: 'Monad', 
      decimals: 18,
      logo: 'https://imagedelivery.net/cBNDGgkrsEA-b_ixIp9SkQ/I_t8rg_V_400x400.jpg/public'
    },
    { 
      symbol: 'USDC', 
      name: 'USD Coin', 
      decimals: 6,
      logo: 'https://imagedelivery.net/cBNDGgkrsEA-b_ixIp9SkQ/usdc.png/public'
    },
    { 
      symbol: 'WBTC', 
      name: 'Wrapped Bitcoin', 
      decimals: 8,
      logo: 'https://cryptologos.cc/logos/wrapped-bitcoin-wbtc-logo.png'
    },
    { 
      symbol: 'WETH', 
      name: 'Wrapped Ethereum', 
      decimals: 18,
      logo: 'https://cryptologos.cc/logos/ethereum-eth-logo.png'
    },
    { 
      symbol: 'USDT', 
      name: 'Tether USD', 
      decimals: 6,
      logo: 'https://cryptologos.cc/logos/tether-usdt-logo.png'
    },
    { 
      symbol: 'WSOL', 
      name: 'Wrapped Solana', 
      decimals: 9,
      logo: 'https://cryptologos.cc/logos/solana-sol-logo.png'
    },
  ];

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSwapTokens = () => {
    setFormData(prev => ({
      ...prev,
      fromToken: prev.toToken,
      toToken: prev.fromToken,
    }));
  };

  const handleQuickAmount = (percentage) => {
    const mockBalance = 100;
    const amount = (mockBalance * percentage / 100).toFixed(6);
    handleChange('amount', amount);
  };

  const fromToken = tokens.find(t => t.symbol === formData.fromToken);
  const toToken = tokens.find(t => t.symbol === formData.toToken);

  const minReceived = useMemo(() => {
    if (!formData.amount || !prices.spot) return '0';
    const amount = parseFloat(formData.amount) || 0;
    const slippage = formData.slippage / 100;
    return (amount * prices.spot * (1 - slippage)).toFixed(6);
  }, [formData.amount, formData.slippage, prices.spot]);

  const handleSubmit = () => {
    setIsCreating(true);
    setTimeout(() => {
      setIsCreating(false);
      alert('Swap executed successfully!');
    }, 2000);
  };

  const insufficientBalance = parseFloat(formData.amount || 0) > parseFloat(balances[formData.fromToken] || 0);

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Header with Settings */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>Swap</h2>
            <p style={styles.subtitle}>Trade tokens instantly</p>
          </div>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            style={{
              ...styles.settingsButton,
              ...(showSettings ? styles.settingsButtonActive : {})
            }}
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2l2 7h7l-5.5 4 2 7-5.5-4-5.5 4 2-7-5.5-4h7z"/>
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v6m0 6v6M6 6l4.2 4.2m5.6 5.6L20 20M6 18l4.2-4.2m5.6-5.6L20 4"/>
            </svg>
          </button>
        </div>

        {/* Settings Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={styles.settingsPanel}
            >
              <div style={styles.slippageSection}>
                <div style={styles.slippageHeader}>
                  <span style={styles.label}>Slippage Tolerance</span>
                  <span style={styles.slippageValue}>{formData.slippage}%</span>
                </div>
                <input
                  type="range"
                  value={formData.slippage}
                  onChange={(e) => handleChange('slippage', parseFloat(e.target.value))}
                  min="0.1"
                  max="5"
                  step="0.1"
                  style={styles.slider}
                />
                <div style={styles.slippagePresets}>
                  {[0.1, 0.5, 1.0].map(val => (
                    <button
                      key={val}
                      onClick={() => handleChange('slippage', val)}
                      style={{
                        ...styles.presetBtn,
                        ...(formData.slippage === val ? styles.presetBtnActive : {})
                      }}
                    >
                      {val}%
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* From Token Section */}
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.label}>From</span>
            <span style={styles.balance}>
              Balance: {balances[formData.fromToken] || '0'}
            </span>
          </div>

          {/* Quick Amount Buttons */}
          <div style={styles.quickButtons}>
            {[25, 50, 75, 100].map(pct => (
              <button 
                key={pct} 
                onClick={() => handleQuickAmount(pct)} 
                style={styles.quickBtn}
              >
                {pct === 100 ? 'Max' : `${pct}%`}
              </button>
            ))}
          </div>

          {/* Input Row */}
          <div style={styles.inputRow}>
            <input
              type="number"
              value={formData.amount}
              onChange={(e) => handleChange('amount', e.target.value)}
              placeholder="0"
              style={styles.amountInput}
            />
            <div style={styles.tokenSelectWrapper}>
              <button 
                onClick={() => setShowFromDropdown(!showFromDropdown)}
                style={styles.tokenButton}
              >
                <img 
                  src={fromToken.logo} 
                  alt={fromToken.symbol}
                  style={styles.tokenLogo}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
                <span style={styles.tokenSymbol}>{fromToken.symbol}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              
              {/* From Token Dropdown */}
              <AnimatePresence>
                {showFromDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    style={styles.dropdown}
                  >
                    {tokens.map(token => (
                      <button
                        key={token.symbol}
                        onClick={() => {
                          handleChange('fromToken', token.symbol);
                          setShowFromDropdown(false);
                        }}
                        style={styles.dropdownItem}
                      >
                        <img 
                          src={token.logo} 
                          alt={token.symbol}
                          style={styles.tokenLogoSmall}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <div style={styles.tokenInfo}>
                          <span style={styles.tokenSymbolDrop}>{token.symbol}</span>
                          <span style={styles.tokenName}>{token.name}</span>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Swap Direction Button */}
        <div style={styles.swapContainer}>
          <button onClick={handleSwapTokens} style={styles.swapButton}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M7 16V4M7 4L3 8M7 4L11 8"/>
              <path d="M17 8V20M17 20L21 16M17 20L13 16"/>
            </svg>
          </button>
        </div>

        {/* To Token Section */}
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.label}>To</span>
            <span style={styles.balance}>
              Balance: {balances[formData.toToken] || '0'}
            </span>
          </div>

          {/* Output Row */}
          <div style={styles.inputRow}>
            <input
              type="number"
              value={minReceived}
              readOnly
              placeholder="0"
              style={{...styles.amountInput, opacity: 0.7, cursor: 'not-allowed'}}
            />
            <div style={styles.tokenSelectWrapper}>
              <button 
                onClick={() => setShowToDropdown(!showToDropdown)}
                style={styles.tokenButton}
              >
                <img 
                  src={toToken.logo} 
                  alt={toToken.symbol}
                  style={styles.tokenLogo}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
                <span style={styles.tokenSymbol}>{toToken.symbol}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              
              {/* To Token Dropdown */}
              <AnimatePresence>
                {showToDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    style={styles.dropdown}
                  >
                    {tokens.map(token => (
                      <button
                        key={token.symbol}
                        onClick={() => {
                          handleChange('toToken', token.symbol);
                          setShowToDropdown(false);
                        }}
                        style={styles.dropdownItem}
                      >
                        <img 
                          src={token.logo} 
                          alt={token.symbol}
                          style={styles.tokenLogoSmall}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <div style={styles.tokenInfo}>
                          <span style={styles.tokenSymbolDrop}>{token.symbol}</span>
                          <span style={styles.tokenName}>{token.name}</span>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Price Info */}
        {prices.spot && formData.amount && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={styles.priceInfo}
          >
            <div style={styles.priceRow}>
              <span style={styles.priceLabel}>Rate</span>
              <span style={styles.priceValue}>
                1 {fromToken.symbol} = {prices.spot.toFixed(6)} {toToken.symbol}
              </span>
            </div>
            <div style={styles.priceRow}>
              <span style={styles.priceLabel}>Min. received</span>
              <span style={styles.priceValue}>
                {minReceived} {toToken.symbol}
              </span>
            </div>
            <div style={styles.priceRow}>
              <span style={styles.priceLabel}>Network fee</span>
              <span style={{...styles.priceValue, color: '#a78bfa'}}>Free</span>
            </div>
          </motion.div>
        )}

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={isCreating || insufficientBalance || !formData.amount}
          style={{
            ...styles.submitButton,
            ...(insufficientBalance || !formData.amount ? styles.submitButtonDisabled : {}),
            opacity: isCreating ? 0.5 : 1,
            cursor: (isCreating || insufficientBalance || !formData.amount) ? 'not-allowed' : 'pointer'
          }}
        >
          {isCreating ? (
            <>
              <div className="spinner" style={{width: '16px', height: '16px', borderWidth: '2px', marginRight: '8px'}} />
              Swapping...
            </>
          ) : insufficientBalance ? (
            'Insufficient Balance'
          ) : !formData.amount ? (
            'Enter Amount'
          ) : (
            'Swap'
          )}
        </button>
      </div>
    </div>
  );
};

// Styles - Clean Professional DEX
const styles = {
  container: {
    width: '100%',
    maxWidth: '480px',
    margin: '0 auto',
    padding: '1.5rem'
  },
  card: {
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '16px',
    padding: '1.25rem'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '1rem'
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
  settingsButton: {
    width: '32px',
    height: '32px',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: 'rgba(255, 255, 255, 0.5)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s'
  },
  settingsButtonActive: {
    background: 'rgba(167, 139, 250, 0.1)',
    borderColor: 'rgba(167, 139, 250, 0.3)',
    color: '#a78bfa'
  },
  settingsPanel: {
    overflow: 'hidden',
    marginBottom: '1rem'
  },
  slippageSection: {
    padding: '1rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px'
  },
  slippageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.75rem'
  },
  slippageValue: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#a78bfa'
  },
  slider: {
    width: '100%',
    height: '4px',
    borderRadius: '2px',
    background: 'rgba(255, 255, 255, 0.1)',
    outline: 'none',
    cursor: 'pointer',
    marginBottom: '0.75rem',
    WebkitAppearance: 'none',
    appearance: 'none'
  },
  slippagePresets: {
    display: 'flex',
    gap: '0.5rem'
  },
  presetBtn: {
    flex: 1,
    padding: '0.5rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '6px',
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '0.75rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  presetBtnActive: {
    background: 'rgba(167, 139, 250, 0.1)',
    borderColor: '#a78bfa',
    color: '#a78bfa'
  },
  section: {
    marginBottom: '0.5rem'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem'
  },
  label: {
    fontSize: '0.8125rem',
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.6)'
  },
  balance: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.4)'
  },
  quickButtons: {
    display: 'flex',
    gap: '0.375rem',
    marginBottom: '0.5rem'
  },
  quickBtn: {
    padding: '0.375rem 0.625rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '6px',
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '0.75rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  inputRow: {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'center',
    padding: '1rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px'
  },
  amountInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#ffffff',
    fontSize: '1.5rem',
    fontWeight: '600'
  },
  tokenSelectWrapper: {
    position: 'relative'
  },
  tokenButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#ffffff',
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap'
  },
  tokenLogo: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    objectFit: 'cover'
  },
  tokenLogoSmall: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    objectFit: 'cover'
  },
  tokenSymbol: {
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 0.5rem)',
    right: 0,
    minWidth: '200px',
    background: 'rgba(20, 20, 20, 0.98)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '12px',
    padding: '0.5rem',
    zIndex: 100,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
  },
  dropdownItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    background: 'transparent',
    border: 'none',
    borderRadius: '8px',
    color: '#ffffff',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'left'
  },
  tokenInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.125rem'
  },
  tokenSymbolDrop: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#ffffff'
  },
  tokenName: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)'
  },
  swapContainer: {
    display: 'flex',
    justifyContent: 'center',
    margin: '0.5rem 0'
  },
  swapButton: {
    width: '36px',
    height: '36px',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: 'rgba(255, 255, 255, 0.6)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s'
  },
  priceInfo: {
    padding: '0.875rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '10px',
    marginTop: '0.75rem',
    marginBottom: '1rem'
  },
  priceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.25rem 0'
  },
  priceLabel: {
    fontSize: '0.8125rem',
    color: 'rgba(255, 255, 255, 0.5)'
  },
  priceValue: {
    fontSize: '0.8125rem',
    fontWeight: '500',
    color: '#ffffff'
  },
  submitButton: {
    width: '100%',
    padding: '1rem',
    background: '#a78bfa',
    border: 'none',
    borderRadius: '12px',
    color: '#000000',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  submitButtonDisabled: {
    background: 'rgba(255, 255, 255, 0.1)',
    color: 'rgba(255, 255, 255, 0.3)'
  }
};

// Simple spinner CSS
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

// Inject CSS
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = spinnerCSS;
  document.head.appendChild(style);
}

export default SwapTab;