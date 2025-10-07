import { useState, useEffect, useCallback, useRef } from 'react';
import { formatUnits } from 'viem';
import toast from 'react-hot-toast';

// Services
import { 
  smartAccountFactory, 
  loadSmartAccountsForEOA, 
  createNewSmartAccount 
} from '../services/smartAccount/accountFactory';
import { monadClient } from '../services/monad/monadClient';
import { gasEstimator } from '../services/monad/gasEstimator';

// Utils
import { validateAddress } from '../utils/validators';
import { formatAddress, formatTokenAmount } from '../utils/formatters';
import { MONAD_CONFIG, SMART_ACCOUNT_CONFIG } from '../utils/constants';

// Hooks
import { useWallet } from './useWallet';

/**
 * ACCOUNT STATUS CONSTANTS
 */
const ACCOUNT_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DEPLOYING: 'deploying',
  DEPLOYED: 'deployed',
  ERROR: 'error'
};

/**
 * useSmartAccount Hook (EOA-Based)
 * 
 * Manages MetaMask Smart Accounts linked to EOA wallet.
 * No more password-based creation - uses EOA signatures.
 * 
 * Features:
 * - Create smart accounts via EOA signature
 * - Load all smart accounts for connected EOA
 * - Deploy accounts on-chain
 * - Track deployment status and balances
 * - Multi-account support (switch between accounts)
 */
