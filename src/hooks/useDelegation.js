import { useState, useEffect, useCallback, useRef } from 'react';
import { formatUnits, parseUnits } from 'viem';

// Services
import { delegationService } from '../services/delegations/delegationService';
import { delegationStorage } from '../services/delegations/delegationStorage';
import { monadClient } from '../services/monad/monadClient';
import { gasEstimator } from '../services/monad/gasEstimator';

// Utils
import { validateDelegation, validateAddress } from '../utils/validators';
import { formatAddress, formatDateTime, formatDuration } from '../utils/formatters';
import { 
  DELEGATION_CONFIG, 
  CONTRACTS, 
  ERROR_CODES,
  MONAD_CONFIG 
} from '../utils/constants';

// Toast notifications
import toast from 'react-hot-toast';

/**
 * DELEGATION STATUS CONSTANTS
 */
const DELEGATION_STATUS = {
  CREATED: 'created',
  ACTIVE: 'active',
  REDEEMED: 'redeemed',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  FAILED: 'failed'
};

/**
 * DELEGATION TYPES
 */
const DELEGATION_TYPES = {
  SWAP_EXECUTION: 'swap_execution',
  TOKEN_APPROVAL: 'token_approval',
  BATCH_OPERATION: 'batch_operation',
  DCA_STRATEGY: 'dca_strategy'
};

/**
 * useDelegation Hook
 * 
 * Manages delegation lifecycle for MetaMask Smart Accounts on Monad.
 * Handles creation, redemption, revocation, and monitoring of delegations.
 * 
 * Features:
 * - Create root delegations with caveats (spending limits, time ranges, etc.)
 * - Create specialized delegations (swap, DCA strategy)
 * - Redeem delegations to execute permitted actions
 * - Monitor delegation status and expiry
 * - Track redemption history
 * - Manage active delegations for delegator/delegate
 * - Gas estimation for delegation operations
 * 
 * @param {Object} smartAccount - Smart account from useSmartAccount hook
 * @returns {Object} Delegation state and methods
 */
