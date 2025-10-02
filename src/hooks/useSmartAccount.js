import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { privateKeyToAccount } from 'viem/accounts';
import { formatUnits, parseUnits } from 'viem';

// Services
import { smartAccountFactory } from '../services/smartAccount/accountFactory';
import { monadClient } from '../services/monad/monadClient';
import { gasEstimator } from '../services/monad/gasEstimator';
import { bundlerClient } from '../services/smartAccount/bundlerClient';

// Utils
import { validateAddress, validatePrivateKey } from '../utils/validators';
import { formatAddress, formatTokenAmount } from '../utils/formatters';
import { encryptPrivateKey, decryptPrivateKey, secureStorage } from '../utils/encryption';
import { MONAD_CONFIG, SMART_ACCOUNT_CONFIG, CONTRACTS, ERROR_CODES } from '../utils/constants';

// Toast notifications
import toast from 'react-hot-toast';

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
 * useSmartAccount Hook
 * 
 * Manages MetaMask Smart Account lifecycle on Monad testnet.
 * Handles creation, deployment, balance tracking, and wallet integration.
 * 
 * Features:
 * - Create new smart accounts (Hybrid implementation with EOA + passkeys)
 * - Import existing smart accounts
 * - Deploy accounts deterministically
 * - Track deployment status and balances
 * - Encrypt/decrypt private keys
 * - Integrate with wagmi wallet
 * - Auto-reconnect on page refresh
 * 
 * @returns {Object} Smart account state and methods
 */
