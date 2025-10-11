import { useState, useEffect, useCallback, useRef } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { convertBalanceToUSD } from '../services/dca/priceOracle';

// Services
import { monadClient } from '../services/monad/monadClient';

import { useMemo } from 'react';

// Utils
import { 
  validateAddress,
  validateTokenAmount 
} from '../utils/validators';

import {
  formatTokenAmount,
  formatTokenAmountWithSymbol,
  getTokenInfo
} from '../utils/formatters';

import {
  MONAD_CONFIG,
  SUPPORTED_TOKENS,
  CONTRACTS
} from '../utils/constants';

/**
 * useMonadBalance Hook
 * 
 * Manages balance tracking for MON (native) and ERC-20 tokens on Monad testnet.
 * Provides real-time balance updates, multi-token tracking, formatted outputs,
 * and balance validation helpers.
 * 
 * @param {string} address - Account address to track
 * @param {Object} options - Configuration options
 * @returns {Object} Balance management interface
 */
export const useMonadBalance = (address, options = {}) => {
  const {
    pollInterval = 10000, // 10 seconds default
    autoRefresh = true,
    tokens = [], // Additional tokens to track beyond MON
    onBalanceChange = null // Callback when balance changes
  } = options;

  // ===== STATE =====
  const [balances, setBalances] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  // ===== REFS =====
  const pollIntervalRef = useRef(null);
  const isMounted = useRef(true);
  const previousBalances = useRef({});

 
  // ===== INITIALIZATION =====
  useEffect(() => {
    isMounted.current = true;

    if (address && validateAddress(address).isValid) {
      fetchAllBalances();

      if (autoRefresh) {
        startPolling();
      }
    }

    return () => {
      isMounted.current = false;
      stopPolling();
    };
  }, [address, autoRefresh, pollInterval]);

  // Token list changes
  const normalizedTokens = useMemo(
    ()=>[...new Set(tokens)].sort(),
    [tokens]
  );
  useEffect(() => {
    if (address && validateAddress(address).isValid) {
      fetchAllBalances();
    }
  }, [normalizedTokens]);

  // ===== BALANCE FETCHING =====
  const fetchAllBalances = useCallback(async () => {
    if (!address) return;

    if (!monadClient.publicClient) {
      console.warn('[useMonadBalance] Monad client not ready yet - skipping balance fetch.');
      return;
    }

    // Prevent overlapping fetchAllBalances invocations
    if (fetchAllBalances._isFetching) return;
    fetchAllBalances._isFetching = true;

    const validation = validateAddress(address);
    if (!validation.isValid) {
      setError('Invalid address');
      fetchAllBalances._isFetching = false;
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Always fetch MON balance
      const balanceData = { MON: await fetchMONBalance(address) };

      // Fetch additional token balances
      const tokenList = [...new Set([...tokens, ...getDefaultTrackedTokens()])];
      
      await Promise.all(
        tokenList.map(async (tokenAddress) => {
          try {
            const tokenInfo = getTokenInfo(tokenAddress);
            if (tokenInfo) {
              balanceData[tokenInfo.symbol] = await fetchTokenBalance(
                address,
                tokenAddress,
                tokenInfo
              );
            }
          } catch (err) {
            console.warn(`[useMonadBalance] Failed to fetch ${tokenAddress}:`, err);
          }
        })
      );

      if (isMounted.current) {
        setBalances(balanceData);
        setLastUpdate(Date.now());

        // Detect changes and trigger callback
        detectBalanceChanges(balanceData);
      }

    } catch (err) {
      console.error('[useMonadBalance] Fetch error:', err);
      if (isMounted.current) {
        setError(err.message);
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
      fetchAllBalances._isFetching = false;
    }
  }, [address, tokens]);

  // ===== MON BALANCE =====
  const fetchMONBalance = useCallback(async (accountAddress) => {
    if (!accountAddress) {
      return {
        raw: 0n,
        formatted: '0',
        decimals: 18,
        symbol: 'MON',
        name: 'Monad',
        isNative: true,
        displayValue: '0',
        usdValue: null,
      };
    }

    try {
      const balanceResp = await monadClient.getBalance(accountAddress);
      if (!balanceResp || !balanceResp.balance) {
        return {
          raw: 0n,
          formatted: '0',
          decimals: 18,
          symbol: 'MON',
          name: 'Monad',
          isNative: true,
          displayValue: '0',
          usdValue: null,
        };
      }

      const rawBalance = BigInt(balanceResp.balance.toString ? balanceResp.balance.toString() : balanceResp.balance);
      const formatted = balanceResp.formatted ?? formatUnits(rawBalance, 18);

      return {
        raw: rawBalance,
        formatted,
        decimals: 18,
        symbol: balanceResp.symbol || 'MON',
        name: 'Monad',
        isNative: true,
        displayValue: formatTokenAmount(rawBalance, 18, 4),
        usdValue: await convertBalanceToUSD('MON', rawBalance, 18)
      };
    } catch (err) {
      console.error('[useMonadBalance] MON fetch error:', err);
      return {
        raw: 0n,
        formatted: '0',
        decimals: 18,
        symbol: 'MON',
        name: 'Monad',
        isNative: true,
        displayValue: '0',
        usdValue: null,
        error: err.message
      };
    }
  }, []);


  // ===== ERC-20 BALANCE =====
  const fetchTokenBalance = useCallback(async (accountAddress, tokenAddress, tokenInfo) => {
    try {
      const balanceData = await monadClient.getBalance(accountAddress, tokenAddress);
      
      return {
        raw: balanceData.balance,
        formatted: formatUnits(balanceData.balance, balanceData.decimals),
        decimals: balanceData.decimals,
        symbol: balanceData.symbol || tokenInfo.symbol,
        name: tokenInfo.name,
        address: tokenAddress,
        isNative: false,
        displayValue: formatTokenAmount(balanceData.balance, balanceData.decimals, 4),
        usdValue: await convertBalanceToUSD(
          tokenInfo.symbol,
          balanceData.balance,
          balanceData.decimals
        )
      };
    } catch (err) {
      console.error(`[useMonadBalance] Token ${tokenInfo.symbol} fetch error:`, err);
      return {
        raw: 0n,
        formatted: '0',
        decimals: tokenInfo.decimals,
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        address: tokenAddress,
        isNative: false,
        displayValue: '0',
        usdValue: null,
        error: err.message
      };
    }
  }, []);

  // ===== SINGLE TOKEN REFRESH =====
  const refreshTokenBalance = useCallback(async (tokenSymbolOrAddress) => {
    if (!address) return null;

    try {
      setIsLoading(true);

      let balance;
      if (tokenSymbolOrAddress === 'MON') {
        balance = await fetchMONBalance(address);
      } else {
        const tokenInfo = getTokenInfo(tokenSymbolOrAddress);
        if (!tokenInfo) {
          throw new Error(`Unknown token: ${tokenSymbolOrAddress}`);
        }
        balance = await fetchTokenBalance(address, tokenInfo.address, tokenInfo);
      }

      if (isMounted.current) {
        setBalances(prev => ({
          ...prev,
          [balance.symbol]: balance
        }));
        setLastUpdate(Date.now());
      }

      return balance;

    } catch (err) {
      console.error('[useMonadBalance] Refresh token error:', err);
      throw err;
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [address]);

  // ===== POLLING =====
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;

    pollIntervalRef.current = setInterval(() => {
      if (isMounted.current && address) {
        fetchAllBalances();
      }
    }, pollInterval);
  }, [pollInterval, address, fetchAllBalances]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // ===== BALANCE CHANGE DETECTION =====
  const detectBalanceChanges = useCallback((newBalances) => {
    if (!onBalanceChange) return;

    const changes = [];

    Object.keys(newBalances).forEach(symbol => {
      const oldBalance = previousBalances.current[symbol];
      const newBalance = newBalances[symbol];

      if (oldBalance && newBalance && oldBalance.raw !== newBalance.raw) {
        const difference = newBalance.raw - oldBalance.raw;
        changes.push({
          token: symbol,
          oldBalance: oldBalance.raw,
          newBalance: newBalance.raw,
          difference,
          isIncrease: difference > 0n,
          formattedDifference: formatTokenAmount(
            difference < 0n ? -difference : difference,
            newBalance.decimals,
            4
          )
        });
      }
    });

    if (changes.length > 0) {
      onBalanceChange(changes);
    }

    previousBalances.current = newBalances;
  }, [onBalanceChange]);

  // ===== VALIDATION HELPERS =====
  const hasSufficientBalance = useCallback((tokenSymbol, amount) => {
    const balance = balances[tokenSymbol];
    if (!balance) return false;

    try {
      const tokenInfo = getTokenInfo(tokenSymbol);
      if (!tokenInfo) return false;

      const amountWei = parseUnits(amount.toString(), tokenInfo.decimals);
      return balance.raw >= amountWei;
    } catch (err) {
      console.error('[useMonadBalance] Balance check error:', err);
      return false;
    }
  }, [balances]);

  const hasSufficientBalanceForGas = useCallback((gasLimit, value = 0n) => {
    const monBalance = balances.MON;
    if (!monBalance) return false;
    // ⚠️ On Monad, gas is charged by gas_limit not gas_used.
    // Ensure `gasLimit` passed here is the full gas_limit, not an estimate.
    const gasCost = BigInt(gasLimit) * MONAD_CONFIG.baseFee;
    const totalRequired = gasCost + BigInt(value);

    return monBalance.raw >= totalRequired;
  }, [balances]);

  const getMaxSpendableAmount = useCallback((tokenSymbol, reserveForGas = true) => {
    const balance = balances[tokenSymbol];
    if (!balance) return '0';

    if (tokenSymbol === 'MON' && reserveForGas) {
      // Reserve 0.01 MON for gas
      const reserve = parseUnits('0.01', 18);
      const spendable = balance.raw > reserve ? balance.raw - reserve : 0n;
      return formatUnits(spendable, 18);
    }

    return balance.formatted;
  }, [balances]);

  // ===== DISPLAY HELPERS =====
  const getBalanceForDisplay = useCallback((tokenSymbol) => {
    const balance = balances[tokenSymbol];
    if (!balance) return null;

    return {
      ...balance,
      formattedWithSymbol: `${balance.displayValue} ${balance.symbol}`,
      isZero: balance.raw === 0n,
      isLow: balance.raw > 0n && balance.raw < parseUnits('0.1', balance.decimals)
    };
  }, [balances]);

  const getAllBalancesForDisplay = useCallback(() => {
    return Object.entries(balances).map(([symbol, balance]) => ({
      symbol,
      ...balance,
      formattedWithSymbol: `${balance.displayValue} ${balance.symbol}`,
      isZero: balance.raw === 0n,
      isLow: balance.raw > 0n && balance.raw < parseUnits('0.1', balance.decimals)
    }));
  }, [balances]);

  // ===== UTILITY =====
  const getDefaultTrackedTokens = useCallback(() => {
    // Track stablecoins and major tokens by default
    return [
      CONTRACTS.USDC,
      CONTRACTS.WBTC,
      CONTRACTS.WETH
    ];
  }, []);

  const calculateTotalBalanceUSD = useCallback((balanceData) => {
    try {
      let total = 0;
      for (const symbol in balanceData) {
        const b = balanceData[symbol];
        if (b?.usdValue) total += b.usdValue;
      }
      return total;
    } catch (err) {
      console.error('[useMonadBalance] USD calc error:', err);
      return null;
    }
  },[]);

   // ===== COMPUTED STATE =====
   const hasBalance = Object.values(balances).some(b => b?.raw > 0n);
   const hasSufficientMON = (balances.MON?.raw || 0n) > parseUnits('0.01', 18); // Min 0.01 MON
   const totalBalanceUSD = calculateTotalBalanceUSD(balances);
 

  // ===== NETWORK STATUS =====
  const getNetworkInfo = useCallback(() => {
    return {
      chainId: MONAD_CONFIG.chainId,
      name: MONAD_CONFIG.name,
      currency: MONAD_CONFIG.currency,
      explorer: MONAD_CONFIG.explorer,
      isTestnet: true
    };
  }, []);
  useEffect(() => {
    window.refreshBalances = refreshTokenBalance;
    return () => {
    delete window.refreshBalances;
  };
}, [refreshTokenBalance]);

  // ===== EXPORTS =====
  return {
    // State
    balances,
    isLoading,
    error,
    lastUpdate,
    

    // Computed
    hasBalance,
    hasSufficientMON,
    totalBalanceUSD,

    // Fetch methods
    fetchAllBalances,
    refreshTokenBalance,

    // Validation
    hasSufficientBalance,
    hasSufficientBalanceForGas,
    getMaxSpendableAmount,

    // Display
    getBalanceForDisplay,
    getAllBalancesForDisplay,

    // Polling control
    startPolling,
    stopPolling,

    // Network
    getNetworkInfo,

    // Individual balance accessors
    monBalance: balances.MON,
    usdcBalance: balances.USDC,
    wbtcBalance: balances.WBTC,
    wethBalance: balances.WETH
  };
};

// ===== EXPORTS =====
export default useMonadBalance;

// Export helper for standalone balance checks
export const checkBalance = async (address, tokenAddress = null) => {
  try {
    const balance = await monadClient.getBalance(address, tokenAddress);
    return balance;
  } catch (err) {
    console.error('[checkBalance] Error:', err);
    throw err;
  }
};

// Export helper for formatted balance display
export const getFormattedBalance = async (address, tokenSymbolOrAddress) => {
  try {
    const tokenInfo = getTokenInfo(tokenSymbolOrAddress);
    
    if (!tokenInfo) {
      throw new Error(`Unknown token: ${tokenSymbolOrAddress}`);
    }

    const isNative = tokenInfo.isNative || tokenSymbolOrAddress === 'MON';
    const balance = await monadClient.getBalance(
      address,
      isNative ? null : tokenInfo.address
    );

    const decimals = isNative ? 18 : balance.decimals;
    const symbol = isNative ? 'MON' : balance.symbol || tokenInfo.symbol;

    return {
      raw: isNative ? balance : balance.balance,
      formatted: formatUnits(isNative ? balance : balance.balance, decimals),
      displayValue: formatTokenAmount(isNative ? balance : balance.balance, decimals, 4),
      symbol,
      decimals
    };

  } catch (err) {
    console.error('[getFormattedBalance] Error:', err);
    throw err;
  }
};