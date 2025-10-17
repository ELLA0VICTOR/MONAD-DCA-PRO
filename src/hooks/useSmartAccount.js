import { useState, useEffect, useCallback, useRef } from 'react';
import { formatUnits } from 'viem';
import toast from 'react-hot-toast';
import { bundlerClient } from '../services/smartAccount/bundlerClient';

// Services
import { 
  smartAccountFactory, 
  loadSmartAccountsForEOA, 
  createNewSmartAccount 
} from '../services/smartAccount/accountFactory';
import { monadClient } from '../services/monad/monadClient';
import { gasEstimator } from '../services/monad/gasEstimator';

// Utils
import { formatAddress } from '../utils/formatters';
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
 * useSmartAccount Hook (EOA-Based with Auto-Deploy)
 */
export function useSmartAccount() {
  const { 
    address: eoaAddress, 
    isConnected: isWalletConnected,
    walletClient,
    signMessage 
  } = useWallet();

  // Smart account state
  const [smartAccounts, setSmartAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [status, setStatus] = useState(ACCOUNT_STATUS.DISCONNECTED);
  const [balance, setBalance] = useState({
    eoa: { raw: '0', formatted: '0', loading: false },
    smart: { raw: '0', formatted: '0', loading: false }
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
  
    if (monadClient.connectionState !== 'connected') {
      monadClient.initialize()
        .then(() => console.log('✅ Monad client initialized'))
        .catch(err => console.error('❌ Failed to initialize Monad client:', err));
    }
  
    return () => {
      mountedRef.current = false;
      if (balanceIntervalRef.current) clearInterval(balanceIntervalRef.current);
    };
  }, []);

  /**
   * Check deployment status (MOVED UP - must be defined before it's used)
   */
  const checkDeployment = useCallback(async (address = null) => {
    const accountAddress = address || activeAccount?.address;
    if (!accountAddress) return false;

    try {
      const deployed = await smartAccountFactory.checkAccountDeployment(accountAddress);
      
      // Update status if checking active account
      if (accountAddress === activeAccount?.address && deployed && activeAccount.deploymentState !== 'deployed') {
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
  }, [activeAccount]); // Note: loadAccountsForEOA will be added to deps after it's defined

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
        const firstAccount = accounts[0];
        
        // ✅ CRITICAL: Rehydrate the account object if missing
        let fullAccount = firstAccount;
        
        if (!firstAccount.account && walletClient?.account) {
          console.log('🔄 Rehydrating first smart account...');
          
          try {
             // 🧩 Step 1: Recreate the smart account instance properly
             const recreated = await smartAccountFactory.createSmartAccount(
              walletClient.account,
              walletClient,
              {
                deploySalt: firstAccount.deploySalt, // if available
              }
            );
            // 🧩 Step 2: Create the client using bundlerClient
            const smartAccountClient = bundlerClient.createSmartAccountClient(recreated.account, {
              sponsorUserOperation: true,
            });
              
            // Attach the fully functional client
            fullAccount = {
              ...firstAccount,
              account: recreated.account,
              client: smartAccountClient, // <— new field
              ownerAccount: recreated.ownerAccount,
            };
            
            if (recreated.address.toLowerCase() === firstAccount.address.toLowerCase()) {
              console.log('✅ First account rehydrated');
            } else {
              console.warn('⚠️ Address mismatch while rehydrating');
            }
          } catch (rehydrateErr) {
            console.warn('Failed to rehydrate account:', rehydrateErr);
          }
        }
        
        setActiveAccount(fullAccount);
        
        // Check deployment status
        const isDeployed = await checkDeployment(fullAccount.address);
        setStatus(isDeployed ? ACCOUNT_STATUS.DEPLOYED : ACCOUNT_STATUS.CONNECTED);
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
  }, [eoaAddress, activeAccount, walletClient, checkDeployment]);

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
  }, [eoaAddress, isWalletConnected, loadAccountsForEOA]);

  /**
   * Fetch balances
   */
  const fetchBalances = useCallback(async () => {
    if (!eoaAddress) return;
    if (!activeAccount?.address) return;
  
    if (fetchBalances._isFetching) return;
    fetchBalances._isFetching = true;
  
    try {
      setBalance(prev => ({
        eoa: { ...prev.eoa, loading: true },
        smart: { ...prev.smart, loading: true }
      }));
  
      // Fetch EOA balance
      let eoaData = null;
      try {
        eoaData = await monadClient.getBalance(eoaAddress);
      } catch (err) {
        console.warn('EOA getBalance failed:', err);
      }
  
      // Fetch Smart Account balance
      let smartData = null;
      try {
        smartData = await monadClient.getBalance(activeAccount.address);
      } catch (err) {
        console.warn('Smart account getBalance failed:', err);
      }
  
      if (!mountedRef.current) return;
  
      const eoaRaw = BigInt(eoaData?.balance ?? 0);
      const smartRaw = BigInt(smartData?.balance ?? 0);
  
      const eoaFormatted = eoaData?.formatted ?? formatUnits(eoaRaw, MONAD_CONFIG.decimals);
      const smartFormatted = smartData?.formatted ?? formatUnits(smartRaw, MONAD_CONFIG.decimals);
  
      setBalance({
        eoa: { raw: eoaRaw.toString(), formatted: eoaFormatted, loading: false },
        smart: { raw: smartRaw.toString(), formatted: smartFormatted, loading: false }
      });
    } catch (err) {
      console.error('fetchBalances error:', err);
      setBalance(prev => ({
        eoa: { ...prev.eoa, loading: false },
        smart: { ...prev.smart, loading: false }
      }));
    } finally {
      fetchBalances._isFetching = false;
    }
  }, [eoaAddress, activeAccount]);

  /**
   * Start polling for balance
   */
  useEffect(() => {
    if (balanceIntervalRef.current) {
      clearInterval(balanceIntervalRef.current);
      balanceIntervalRef.current = null;
    }
  
    if (!activeAccount?.address || !eoaAddress) return;
  
    let exited = false;
  
    const startPolling = async () => {
      try {
        await fetchBalances();
      } catch (err) {
        console.warn('[useSmartAccount] Initial balance fetch failed:', err);
      }
  
      if (exited) return;
  
      balanceIntervalRef.current = setInterval(() => {
        fetchBalances().catch(err => {
          console.warn('[useSmartAccount] Poll fetch failed:', err);
        });
      }, 360000);
    };
  
    startPolling();
  
    return () => {
      exited = true;
      if (balanceIntervalRef.current) {
        clearInterval(balanceIntervalRef.current);
        balanceIntervalRef.current = null;
      }
    };
  }, [eoaAddress, activeAccount, fetchBalances]);

  /**
   * Create new smart account (EOA-based) + AUTO-DEPLOY
   */
  const createSmartAccount = useCallback(async () => {
    if (!eoaAddress) {
      throw new Error('EOA wallet not connected');
    }

    if (!walletClient) {
      throw new Error('Wallet client not available. Please ensure your wallet is connected.');
    }

    try {
      setIsLoading(true);
      setError(null);
      setStatus(ACCOUNT_STATUS.CONNECTING);

      console.log('🚀 Starting smart account creation for:', eoaAddress);
      toast.loading('Creating smart account...', { id: 'create-account' });

      // Step 1: Request signature (optional - with timeout)
      try {
        const message = `Sign this message to create a smart account.\n\nAddress: ${eoaAddress}\nTimestamp: ${Date.now()}`;
        const signaturePromise = signMessage(message);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Signature timeout')), 30000)
        );
        
        await Promise.race([signaturePromise, timeoutPromise]);
        toast.loading('Signature verified. Creating account...', { id: 'create-account' });
      } catch (signError) {
        if (signError.message?.includes('rejected') || signError.message?.includes('denied')) {
          toast.error('Signature request was rejected', { id: 'create-account' });
          throw new Error('User rejected signature request');
        }
        console.warn('⚠️ Signature failed/timed out, continuing anyway');
      }

      // Step 2: Get viem account from wallet client
      const eoaAccount = walletClient.account;
      
      if (!eoaAccount || !eoaAccount.address) {
        throw new Error('Invalid wallet account. Please reconnect your wallet.');
      }

      // Step 3: Create account via factory
      toast.loading('Generating smart account...', { id: 'create-account' });
      const account = await createNewSmartAccount(eoaAccount, walletClient);

      console.log('✅ Smart account created:', account.address);

      // Step 4: AUTO-DEPLOY IMMEDIATELY 🚀
      toast.loading('Deploying smart account...', { id: 'create-account' });
      setStatus(ACCOUNT_STATUS.DEPLOYING);

      try {
        const receipt = await smartAccountFactory.deploySmartAccount(account);
        
        console.log('✅ Smart account deployed:', receipt.transactionHash);
        
        // Update account with deployment info
        account.deploymentState = 'deployed';
        account.deploymentTxHash = receipt.transactionHash;
        
        setStatus(ACCOUNT_STATUS.DEPLOYED);
        
      } catch (deployError) {
        console.error('❌ Deployment failed:', deployError);
        
        account.deploymentState = 'not_deployed';
        setStatus(ACCOUNT_STATUS.CONNECTED);
        
        toast.error('Account created but deployment failed. You can try again later.', { 
          id: 'create-account',
          duration: 5000 
        });
      }

      if (!mountedRef.current) return;

      // Reload accounts list
      await loadAccountsForEOA();

      // Set as active account
      setActiveAccount(account);

      if (account.deploymentState === 'deployed') {
        toast.success(`Smart account created & deployed: ${formatAddress(account.address)}`, { 
          id: 'create-account' 
        });
      } else {
        toast.success(`Smart account created: ${formatAddress(account.address)}`, { 
          id: 'create-account' 
        });
      }

      return account;

    } catch (err) {
      console.error('❌ Failed to create smart account:', err);
      setError(err.message || 'Failed to create smart account');
      setStatus(ACCOUNT_STATUS.ERROR);
      
      if (!err.message?.includes('rejected')) {
        toast.error(err.message || 'Failed to create smart account', { id: 'create-account' });
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [eoaAddress, walletClient, signMessage, loadAccountsForEOA]);

  /**
   * Deploy smart account manually
   */
  const deploySmartAccount = useCallback(async (firstTransaction = null) => {
    if (!activeAccount || !activeAccount.address) {
      throw new Error('No smart account selected or invalid account.');
    }
    try {
      setIsLoading(true);
      setError(null);
      setStatus(ACCOUNT_STATUS.DEPLOYING);
      toast.loading('Deploying smart account...', { id: 'deploy' });
  
      // Rehydrate full account instance if not already present
      let fullAccount = activeAccount;
      if (!activeAccount.account) {
        console.log('🧩 Rehydrating smart account instance before deployment...');
        const eoaAccount = walletClient?.account;
        if (!eoaAccount) throw new Error('Missing EOA signer for rehydration');
  
        const recreated = await smartAccountFactory.createSmartAccount(eoaAccount, walletClient, {
          deploySalt: activeAccount.deploySalt,
        });
  
        if (recreated.address.toLowerCase() !== activeAccount.address.toLowerCase()) {
          console.warn('⚠️ Rehydrated address mismatch:', recreated.address);
        }
        fullAccount = { ...activeAccount, ...recreated };
      }
  
      // Double-check deployment status
      const alreadyDeployed = await smartAccountFactory.checkAccountDeployment(fullAccount.address);
      if (alreadyDeployed) {
        toast.success('Smart account already deployed!', { id: 'deploy' });
        setStatus(ACCOUNT_STATUS.DEPLOYED);
        return { alreadyDeployed: true };
      }
      
      // Deploy using factory
      console.log('🚀 Deploying via SmartAccountFactory:', fullAccount.address);
      const txHash = await smartAccountFactory.deploySmartAccount(fullAccount, firstTransaction);
      console.log('✅ Deployment txHash:', txHash);
      
      // Update state
      setActiveAccount({
        ...fullAccount,
        deploymentState: 'deployed',
        deploymentTxHash: txHash,
      });
      setStatus(ACCOUNT_STATUS.DEPLOYED);
  
      await loadAccountsForEOA();
      await fetchBalances();
  
      toast.success('Smart account deployed successfully!', { id: 'deploy' });
      return txHash;
    } catch (err) {
      console.error('Failed to deploy smart account:', err);
      setError(err.message || 'Failed to deploy smart account');
      setStatus(ACCOUNT_STATUS.ERROR);
      toast.error(err.message || 'Failed to deploy smart account', { id: 'deploy' });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [activeAccount, walletClient, loadAccountsForEOA, fetchBalances]);

  /**
   * Switch active account
   */
  const switchAccount = useCallback(async (accountAddress) => {
    const storedAccount = smartAccounts.find(acc => acc.address === accountAddress);
    
    if (!storedAccount) {
      toast.error('Account not found');
      return;
    }
    
    try {
      setIsLoading(true);
      
      // ✅ CRITICAL: If account object is missing, recreate it
      let fullAccount = storedAccount;
      
      if (!storedAccount.account) {
        console.log('🔄 Rehydrating smart account instance for:', accountAddress);
        
        if (!walletClient?.account) {
          throw new Error('Wallet client not available');
        }
        
        // Recreate the smart account instance
        const recreated = await smartAccountFactory.createSmartAccount(
          walletClient.account,
          walletClient,
          {
            deploySalt: storedAccount.deploySalt
          }
        );
        // ✅ ADD CLIENT CREATION
        const smartAccountClient = bundlerClient.createSmartAccountClient(recreated.account, {
          sponsorUserOperation: true
        });
        
        fullAccount = {
          ...storedAccount,
          account: recreated.account,
          client: smartAccountClient, // ✅ ADD THIS
          ownerAccount: recreated.ownerAccount
        };

        
        // Verify address matches
        if (recreated.address.toLowerCase() !== accountAddress.toLowerCase()) {
          throw new Error('Address mismatch during rehydration');
        }
        
        fullAccount = {
          ...storedAccount,
          account: recreated.account,
          ownerAccount: recreated.ownerAccount
        };
        
        console.log('✅ Smart account rehydrated successfully');
      }
      
      setActiveAccount(fullAccount);
      
      // Check deployment status
      const isDeployed = await checkDeployment(fullAccount.address);
      setStatus(isDeployed ? ACCOUNT_STATUS.DEPLOYED : ACCOUNT_STATUS.CONNECTED);
      
      toast.success(`Switched to ${formatAddress(accountAddress)}`);
      
    } catch (err) {
      console.error('Failed to switch account:', err);
      toast.error('Failed to switch account');
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [smartAccounts, walletClient, checkDeployment]);

  /**
   * Disconnect
   */
  const disconnect = useCallback(() => {
    setActiveAccount(null);
    setStatus(ACCOUNT_STATUS.DISCONNECTED);
    setBalance({ 
      eoa: { raw: '0', formatted: '0', loading: false },
      smart: { raw: '0', formatted: '0', loading: false }
    });
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
      balance: balance.smart.formatted,
      eoaBalance: balance.eoa.formatted,
      smartAccountBalance: balance.smart.formatted,
      balanceWei: balance.smart.raw,
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
    smartAccounts,
    activeAccount,
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
    fetchBalances,
    getAccountInfo,
    estimateDeploymentGas,
    loadAccountsForEOA,

    // Derived state
    needsDeployment: activeAccount && activeAccount.deploymentState !== 'deployed',
    canDeploy: activeAccount && activeAccount.deploymentState !== 'deployed' && !isLoading,
    hasBalance: parseFloat(balance.smart.formatted) > 0,
    hasMultipleAccounts: smartAccounts.length > 1,

    // Constants
    ACCOUNT_STATUS
  };
}

export default useSmartAccount;