export function useSmartAccount() {
  // Wagmi hooks for wallet connection
  const { address: eoaAddress, isConnected: isWalletConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  // Smart account state
  const [smartAccount, setSmartAccount] = useState(null);
  const [accountAddress, setAccountAddress] = useState(null);
  const [status, setStatus] = useState(ACCOUNT_STATUS.DISCONNECTED);
  const [isDeployed, setIsDeployed] = useState(false);
  const [balance, setBalance] = useState({
    mon: '0',
    formatted: '0',
    loading: false
  });
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Refs for cleanup and debouncing
  const balanceIntervalRef = useRef(null);
  const mountedRef = useRef(true);

  /**
   * Initialize Monad client on mount
   */
  useEffect(() => {
    const initClient = async () => {
      try {
        await monadClient.initialize();
        console.log('Monad client initialized');
      } catch (err) {
        console.error('Failed to initialize Monad client:', err);
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
   * Attempt to restore smart account from secure storage on mount
   */
  useEffect(() => {
    const restoreAccount = async () => {
      try {
        const storedAddress = secureStorage.retrieve('smart_account_address');
        if (!storedAddress) return;

        setStatus(ACCOUNT_STATUS.CONNECTING);

        // Check if account is deployed
        const deployed = await smartAccountFactory.checkAccountDeployment(storedAddress);
        
        if (deployed) {
          // Try to recreate account instance (requires private key)
          const encryptedKey = secureStorage.retrieve(`pk_${storedAddress}`);
          if (encryptedKey) {
            // Note: In production, you'd prompt for password here
            // For now, we just mark it as available for import
            setAccountAddress(storedAddress);
            setIsDeployed(true);
            setStatus(ACCOUNT_STATUS.DEPLOYED);
            toast.success(`Smart account restored: ${formatAddress(storedAddress)}`);
          }
        }
      } catch (err) {
        console.error('Failed to restore smart account:', err);
      }
    };

    restoreAccount();
  }, []);

  /**
   * Start balance polling when account is active
   */
  useEffect(() => {
    if (accountAddress && isDeployed) {
      fetchBalance();
      
      // Poll balance every 10 seconds
      balanceIntervalRef.current = setInterval(() => {
        fetchBalance();
      }, 10000);

      return () => {
        if (balanceIntervalRef.current) {
          clearInterval(balanceIntervalRef.current);
        }
      };
    }
  }, [accountAddress, isDeployed]);

  /**
   * Fetch MON balance for smart account
   */
  const fetchBalance = useCallback(async () => {
    if (!accountAddress) return;

    try {
      setBalance(prev => ({ ...prev, loading: true }));

      const balanceData = await monadClient.getBalance(accountAddress);
      
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
  }, [accountAddress]);

  /**
   * Create a new smart account
   * 
   * @param {Object} options - Creation options
   * @param {string} options.owner - Owner address (optional, auto-generated if not provided)
   * @param {string} options.privateKey - Private key (optional, auto-generated if not provided)
   * @param {string} options.password - Password for encryption (required)
   * @param {boolean} options.autoDeploy - Auto-deploy after creation (default: false)
   * @returns {Promise<Object>} Created smart account
   */
  const createSmartAccount = useCallback(async (options = {}) => {
    try {
      setIsLoading(true);
      setError(null);
      setStatus(ACCOUNT_STATUS.CONNECTING);

      const { password, autoDeploy = false } = options;

      if (!password || password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      // Create account with Hybrid implementation
      const account = await smartAccountFactory.createSmartAccount({
        implementation: SMART_ACCOUNT_CONFIG.implementation,
        deploySalt: SMART_ACCOUNT_CONFIG.deploySalt,
        encryptPrivateKey: true,
        password
      });

      if (!mountedRef.current) return;

      setSmartAccount(account);
      setAccountAddress(account.address);
      setIsDeployed(account.isDeployed);
      setStatus(account.isDeployed ? ACCOUNT_STATUS.DEPLOYED : ACCOUNT_STATUS.CONNECTED);

      // Store address in secure storage
      secureStorage.store('smart_account_address', account.address, 7 * 24 * 60 * 60 * 1000); // 7 days

      toast.success(`Smart account created: ${formatAddress(account.address)}`);

      // Auto-deploy if requested
      if (autoDeploy && !account.isDeployed) {
        await deploySmartAccount();
      }

      return account;

    } catch (err) {
      console.error('Failed to create smart account:', err);
      setError(err.message || 'Failed to create smart account');
      setStatus(ACCOUNT_STATUS.ERROR);
      toast.error(err.message || 'Failed to create smart account');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Import an existing smart account
   * 
   * @param {string} address - Smart account address
   * @param {string} privateKey - Private key (64 hex chars)
   * @param {string} password - Password for encryption
   * @returns {Promise<Object>} Imported smart account
   */
  const importSmartAccount = useCallback(async (address, privateKey, password) => {
    try {
      setIsLoading(true);
      setError(null);
      setStatus(ACCOUNT_STATUS.CONNECTING);

      // Validate inputs
      if (!validateAddress(address)) {
        throw new Error('Invalid smart account address');
      }

      if (!validatePrivateKey(privateKey)) {
        throw new Error('Invalid private key');
      }

      if (!password || password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      // Import account
      const account = await smartAccountFactory.importSmartAccount(
        address,
        privateKey,
        {
          encryptPrivateKey: true,
          password
        }
      );

      if (!mountedRef.current) return;

      setSmartAccount(account);
      setAccountAddress(account.address);
      setIsDeployed(account.isDeployed);
      setStatus(account.isDeployed ? ACCOUNT_STATUS.DEPLOYED : ACCOUNT_STATUS.CONNECTED);

      // Store address
      secureStorage.store('smart_account_address', account.address, 7 * 24 * 60 * 60 * 1000);

      toast.success(`Smart account imported: ${formatAddress(account.address)}`);

      return account;

    } catch (err) {
      console.error('Failed to import smart account:', err);
      setError(err.message || 'Failed to import smart account');
      setStatus(ACCOUNT_STATUS.ERROR);
      toast.error(err.message || 'Failed to import smart account');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Deploy smart account on-chain
   * 
   * @param {Object} firstTransaction - Optional first transaction to include with deployment
   * @returns {Promise<Object>} Deployment receipt
   */
  const deploySmartAccount = useCallback(async (firstTransaction = null) => {
    try {
      if (!smartAccount) {
        throw new Error('No smart account loaded');
      }

      if (isDeployed) {
        throw new Error('Account already deployed');
      }

      setIsLoading(true);
      setError(null);
      setStatus(ACCOUNT_STATUS.DEPLOYING);

      toast.loading('Deploying smart account...', { id: 'deploy' });

      // Deploy account
      const receipt = await smartAccountFactory.deploySmartAccount(
        smartAccount,
        firstTransaction
      );

      if (!mountedRef.current) return;

      setIsDeployed(true);
      setStatus(ACCOUNT_STATUS.DEPLOYED);

      toast.success('Smart account deployed successfully!', { id: 'deploy' });

      // Fetch initial balance
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
  }, [smartAccount, isDeployed, fetchBalance]);

  /**
   * Check deployment status of current account
   * 
   * @returns {Promise<boolean>} Deployment status
   */
  const checkDeployment = useCallback(async () => {
    if (!accountAddress) return false;

    try {
      const deployed = await smartAccountFactory.checkAccountDeployment(accountAddress);
      setIsDeployed(deployed);
      
      if (deployed && status === ACCOUNT_STATUS.CONNECTED) {
        setStatus(ACCOUNT_STATUS.DEPLOYED);
      }

      return deployed;
    } catch (err) {
      console.error('Failed to check deployment:', err);
      return false;
    }
  }, [accountAddress, status]);

  /**
   * Disconnect smart account
   */
  const disconnect = useCallback(() => {
    setSmartAccount(null);
    setAccountAddress(null);
    setStatus(ACCOUNT_STATUS.DISCONNECTED);
    setIsDeployed(false);
    setBalance({ mon: '0', formatted: '0', loading: false });
    setError(null);

    // Clear secure storage
    secureStorage.remove('smart_account_address');

    if (balanceIntervalRef.current) {
      clearInterval(balanceIntervalRef.current);
    }

    toast.success('Smart account disconnected');
  }, []);

  /**
   * Get account info summary
   * 
   * @returns {Object} Account information
   */
  const getAccountInfo = useCallback(() => {
    if (!smartAccount || !accountAddress) {
      return null;
    }

    return {
      address: accountAddress,
      formattedAddress: formatAddress(accountAddress),
      isDeployed,
      balance: balance.formatted,
      balanceWei: balance.mon,
      implementation: SMART_ACCOUNT_CONFIG.implementation,
      chainId: MONAD_CONFIG.chainId,
      network: MONAD_CONFIG.name,
      status
    };
  }, [smartAccount, accountAddress, isDeployed, balance, status]);

  /**
   * Estimate gas for account deployment
   * 
   * @returns {Promise<Object>} Gas estimate
   */
  const estimateDeploymentGas = useCallback(async () => {
    if (!smartAccount) {
      throw new Error('No smart account loaded');
    }

    try {
      const estimate = await gasEstimator.estimateOperationGas('accountDeployment');
      return estimate;
    } catch (err) {
      console.error('Failed to estimate deployment gas:', err);
      throw err;
    }
  }, [smartAccount]);

  return {
    // State
    smartAccount,
    accountAddress,
    status,
    isDeployed,
    balance,
    error,
    isLoading,
    isConnected: status !== ACCOUNT_STATUS.DISCONNECTED && status !== ACCOUNT_STATUS.ERROR,

    // Methods
    createSmartAccount,
    importSmartAccount,
    deploySmartAccount,
    checkDeployment,
    disconnect,
    fetchBalance,
    getAccountInfo,
    estimateDeploymentGas,

    // Derived state
    needsDeployment: smartAccount && !isDeployed,
    canDeploy: smartAccount && !isDeployed && !isLoading,
    hasBalance: parseFloat(balance.formatted) > 0,

    // Constants
    ACCOUNT_STATUS
  };
}

export default useSmartAccount;