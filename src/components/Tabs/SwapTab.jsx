import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { swapExecutor } from '../../services/dca/swapExecutor';
import { useDCAStrategy } from '../../hooks/useDCAStrategy';
import { SUPPORTED_TOKENS,  CONTRACTS } from '../../utils/constants.js';
import MonoAI from '../Modals/MonoAI';
import toast from 'react-hot-toast';
import { parseUnits } from 'viem';
import { formatTokenAmount } from '../../utils/formatters.js';

const SwapTab = () => {
  // Real smart account hook integration
  const { 
    smartAccounts, 
    activeAccount, 
    switchAccount,
    isLoading: accountLoading,
    balance
  } = useSmartAccount();

  // DCA strategy hook
  const {
    createDCAStrategy,
    isLoading: dcaLoading
  } = useDCAStrategy();

  const [formData, setFormData] = useState({
    smartAccount: activeAccount?.address || '',
    fromToken: 'MON',
    toToken: 'USDC',
    amount: '',
    slippage: 0.5,
    strategyType: 'IMMEDIATE',
  });

  // Update smart account when active account changes
  useEffect(() => {
    if (activeAccount?.address && formData.smartAccount !== activeAccount.address) {
      setFormData(prev => ({ ...prev, smartAccount: activeAccount.address }));
    }
  }, [activeAccount]);

  const [prices, setPrices] = useState({ spot: 0, loading: false });
  const [isCreating, setIsCreating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showMonoAI, setShowMonoAI] = useState(false);

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

  // Updated strategy options with SWAP_INTERVALS
  const strategyOptions = [
    { 
      value: 'IMMEDIATE', 
      label: 'Swap Now', 
      description: 'Execute swap immediately',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
      )
    },
    { 
      value: 'PER_MINUTE', 
      label: 'Per Minute', 
      description: 'Automated per-minute purchases',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      )
    },
    { 
      value: 'HOURLY', 
      label: 'Hourly DCA', 
      description: 'Automated hourly purchases',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      )
    },
    { 
      value: 'DAILY', 
      label: 'Daily DCA', 
      description: 'Automated daily purchases',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
      )
    },
    { 
      value: 'WEEKLY', 
      label: 'Weekly DCA', 
      description: 'Automated weekly purchases',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23"></line>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
        </svg>
      )
    },
    { 
      value: 'MONTHLY', 
      label: 'Monthly DCA', 
      description: 'Automated monthly purchases',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
        </svg>
      )
    }
  ];

  // Fetch quote when amount/tokens change
  useEffect(() => {
    const fetchQuote = async () => {
      if (
        !formData.amount ||
        parseFloat(formData.amount) <= 0 ||
        !formData.fromToken ||
        !formData.toToken ||
        formData.fromToken === formData.toToken
      ) {
        setPrices({ spot: 0, loading: false });
        return;
      }
  
      setPrices(prev => ({ ...prev, loading: true }));
  
      try {
        // ✅ Get token info from SUPPORTED_TOKENS
        const fromTokenInfo = Object.values(SUPPORTED_TOKENS).find(t => t.symbol === formData.fromToken);
        const toTokenInfo = Object.values(SUPPORTED_TOKENS).find(t => t.symbol === formData.toToken);
  
        if (!fromTokenInfo || !toTokenInfo) {
          console.error("❌ Token not found");
          setPrices({ spot: 0, loading: false });
          return;
        }
  
        // ✅ Prepare token addresses for quote
        // For native MON, pass null and let swapExecutor normalize it
        const tokenInAddress = fromTokenInfo.isNative ? null : fromTokenInfo.address;
        const tokenOutAddress = toTokenInfo.isNative ? null : toTokenInfo.address;
  
        const amountIn = parseUnits(formData.amount, fromTokenInfo.decimals);
  
        if (amountIn === 0n) {
          console.warn("⚠️ Amount is zero");
          setPrices({ spot: 0, loading: false });
          return;
        }
  
        const swapParams = {
          tokenIn: tokenInAddress,
          tokenOut: tokenOutAddress,
          amountIn: amountIn,
        };
  
        console.log(`🔄 Fetching quote: ${formData.amount} ${formData.fromToken} -> ${formData.toToken}`);
        console.log(`   Token addresses: ${swapParams.tokenIn || 'native'} -> ${swapParams.tokenOut || 'native'}`);
        console.log(`   Amount in wei: ${swapParams.amountIn.toString()}`);
  
        const quoteResult = await swapExecutor.getSwapQuote(swapParams);
  
        if (quoteResult.success && quoteResult.quote?.amountOut) {
          // ✅ FIX: Properly format the quote to human-readable values
          const outputAmountFormatted = Number(quoteResult.quote.amountOut) / Math.pow(10, toTokenInfo.decimals);
          const inputAmountFormatted = parseFloat(formData.amount);
          const rate = outputAmountFormatted / inputAmountFormatted;
          
          console.log(`✅ Quote received:`);
          console.log(`   Rate: 1 ${formData.fromToken} = ${rate.toFixed(6)} ${formData.toToken}`);
          console.log(`   Expected output: ${outputAmountFormatted.toFixed(6)} ${formData.toToken}`);
          console.log(`   Min output (with slippage): ${(Number(quoteResult.quote.minAmountOut) / Math.pow(10, toTokenInfo.decimals)).toFixed(6)} ${formData.toToken}`);
          
          setPrices({ spot: rate, loading: false });
        } else {
          console.warn("⚠️ Quote failed:", quoteResult.error);
          setPrices({ spot: 0, loading: false });
          
          if (formData.amount && parseFloat(formData.amount) > 0) {
            toast.error(quoteResult.error || 'Unable to get quote for this pair');
          }
        }
      } catch (error) {
        console.error("🚨 Quote error:", error);
        setPrices({ spot: 0, loading: false });
        toast.error('Failed to fetch quote');
      }
    };
  
    const timeoutId = setTimeout(fetchQuote, 500);
    return () => clearTimeout(timeoutId);
  }, [formData.amount, formData.fromToken, formData.toToken]);
 
  
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
    const currentBalance = balance?.smart?.formatted || '0';
    const balanceNum = parseFloat(currentBalance);
    if (balanceNum > 0) {
      const amount = (balanceNum * percentage / 100).toFixed(6);
      handleChange('amount', amount);
    }
  };

  const handleAccountSwitch = (accountAddress) => {
    switchAccount(accountAddress);
    setShowAccountDropdown(false);
  };

  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const fromToken = tokens.find(t => t.symbol === formData.fromToken);
  const toToken = tokens.find(t => t.symbol === formData.toToken);

  const minReceived = useMemo(() => {
    if (!formData.amount || !prices.spot) return '0';
    const amount = parseFloat(formData.amount) || 0;
    const slippage = formData.slippage / 100;
    return (amount * prices.spot * (1 - slippage)).toFixed(6);
  }, [formData.amount, formData.slippage, prices.spot]);

  const handleSubmit = async () => {
    if (!activeAccount?.address) {
      toast.error('Please select a smart account');
      return;
    }
    if (!activeAccount.deploymentState || activeAccount.deploymentState !== 'deployed') {
      toast.error('Please deploy your smart account first');
      return;
    }
    
    // ✅ DEBUG: Check what activeAccount contains
    console.log('🔍 Active Account Structure:', {
      hasAddress: !!activeAccount.address,
      hasAccount: !!activeAccount.account,
      hasAccountAddress: !!activeAccount.account?.address,
      fullKeys: Object.keys(activeAccount)
    });
    
    setIsCreating(true);
  
    try {
      if (formData.strategyType === 'IMMEDIATE') {
        try {
          // Get token info
          const fromTokenInfo = Object.values(SUPPORTED_TOKENS).find(t => t.symbol === formData.fromToken);
          const toTokenInfo = Object.values(SUPPORTED_TOKENS).find(t => t.symbol === formData.toToken);
  
          if (!fromTokenInfo || !toTokenInfo) {
            toast.error('Invalid token selected');
            return;
          }
  
          // ✅ FIXED: Ensure we have the account object
          if (!activeAccount.account) {
            toast.error('Smart account not properly initialized. Please refresh and try again.');
            console.error('❌ activeAccount missing "account" property:', activeAccount);
            return;
          }
  
          // ✅ Build swap params with validated smart account
          const swapParams = {
            // Pass the entire activeAccount object
            smartAccount: activeAccount,
            recipient: activeAccount.address,
            
            // Token addresses
            tokenIn: fromTokenInfo.address,
            tokenOut: toTokenInfo.address,
            
            // Token metadata
            tokenInSymbol: formData.fromToken,
            tokenOutSymbol: formData.toToken,
            tokenInDecimals: fromTokenInfo.decimals,
            tokenOutDecimals: toTokenInfo.decimals,
            
            // Amount
            amountIn: parseUnits(formData.amount, fromTokenInfo.decimals),
            
            // Optional deadline
            deadline: Math.floor(Date.now() / 1000) + 300 // 5 minutes
          };
  
          console.log('🚀 Executing swap with params:', {
            from: `${formData.amount} ${formData.fromToken}`,
            to: formData.toToken,
            smartAccount: swapParams.smartAccount.address, // Log address only
            hasAccountObject: !!swapParams.smartAccount.account,
            amountIn: swapParams.amountIn.toString()
          });
      
          // Execute swap
          const result = await swapExecutor.executeSwap(swapParams, {
            maxSlippage: formData.slippage / 100,
            skipQuote: false,
            skipApproval: false,
            enableGasOptimization: true,
            retryOnFailure: true,
            maxRetries: 2
          });
      
          if (result.success) {
            toast.success(`Swap executed successfully! Received ${formatTokenAmount(result.result.amountOut, toTokenInfo.decimals)} ${formData.toToken}`);
            
            // Clear the form
            setFormData((prev) => ({ ...prev, amount: '' }));
            
            console.log('✅ Swap result:', {
              txHash: result.result.txHash,
              amountOut: result.result.amountOut.toString(),
              gasUsed: result.result.gasUsed.toString(),
              slippage: result.result.slippage
            });
          } else {
            toast.error(result.error || 'Swap failed');
          }
        } catch (err) {
          console.error('Swap execution error:', err);
          toast.error(err.message || 'Unexpected error during swap');
        }
      } else {
        // Create DCA strategy
        const config = {
          smartAccountAddress: activeAccount.address,
          fromToken: formData.fromToken,
          toToken: formData.toToken,
          amountPerSwap: formData.amount,
          interval: formData.strategyType,
          slippage: formData.slippage / 100
        };
  
        const strategy = await createDCAStrategy(config, {
          encrypted: true,
          autoStart: true
        });
  
        if (strategy) {
          toast.success('DCA strategy created successfully!');
          setFormData(prev => ({ ...prev, amount: '' }));
        }
      }
    } catch (error) {
      console.error('Error executing action:', error);
      toast.error(error.message || 'Action failed');
    } finally {
      setIsCreating(false);
    }
  };

  const currentFromBalance = formData.fromToken === 'MON' 
    ? balance?.smart?.formatted || '0'
    : '0';

  const currentToBalance = formData.toToken === 'MON'
    ? balance?.smart?.formatted || '0'
    : '0';

  const insufficientBalance = parseFloat(formData.amount || 0) > parseFloat(currentFromBalance);
  const selectedStrategy = strategyOptions.find(s => s.value === formData.strategyType);
  
  const fromDropdownRef = useRef(null);
  const toDropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        showFromDropdown &&
        fromDropdownRef.current &&
        !fromDropdownRef.current.contains(event.target)
      ) {
        setShowFromDropdown(false);
      }
  
      if (
        showToDropdown &&
        toDropdownRef.current &&
        !toDropdownRef.current.contains(event.target)
      ) {
        setShowToDropdown(false);
      }
    };
  
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showFromDropdown, showToDropdown]);

  return (
    <>
      <div style={styles.pageContainer}>
        <div style={styles.mainContent}>
          {smartAccounts.length > 0 && (
            <div style={styles.accountSelectorWrapper}>
              <div style={styles.accountSelectorLabel}>Using Smart Account</div>
              <div style={styles.accountSelectContainer}>
                <button 
                  onClick={() => setShowAccountDropdown(!showAccountDropdown)}
                  style={styles.accountSelectButton}
                  disabled={accountLoading}
                >
                  <div style={styles.accountSelectInfo}>
                    <div style={{
                      ...styles.accountDot,
                      background: activeAccount?.deploymentState === 'deployed' ? '#a78bfa' : '#fbbf24'
                    }} />
                    <span style={styles.accountAddress}>
                      {activeAccount?.address ? formatAddress(activeAccount.address) : 'No account'}
                    </span>
                  </div>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>

                <AnimatePresence>
                  {showAccountDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      style={styles.accountDropdown}
                    >
                      {smartAccounts.map((account) => (
                        <button
                          key={account.address}
                          onClick={() => handleAccountSwitch(account.address)}
                          style={{
                            ...styles.accountDropdownItem,
                            ...(activeAccount?.address === account.address ? styles.accountDropdownItemActive : {})
                          }}
                        >
                          <div style={styles.accountDropdownInfo}>
                            <div style={{
                              ...styles.accountDot,
                              background: account.deploymentState === 'deployed' ? '#a78bfa' : '#fbbf24'
                            }} />
                            <div style={styles.accountDropdownText}>
                              <span style={styles.accountDropdownAddress}>{formatAddress(account.address)}</span>
                              <span style={styles.accountDropdownStatus}>
                                {account.deploymentState === 'deployed' ? 'Deployed' : 'Not Deployed'}
                              </span>
                            </div>
                          </div>
                          {activeAccount?.address === account.address && (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.5">
                              <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                          )}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

          <div style={styles.card}>
            <div style={styles.header}>
              <div>
                <h2 style={styles.title}>Swap</h2>
                <p style={styles.subtitle}>Trade tokens instantly or setup DCA</p>
              </div>
              <div style={styles.headerButtons}>
                <button 
                  onClick={() => setShowMonoAI(true)}
                  style={styles.aiButton}
                  title="Open Mono AI Assistant"
                >
                  <span style={styles.aiButtonIcon}>🤖</span>
                  <span style={styles.aiButtonText}>AI</span>
                </button>
                <button 
                  onClick={() => setShowSettings(!showSettings)}
                  style={{
                    ...styles.settingsButton,
                    ...(showSettings ? styles.settingsButtonActive : {})
                  }}
                  title="Settings"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 1v6m0 6v6M6 6l4.2 4.2m5.6 5.6L20 20M6 18l4.2-4.2m5.6-5.6L20 4"/>
                  </svg>
                </button>
              </div>
            </div>

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

            <div style={styles.section}>
              <div style={styles.sectionHeader}>
                <span style={styles.label}>From</span>
                <span style={styles.balance}>
                  Balance: {balance?.smart?.loading ? '...' : currentFromBalance}
                </span>
              </div>

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
                  
                  <AnimatePresence>
                    {showFromDropdown && (
                      <motion.div
                        ref={fromDropdownRef}
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

            <div style={styles.swapContainer}>
              <button onClick={handleSwapTokens} style={styles.swapButton}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M7 16V4M7 4L3 8M7 4L11 8"/>
                  <path d="M17 8V20M17 20L21 16M17 20L13 16"/>
                </svg>
              </button>
            </div>

            <div style={styles.section}>
              <div style={styles.sectionHeader}>
                <span style={styles.label}>To</span>
                <span style={styles.balance}>
                  Balance: {balance?.smart?.loading ? '...' : currentToBalance}
                </span>
              </div>

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
                  
                  <AnimatePresence>
                    {showToDropdown && (
                      <motion.div
                        ref={toDropdownRef}
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

            {prices.spot > 0 && formData.amount && (
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

            <button
              onClick={handleSubmit}
              disabled={isCreating || insufficientBalance || !formData.amount || !activeAccount?.address}
              style={{
                ...styles.submitButton,
                ...(insufficientBalance || !formData.amount || !activeAccount?.address ? styles.submitButtonDisabled : {}),
                opacity: isCreating ? 0.5 : 1,
                cursor: (isCreating || insufficientBalance || !formData.amount || !activeAccount?.address) ? 'not-allowed' : 'pointer'
              }}
            >
              {isCreating ? (
                <>
                  <div className="spinner" style={{width: '16px', height: '16px', borderWidth: '2px', marginRight: '8px'}} />
                  Processing...
                </>
              ) : !activeAccount?.address ? (
                'Select Smart Account'
              ) : activeAccount.deploymentState !== 'deployed' ? (
                'Deploy Account First'
              ) : insufficientBalance ? (
                'Insufficient Balance'
              ) : !formData.amount ? (
                'Enter Amount'
              ) : (
                selectedStrategy.label
              )}
            </button>
          </div>
        </div>

        <div style={styles.strategyCard}>
          <div style={styles.strategyHeader}>
            <h3 style={styles.strategyTitle}>Strategy</h3>
            <span style={styles.strategySubtitle}>Choose your trading method</span>
          </div>

          <div style={styles.strategyOptions}>
            {strategyOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => handleChange('strategyType', option.value)}
                style={{
                  ...styles.strategyOption,
                  ...(formData.strategyType === option.value ? styles.strategyOptionActive : {})
                }}
              >
                <div style={styles.strategyOptionIcon}>{option.icon}</div>
                <div style={styles.strategyOptionInfo}>
                  <span style={styles.strategyOptionLabel}>{option.label}</span>
                  <span style={styles.strategyOptionDesc}>{option.description}</span>
                </div>
                {formData.strategyType === option.value && (
                  <div style={styles.strategyCheckmark}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mono AI Modal */}
      <MonoAI 
        isOpen={showMonoAI}
        onClose={() => setShowMonoAI(false)}
        context={{ smartAccount: activeAccount }}
      />
    </>
  );
};

const styles = {
  pageContainer: { display: 'flex', gap: '1.5rem', maxWidth: '1000px', margin: '0 auto', padding: '1.5rem', flexWrap: 'wrap' },
  mainContent: { flex: '1 1 480px', minWidth: '320px' },
  accountSelectorWrapper: { marginBottom: '1rem' },
  accountSelectorLabel: { fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.4)', marginBottom: '0.5rem', fontWeight: '500' },
  accountSelectContainer: { position: 'relative' },
  accountSelectButton: { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '10px', color: '#ffffff', cursor: 'pointer', transition: 'all 0.2s' },
  accountSelectInfo: { display: 'flex', alignItems: 'center', gap: '0.625rem' },
  accountDot: { width: '6px', height: '6px', borderRadius: '50%', background: '#a78bfa' },
  accountAddress: { fontSize: '0.875rem', fontFamily: 'monospace', fontWeight: '500' },
  accountDropdown: { position: 'absolute', zIndex: 200, top: 'calc(100% + 0.5rem)', left: 0, right: 0, background: 'rgba(20, 20, 20, 0.98)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '12px', padding: '0.5rem', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)' },
  accountDropdownItem: { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s' },
  accountDropdownItemActive: { background: 'rgba(167, 139, 250, 0.1)' },
  accountDropdownInfo: { display: 'flex', alignItems: 'center', gap: '0.625rem' },
  accountDropdownText: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.125rem' },
  accountDropdownAddress: { fontSize: '0.875rem', fontFamily: 'monospace', fontWeight: '500', color: '#ffffff' },
  accountDropdownStatus: { fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.4)' },
  card: { background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '16px', padding: '1.25rem' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' },
  title: { margin: 0, fontSize: '1.5rem', fontWeight: '600', color: '#ffffff' },
  subtitle: { margin: '0.125rem 0 0', fontSize: '0.8125rem', color: 'rgba(255, 255, 255, 0.4)' },
  headerButtons: { display: 'flex', gap: '0.5rem' },
  aiButton: { display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.5rem 0.875rem', background: 'rgba(167, 139, 250, 0.1)', border: '1px solid rgba(167, 139, 250, 0.3)', borderRadius: '8px', color: '#a78bfa', cursor: 'pointer', transition: 'all 0.2s', fontSize: '0.8125rem', fontWeight: '600' },
  aiButtonIcon: { fontSize: '1rem' },
  aiButtonText: { fontSize: '0.8125rem' },
  settingsButton: { width: '32px', height: '32px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' },
  settingsButtonActive: { background: 'rgba(167, 139, 250, 0.1)', borderColor: 'rgba(167, 139, 250, 0.3)', color: '#a78bfa' },
  settingsPanel: { overflow: 'hidden', marginBottom: '1rem' },
  slippageSection: { padding: '1rem', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px' },
  slippageHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' },
  slippageValue: { fontSize: '0.875rem', fontWeight: '600', color: '#a78bfa' },
  slider: { width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255, 255, 255, 0.1)', outline: 'none', cursor: 'pointer', marginBottom: '0.75rem', WebkitAppearance: 'none', appearance: 'none' },
  slippagePresets: { display: 'flex', gap: '0.5rem' },
  presetBtn: { flex: 1, padding: '0.5rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.75rem', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s' },
  presetBtnActive: { background: 'rgba(167, 139, 250, 0.1)', borderColor: '#a78bfa', color: '#a78bfa' },
  section: { marginBottom: '0.5rem' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' },
  label: { fontSize: '0.8125rem', fontWeight: '500', color: 'rgba(255, 255, 255, 0.6)' },
  balance: { fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.4)' },
  quickButtons: { display: 'flex', gap: '0.375rem', marginBottom: '0.5rem' },
  quickBtn: { padding: '0.375rem 0.625rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.75rem', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s' },
  inputRow: { display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '1rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px' },
  amountInput: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#ffffff', fontSize: '1.5rem', fontWeight: '600' },
  tokenSelectWrapper: { position: 'relative' },
  tokenButton: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', color: '#ffffff', cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap' },
  tokenLogo: { width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' },
  tokenLogoSmall: { width: '20px', height: '20px', borderRadius: '50%', objectFit: 'cover' },
  tokenSymbol: { fontSize: '0.875rem', fontWeight: '600' },
  dropdown: { position: 'absolute', top: 'calc(100% + 0.5rem)', right: 0, minWidth: '200px', background: 'rgba(20, 20, 20, 0.98)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '12px', padding: '0.5rem', zIndex: 100, boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)' },
  dropdownItem: { width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'transparent', border: 'none', borderRadius: '8px', color: '#ffffff', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left' },
  tokenInfo: { display: 'flex', flexDirection: 'column', gap: '0.125rem' },
  tokenSymbolDrop: { fontSize: '0.875rem', fontWeight: '600', color: '#ffffff' },
  tokenName: { fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' },
  swapContainer: { display: 'flex', justifyContent: 'center', margin: '0.5rem 0' },
  swapButton: { width: '36px', height: '36px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', color: 'rgba(255, 255, 255, 0.6)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' },
  priceInfo: { padding: '0.875rem', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', marginTop: '0.75rem', marginBottom: '1rem' },
  priceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0' },
  priceLabel: { fontSize: '0.8125rem', color: 'rgba(255, 255, 255, 0.5)' },
  priceValue: { fontSize: '0.8125rem', fontWeight: '500', color: '#ffffff' },
  submitButton: { width: '100%', padding: '1rem', background: '#a78bfa', border: 'none', borderRadius: '12px', color: '#000000', fontSize: '1rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  submitButtonDisabled: { background: 'rgba(255, 255, 255, 0.1)', color: 'rgba(255, 255, 255, 0.3)' },
  strategyCard: { flex: '0 0 280px', alignSelf:'flex-start', marginTop:'25px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '16px', padding: '1.25rem', height: 'fit-content', minWidth: '280px' },
  strategyHeader: { marginBottom: '1rem' },
  strategyTitle: { margin: 0, fontSize: '1.125rem', fontWeight: '600', color: '#ffffff' },
  strategySubtitle: { display: 'block', marginTop: '0.25rem', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.4)' },
  strategyOptions: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  strategyOption: { width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '10px', cursor: 'pointer', transition: 'all 0.2s', position: 'relative' },
  strategyOptionActive: { background: 'rgba(167, 139, 250, 0.1)', borderColor: '#a78bfa' },
  strategyOptionIcon: { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'rgba(255, 255, 255, 0.6)' },
  strategyOptionInfo: { display: 'flex', flexDirection: 'column', gap: '0.125rem', flex: 1, textAlign: 'left' },
  strategyOptionLabel: { fontSize: '0.875rem', fontWeight: '600', color: '#ffffff' },
  strategyOptionDesc: { fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.4)', lineHeight: '1.3' },
  strategyCheckmark: { width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
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

export default SwapTab;