export function useSmartAccount() {
  const { address: eoaAddress, isConnected: isWalletConnected } = useWallet();

  // Smart account state
  const [smartAccounts, setSmartAccounts] = useState([]); // All accounts for this EOA
  const [activeAccount, setActiveAccount] = useState(null); // Currently selected account
  const [status, setStatus] = useState(ACCOUNT_STATUS.DISCONNECTED);
  const [balance, setBalance] = useState({
    mon: '0',
    formatted: '0',
    loading: false
  });
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Refs
  const balanceIntervalRef = useRef(null);
  const mountedRef = useRef(true);

  /**
   * Initialize Monad client on mount
   */
  useEffect(() => {
    mountedRef.current = true;
    const initClient = async () => {
      try {
        await monadClient.initialize();
        console.log('✅ Monad client initialized');
      } catch (err) {
        console.error('❌ Failed to initialize Monad client:', err);
      }
    };

    initClient();

    return () => {
      mountedRef.current = false;
      if (balanceIntervalRef.current) {
        clearInterval(balanceIntervalRef.current);
      }
    };
  }, []);

  /**
   * Load smart accounts when EOA connects
   */
  useEffect(() => {
    if (eoaAddress && isWalletConnected) {
      loadAccountsForEOA();
    } else {
      // Clear accounts when wallet disconnects
      setSmartAccounts([]);
      setActiveAccount(null);
      setStatus(ACCOUNT_STATUS.DISCONNECTED);
    }
  }, [eoaAddress, isWalletConnected]);

  /**
   * Start balance polling for active account
   */
  useEffect(() => {
    if (activeAccount?.address && activeAccount?.deploymentState === 'deployed') {
      fetchBalance();
      
      if (balanceIntervalRef.current) clearInterval(balanceIntervalRef.current);
      balanceIntervalRef.current = setInterval(() => {
        fetchBalance();
      }, 10000); // Poll every 10s

      return () => {
        if (balanceIntervalRef.current) {
          clearInterval(balanceIntervalRef.current);
        }
      };
    }
  }, [activeAccount]);

  /**
   * Load all smart accounts for connected EOA
   */
  const loadAccountsForEOA = useCallback(async () => {
    if (!eoaAddress) return;

    try {
      setIsLoading(true);
      const accounts = loadSmartAccountsForEOA(eoaAddress);
      
      setSmartAccounts(accounts);
      
      // Auto-select first account if exists
      if (accounts.length > 0 && !activeAccount) {
        setActiveAccount(accounts[0]);
        setStatus(
          accounts[0].deploymentState === 'deployed' 
            ? ACCOUNT_STATUS.DEPLOYED 
            : ACCOUNT_STATUS.CONNECTED
        );
      } else if (accounts.length === 0) {
        setStatus(ACCOUNT_STATUS.DISCONNECTED);
      }

      console.log(`✅ Loaded ${accounts.length} smart account(s) for ${formatAddress(eoaAddress)}`);
    } catch (err) {
      console.error('Failed to load smart accounts:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [eoaAddress, activeAccount]);

  /**
   * Create new smart account (EOA-based)
   */
  const createSmartAccount = useCallback(async (eoaAccount) => {
    if (!eoaAddress) {
      throw new Error('EOA wallet not connected');
    }

    try {
      setIsLoading(true);
      setError(null);
      setStatus(ACCOUNT_STATUS.CONNECTING);

      toast.loading('Creating smart account...', { id: 'create-account' });

      // Create account via factory
      const account = await createNewSmartAccount(eoaAccount);

      if (!mountedRef.current) return;

      // Reload accounts list
      await loadAccountsForEOA();

      // Set as active account
      setActiveAccount(account);
      setStatus(account.isDeployed ? ACCOUNT_STATUS.DEPLOYED : ACCOUNT_STATUS.CONNECTED);

      toast.success(`Smart account created: ${formatAddress(account.address)}`, { id: 'create-account' });

      return account;

    } catch (err) {
      console.error('Failed to create smart account:', err);
      setError(err.message || 'Failed to create smart account');
      setStatus(ACCOUNT_STATUS.ERROR);
      toast.error(err.message || 'Failed to create smart account', { id: 'create-account' });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [eoaAddress, loadAccountsForEOA]);

  /**
   * Deploy active smart account
   */
  const deploySmartAccount = useCallback(async (firstTransaction = null) => {
    if (!activeAccount) {
      throw new Error('No smart account selected');
    }

    if (activeAccount.deploymentState === 'deployed') {
      throw new Error('Account already deployed');
    }

    try {
      setIsLoading(true);
      setError(null);
      setStatus(ACCOUNT_STATUS.DEPLOYING);

      toast.loading('Deploying smart account...', { id: 'deploy' });

      const receipt = await smartAccountFactory.deploySmartAccount(
        activeAccount,
        firstTransaction
      );

      if (!mountedRef.current) return;

      // Update account state
      const updatedAccount = {
        ...activeAccount,
        deploymentState: 'deployed',
        deploymentTxHash: receipt.transactionHash
      };

      setActiveAccount(updatedAccount);
      setStatus(ACCOUNT_STATUS.DEPLOYED);

      // Reload accounts
      await loadAccountsForEOA();

      toast.success('Smart account deployed successfully!', { id: 'deploy' });

      await fetchBalance();

      return receipt;

    } catch (err) {
      console.error('Failed to deploy smart account:', err);
      setError(err.message || 'Failed to deploy smart account');
      setStatus(ACCOUNT_STATUS.ERROR);
      toast.error(err.message || 'Failed to deploy smart account', { id: 'deploy' });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [activeAccount, loadAccountsForEOA]);

  /**
   * Switch active account
   */
  const switchAccount = useCallback((accountAddress) => {
    const account = smartAccounts.find(acc => acc.address === accountAddress);
    if (account) {
      setActiveAccount(account);
      setStatus(
        account.deploymentState === 'deployed' 
          ? ACCOUNT_STATUS.DEPLOYED 
          : ACCOUNT_STATUS.CONNECTED
      );
      toast.success(`Switched to ${formatAddress(accountAddress)}`);
    }
  }, [smartAccounts]);

  /**
   * Fetch MON balance for active account
   */
  const fetchBalance = useCallback(async () => {
    if (!activeAccount?.address) return;

    try {
      setBalance(prev => ({ ...prev, loading: true }));

      const balanceData = await monadClient.getBalance(activeAccount.address);
      
      if (!mountedRef.current) return;

      setBalance({
        mon: balanceData.value.toString(),
        formatted: formatUnits(balanceData.value, MONAD_CONFIG.decimals),
        loading: false
      });
    } catch (err) {
      console.error('Failed to fetch balance:', err);
      if (mountedRef.current) {
        setBalance(prev => ({ ...prev, loading: false }));
      }
    }
  }, [activeAccount]);

  /**
   * Check deployment status
   */
  const checkDeployment = useCallback(async () => {
    if (!activeAccount?.address) return false;

    try {
      const deployed = await smartAccountFactory.checkAccountDeployment(activeAccount.address);
      
      if (deployed && activeAccount.deploymentState !== 'deployed') {
        // Update local state
        const updatedAccount = {
          ...activeAccount,
          deploymentState: 'deployed'
        };
        setActiveAccount(updatedAccount);
        setStatus(ACCOUNT_STATUS.DEPLOYED);
        
        // Reload accounts
        await loadAccountsForEOA();
      }

      return deployed;
    } catch (err) {
      console.error('Failed to check deployment:', err);
      return false;
    }
  }, [activeAccount, loadAccountsForEOA]);

  /**
   * Disconnect (clear active account)
   */
  const disconnect = useCallback(() => {
    setActiveAccount(null);
    setStatus(ACCOUNT_STATUS.DISCONNECTED);
    setBalance({ mon: '0', formatted: '0', loading: false });
    setError(null);

    if (balanceIntervalRef.current) {
      clearInterval(balanceIntervalRef.current);
    }

    toast.success('Smart account disconnected');
  }, []);

  /**
   * Get account info summary
   */
  const getAccountInfo = useCallback(() => {
    if (!activeAccount) return null;

    return {
      address: activeAccount.address,
      formattedAddress: formatAddress(activeAccount.address),
      isDeployed: activeAccount.deploymentState === 'deployed',
      balance: balance.formatted,
      balanceWei: balance.mon,
      implementation: SMART_ACCOUNT_CONFIG.implementation,
      chainId: MONAD_CONFIG.chainId,
      network: MONAD_CONFIG.name,
      status,
      deploymentTxHash: activeAccount.deploymentTxHash
    };
  }, [activeAccount, balance, status]);

  /**
   * Estimate deployment gas
   */
  const estimateDeploymentGas = useCallback(async () => {
    if (!activeAccount) {
      throw new Error('No smart account selected');
    }

    try {
      const estimate = await gasEstimator.estimateOperationGas('ACCOUNT_DEPLOYMENT');
      return {
        ...estimate,
        gasLimit: Number(estimate?.standard?.gasLimit || 300000)
      };
    } catch (err) {
      console.error('Failed to estimate deployment gas:', err);
      throw err;
    }
  }, [activeAccount]);

  return {
    // State
    smartAccounts, // All accounts for this EOA
    activeAccount, // Currently selected account
    accountAddress: activeAccount?.address || null,
    status,
    isDeployed: activeAccount?.deploymentState === 'deployed',
    balance,
    error,
    isLoading,
    isConnected: eoaAddress && activeAccount !== null,

    // Methods
    createSmartAccount,
    deploySmartAccount,
    switchAccount,
    checkDeployment,
    disconnect,
    fetchBalance,
    getAccountInfo,
    estimateDeploymentGas,
    loadAccountsForEOA,

    // Derived state
    needsDeployment: activeAccount && activeAccount.deploymentState !== 'deployed',
    canDeploy: activeAccount && activeAccount.deploymentState !== 'deployed' && !isLoading,
    hasBalance: parseFloat(balance.formatted) > 0,
    hasMultipleAccounts: smartAccounts.length > 1,

    // Constants
    ACCOUNT_STATUS
  };
}

export default useSmartAccount;