export function useDelegation(smartAccount = null) {
  // Delegation state
  const [delegations, setDelegations] = useState([]);
  const [activeDelegations, setActiveDelegations] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    redeemed: 0,
    expired: 0,
    revoked: 0
  });

  // Refs for cleanup
  const mountedRef = useRef(true);
  const refreshIntervalRef = useRef(null);

  /**
   * Initialize delegation service and load delegations
   */
  useEffect(() => {
    const init = async () => {
      try {
        // Initialize delegation service
        await delegationService.initialize();
        
        // Load delegations if smart account exists
        if (smartAccount?.address) {
          await loadDelegations();
        }
      } catch (err) {
        console.error('Failed to initialize delegation service:', err);
      }
    };

    init();

    // Start refresh interval (every 30 seconds)
    refreshIntervalRef.current = setInterval(() => {
      if (smartAccount?.address) {
        loadDelegations();
      }
    }, 30000);

    return () => {
      mountedRef.current = false;
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [smartAccount?.address]);

  /**
   * Load delegations for current smart account
   */
  const loadDelegations = useCallback(async () => {
    if (!smartAccount?.address) return;

    try {
      // Get all delegations where account is delegator
      const allDelegations = await delegationService.getDelegationsForDelegator(
        smartAccount.address
      );

      if (!mountedRef.current) return;

      setDelegations(allDelegations);

      // Filter active delegations
      const active = allDelegations.filter(
        d => d.status === DELEGATION_STATUS.ACTIVE
      );
      setActiveDelegations(active);

      // Update stats
      updateStats(allDelegations);

    } catch (err) {
      console.error('Failed to load delegations:', err);
      setError(err.message);
    }
  }, [smartAccount?.address]);

  /**
   * Update delegation statistics
   */
  const updateStats = useCallback((delegationList) => {
    const newStats = {
      total: delegationList.length,
      active: delegationList.filter(d => d.status === DELEGATION_STATUS.ACTIVE).length,
      redeemed: delegationList.filter(d => d.status === DELEGATION_STATUS.REDEEMED).length,
      expired: delegationList.filter(d => d.status === DELEGATION_STATUS.EXPIRED).length,
      revoked: delegationList.filter(d => d.status === DELEGATION_STATUS.REVOKED).length
    };

    setStats(newStats);
  }, []);

  /**
   * Create a root delegation
   * 
   * @param {Object} params - Delegation parameters
   * @param {string} params.delegate - Delegate address
   * @param {Array} params.caveats - Array of caveat objects
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<Object>} Created delegation
   */
  const createRootDelegation = useCallback(async (params) => {
    if (!smartAccount) {
      throw new Error('Smart account required');
    }

    try {
      setIsLoading(true);
      setError(null);

      const { delegate, caveats = [], metadata = {} } = params;

      // Validate delegate address
      if (!validateAddress(delegate)) {
        throw new Error('Invalid delegate address');
      }

      // Validate caveats
      for (const caveat of caveats) {
        if (!caveat.enforcer || !validateAddress(caveat.enforcer)) {
          throw new Error('Invalid caveat enforcer address');
        }
        if (!caveat.terms) {
          throw new Error('Caveat terms required');
        }
      }

      toast.loading('Creating delegation...', { id: 'create-delegation' });

      // Create delegation through service
      const delegation = await delegationService.createRootDelegation({
        delegator: smartAccount.address,
        delegate,
        caveats,
        metadata: {
          ...metadata,
          createdVia: 'useDelegation',
          timestamp: Date.now()
        }
      });

      if (!mountedRef.current) return;

      // Reload delegations
      await loadDelegations();

      toast.success('Delegation created successfully', { id: 'create-delegation' });

      return delegation;

    } catch (err) {
      console.error('Failed to create delegation:', err);
      setError(err.message);
      toast.error(err.message || 'Failed to create delegation', { id: 'create-delegation' });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [smartAccount, loadDelegations]);

  /**
   * Create a swap delegation (Uniswap V3)
   * 
   * @param {Object} params - Swap delegation parameters
   * @param {string} params.delegate - Delegate address
   * @param {string} params.tokenIn - Input token address
   * @param {string} params.tokenOut - Output token address
   * @param {string} params.amountIn - Max input amount
   * @param {number} params.slippage - Slippage tolerance (0-1)
   * @param {number} params.duration - Delegation duration in seconds
   * @returns {Promise<Object>} Created delegation
   */
  const createSwapDelegation = useCallback(async (params) => {
    if (!smartAccount) {
      throw new Error('Smart account required');
    }

    try {
      setIsLoading(true);
      setError(null);

      const {
        delegate,
        tokenIn,
        tokenOut,
        amountIn,
        slippage = DELEGATION_CONFIG.defaultSlippage || 0.005,
        duration = DELEGATION_CONFIG.defaultDelegationDuration
      } = params;

      // Validate addresses
      if (!validateAddress(delegate)) {
        throw new Error('Invalid delegate address');
      }
      if (!validateAddress(tokenIn)) {
        throw new Error('Invalid tokenIn address');
      }
      if (!validateAddress(tokenOut)) {
        throw new Error('Invalid tokenOut address');
      }

      // Validate amount
      if (!amountIn || parseFloat(amountIn) <= 0) {
        throw new Error('Invalid amount');
      }

      toast.loading('Creating swap delegation...', { id: 'create-swap' });

      // Create swap delegation through service
      const delegation = await delegationService.createSwapDelegation({
        delegator: smartAccount.address,
        delegate,
        tokenIn,
        tokenOut,
        amountIn,
        slippage,
        duration
      });

      if (!mountedRef.current) return;

      // Reload delegations
      await loadDelegations();

      toast.success('Swap delegation created', { id: 'create-swap' });

      return delegation;

    } catch (err) {
      console.error('Failed to create swap delegation:', err);
      setError(err.message);
      toast.error(err.message || 'Failed to create swap delegation', { id: 'create-swap' });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [smartAccount, loadDelegations]);

  /**
   * Create a DCA strategy delegation
   * 
   * @param {Object} params - DCA delegation parameters
   * @param {string} params.delegate - Delegate address (agent)
   * @param {string} params.tokenIn - Input token address
   * @param {string} params.tokenOut - Output token address
   * @param {string} params.totalAmount - Total budget
   * @param {string} params.amountPerExecution - Amount per swap
   * @param {string} params.frequency - DCA frequency (hourly, daily, weekly, monthly)
   * @param {number} params.executionCount - Total number of executions
   * @param {number} params.duration - Strategy duration in seconds
   * @returns {Promise<Object>} Created delegation
   */
  const createDCAStrategyDelegation = useCallback(async (params) => {
    if (!smartAccount) {
      throw new Error('Smart account required');
    }

    try {
      setIsLoading(true);
      setError(null);

      const {
        delegate,
        tokenIn,
        tokenOut,
        totalAmount,
        amountPerExecution,
        frequency,
        executionCount,
        duration
      } = params;

      // Validate addresses
      if (!validateAddress(delegate)) {
        throw new Error('Invalid delegate address');
      }
      if (!validateAddress(tokenIn)) {
        throw new Error('Invalid tokenIn address');
      }
      if (!validateAddress(tokenOut)) {
        throw new Error('Invalid tokenOut address');
      }

      // Validate amounts
      if (!totalAmount || parseFloat(totalAmount) <= 0) {
        throw new Error('Invalid total amount');
      }
      if (!amountPerExecution || parseFloat(amountPerExecution) <= 0) {
        throw new Error('Invalid amount per execution');
      }

      // Validate execution count
      if (!executionCount || executionCount <= 0) {
        throw new Error('Invalid execution count');
      }

      toast.loading('Creating DCA delegation...', { id: 'create-dca' });

      // Create DCA delegation through service
      const delegation = await delegationService.createDCAStrategyDelegation({
        delegator: smartAccount.address,
        delegate,
        tokenIn,
        tokenOut,
        totalAmount,
        amountPerExecution,
        frequency,
        executionCount,
        duration
      });

      if (!mountedRef.current) return;

      // Reload delegations
      await loadDelegations();

      toast.success('DCA delegation created', { id: 'create-dca' });

      return delegation;

    } catch (err) {
      console.error('Failed to create DCA delegation:', err);
      setError(err.message);
      toast.error(err.message || 'Failed to create DCA delegation', { id: 'create-dca' });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [smartAccount, loadDelegations]);

  /**
   * Redeem a delegation
   * 
   * @param {string} delegationId - Delegation ID
   * @param {Array} executions - Array of execution calls
   * @returns {Promise<Object>} Redemption result
   */
  const redeemDelegation = useCallback(async (delegationId, executions) => {
    if (!smartAccount) {
      throw new Error('Smart account required');
    }

    try {
      setIsLoading(true);
      setError(null);

      if (!delegationId) {
        throw new Error('Delegation ID required');
      }

      if (!executions || !Array.isArray(executions) || executions.length === 0) {
        throw new Error('Executions array required');
      }

      toast.loading('Redeeming delegation...', { id: 'redeem' });

      // Redeem through service
      const result = await delegationService.redeemDelegation(
        delegationId,
        executions
      );

      if (!mountedRef.current) return;

      // Add to redemptions list
      setRedemptions(prev => [result, ...prev.slice(0, 99)]);

      // Reload delegations to update status
      await loadDelegations();

      toast.success('Delegation redeemed successfully', { id: 'redeem' });

      return result;

    } catch (err) {
      console.error('Failed to redeem delegation:', err);
      setError(err.message);
      toast.error(err.message || 'Failed to redeem delegation', { id: 'redeem' });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [smartAccount, loadDelegations]);

  /**
   * Execute a DCA swap using delegation
   * 
   * @param {string} delegationId - Delegation ID
   * @param {Object} swapParams - Swap parameters
   * @returns {Promise<Object>} Execution result
   */
  const executeDCASwap = useCallback(async (delegationId, swapParams) => {
    if (!smartAccount) {
      throw new Error('Smart account required');
    }

    try {
      setIsLoading(true);
      setError(null);

      toast.loading('Executing DCA swap...', { id: 'dca-swap' });

      // Execute through service
      const result = await delegationService.executeDCASwap(
        delegationId,
        swapParams
      );

      if (!mountedRef.current) return;

      // Add to redemptions
      setRedemptions(prev => [result, ...prev.slice(0, 99)]);

      // Reload delegations
      await loadDelegations();

      toast.success('DCA swap executed', { id: 'dca-swap' });

      return result;

    } catch (err) {
      console.error('Failed to execute DCA swap:', err);
      setError(err.message);
      toast.error(err.message || 'Failed to execute DCA swap', { id: 'dca-swap' });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [smartAccount, loadDelegations]);

  /**
   * Revoke a delegation
   * 
   * @param {string} delegationId - Delegation ID
   * @param {string} reason - Revocation reason
   * @returns {Promise<void>}
   */
  const revokeDelegation = useCallback(async (delegationId, reason = 'User revoked') => {
    try {
      setIsLoading(true);
      setError(null);

      if (!delegationId) {
        throw new Error('Delegation ID required');
      }

      toast.loading('Revoking delegation...', { id: 'revoke' });

      // Revoke through service
      await delegationService.revokeDelegation(delegationId, reason);

      if (!mountedRef.current) return;

      // Reload delegations
      await loadDelegations();

      toast.success('Delegation revoked', { id: 'revoke' });

    } catch (err) {
      console.error('Failed to revoke delegation:', err);
      setError(err.message);
      toast.error(err.message || 'Failed to revoke delegation', { id: 'revoke' });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loadDelegations]);

  /**
   * Get delegation by ID
   * 
   * @param {string} delegationId - Delegation ID
   * @returns {Object|null} Delegation object
   */
  const getDelegation = useCallback((delegationId) => {
    return delegations.find(d => d.id === delegationId) || null;
  }, [delegations]);

  /**
   * Get delegations by status
   * 
   * @param {string} status - Delegation status
   * @returns {Array} Filtered delegations
   */
  const getDelegationsByStatus = useCallback((status) => {
    return delegations.filter(d => d.status === status);
  }, [delegations]);

  /**
   * Get delegations by type
   * 
   * @param {string} type - Delegation type
   * @returns {Array} Filtered delegations
   */
  const getDelegationsByType = useCallback((type) => {
    return delegations.filter(d => d.metadata?.type === type);
  }, [delegations]);

  /**
   * Check if delegation is expired
   * 
   * @param {Object} delegation - Delegation object
   * @returns {boolean} True if expired
   */
  const isDelegationExpired = useCallback((delegation) => {
    if (!delegation || !delegation.metadata?.expiryTime) return false;
    return Date.now() > delegation.metadata.expiryTime * 1000;
  }, []);

  /**
   * Get time until delegation expires
   * 
   * @param {Object} delegation - Delegation object
   * @returns {number|null} Seconds until expiry (null if no expiry)
   */
  const getTimeUntilExpiry = useCallback((delegation) => {
    if (!delegation || !delegation.metadata?.expiryTime) return null;
    const expiryMs = delegation.metadata.expiryTime * 1000;
    const nowMs = Date.now();
    return Math.max(0, Math.floor((expiryMs - nowMs) / 1000));
  }, []);

  /**
   * Estimate gas for delegation creation
   * 
   * @param {string} type - Delegation type
   * @returns {Promise<Object>} Gas estimate
   */
  const estimateCreationGas = useCallback(async (type = 'root') => {
    try {
      const estimate = await gasEstimator.estimateOperationGas('createDelegation');
      return estimate;
    } catch (err) {
      console.error('Failed to estimate delegation creation gas:', err);
      throw err;
    }
  }, []);

  /**
   * Estimate gas for delegation redemption
   * 
   * @param {Array} executions - Execution calls
   * @returns {Promise<Object>} Gas estimate
   */
  const estimateRedemptionGas = useCallback(async (executions = []) => {
    try {
      const baseGas = await gasEstimator.estimateOperationGas('redeemDelegation');
      
      // Add gas for each execution
      const executionGas = executions.length * 50000;
      
      return {
        ...baseGas,
        gasLimit: baseGas.gasLimit + executionGas,
        totalCost: (baseGas.gasLimit + executionGas) * MONAD_CONFIG.baseFee
      };
    } catch (err) {
      console.error('Failed to estimate redemption gas:', err);
      throw err;
    }
  }, []);

  /**
   * Format delegation for display
   * 
   * @param {Object} delegation - Delegation object
   * @returns {Object} Formatted delegation
   */
  const formatDelegationForDisplay = useCallback((delegation) => {
    if (!delegation) return null;

    return {
      id: delegation.id,
      delegate: formatAddress(delegation.delegate),
      delegateRaw: delegation.delegate,
      status: delegation.status,
      type: delegation.metadata?.type || 'unknown',
      createdAt: formatDateTime(delegation.metadata?.createdAt),
      expiresAt: delegation.metadata?.expiryTime 
        ? formatDateTime(delegation.metadata.expiryTime * 1000)
        : 'Never',
      timeRemaining: getTimeUntilExpiry(delegation),
      timeRemainingFormatted: delegation.metadata?.expiryTime
        ? formatDuration(getTimeUntilExpiry(delegation))
        : 'Unlimited',
      isExpired: isDelegationExpired(delegation),
      executionsRemaining: delegation.metadata?.executionsRemaining || 0,
      caveatsCount: delegation.caveats?.length || 0,
      caveats: delegation.caveats || []
    };
  }, [getTimeUntilExpiry, isDelegationExpired]);

  return {
    // State
    delegations,
    activeDelegations,
    redemptions,
    isLoading,
    error,
    stats,

    // Methods - Creation
    createRootDelegation,
    createSwapDelegation,
    createDCAStrategyDelegation,

    // Methods - Redemption
    redeemDelegation,
    executeDCASwap,

    // Methods - Management
    revokeDelegation,
    loadDelegations,

    // Methods - Queries
    getDelegation,
    getDelegationsByStatus,
    getDelegationsByType,
    isDelegationExpired,
    getTimeUntilExpiry,

    // Methods - Gas
    estimateCreationGas,
    estimateRedemptionGas,

    // Methods - Display
    formatDelegationForDisplay,

    // Derived state
    hasDelegations: delegations.length > 0,
    hasActiveDelegations: activeDelegations.length > 0,
    canCreateDelegation: !!smartAccount?.address && !isLoading,

    // Constants
    DELEGATION_STATUS,
    DELEGATION_TYPES
  };
}

export default useDelegation;