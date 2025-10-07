import {
  createDelegation,
  redeemDelegations,
} from '@metamask/delegation-toolkit';
import { encodeFunctionData, parseAbi, keccak256, } from 'viem';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { monadClient } from '../monad/monadClient.js';
import { gasEstimator } from '../monad/gasEstimator.js';
import { userOperationsService } from '../smartAccount/userOperations.js';
import { CONTRACTS, DELEGATION_CONFIG, MONAD_CONFIG } from '../../utils/constants.js';
import { validateDelegation, validateAddress } from '../../utils/validators.js';
import { secureStorage } from '../../utils/encryption.js';
import { formatDateTime, formatTokenAmount } from '../../utils/formatters.js';
import { encodeAbiParameters, parseAbiParameters } from 'viem';

/**
 * Delegation status tracking
 */
export const DELEGATION_STATUS = {
  CREATED: 'created',
  ACTIVE: 'active',
  REDEEMED: 'redeemed',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  FAILED: 'failed'
};

/**
 * Delegation types for DCA operations
 */
export const DCA_DELEGATION_TYPES = {
  SWAP_EXECUTION: 'swap_execution',
  TOKEN_APPROVAL: 'token_approval',
  BATCH_OPERATION: 'batch_operation',
  DCA_STRATEGY: 'dca_strategy'
};

/**
 * Caveat enforcer types for delegation restrictions
 * NOTE: Removed TOKEN_WHITELIST and GAS_LIMIT per decision.
 */
export const CAVEAT_TYPES = {
  SPENDING_LIMIT: 'spending_limit',
  TIME_RANGE: 'time_range',
  RECIPIENT_WHITELIST: 'recipient_whitelist',
  FUNCTION_WHITELIST: 'function_whitelist'
};

/**
 * Delegation service for MetaMask Delegation Framework on Monad
 * Manages creation, storage, and redemption of delegations for DCA operations
 */
class DelegationService {
  constructor() {
    this.activeDelegations = new Map();
    this.delegationHistory = [];
    this.caveatEnforcers = new Map();
    this.initialized = false;
  }

  /**
   * Initialize the delegation service
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await monadClient.initialize();
      await this.initializeCaveatEnforcers();
      this.initialized = true;
      console.log('Delegation service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize delegation service:', error);
      throw new Error(`Delegation initialization failed: ${error.message}`);
    }
  }

  /**
   * Initialize caveat enforcers for delegation restrictions
   *
   * This maps logical caveat types to the actual deployed enforcer contract addresses
   * defined in CONTRACTS. Throws if an expected enforcer address is missing.
   */
  async initializeCaveatEnforcers() {
    try {
      const ZERO = '0x0000000000000000000000000000000000000000';

      // Spending limit enforcer -> ERC20TransferAmountEnforcer
      if (!CONTRACTS.ERC20TransferAmountEnforcer || CONTRACTS.ERC20TransferAmountEnforcer === ZERO) {
        throw new Error('Missing ERC20TransferAmountEnforcer address in CONTRACTS');
      }
      this.caveatEnforcers.set(CAVEAT_TYPES.SPENDING_LIMIT, {
        address: CONTRACTS.ERC20TransferAmountEnforcer,
        encode: (terms) => this.encodeSpendingLimitCaveat(terms),
        validate: (terms) => this.validateSpendingLimit(terms)
      });

      // Time range enforcer -> TimestampEnforcer
      if (!CONTRACTS.TimestampEnforcer || CONTRACTS.TimestampEnforcer === ZERO) {
        throw new Error('Missing TimestampEnforcer address in CONTRACTS');
      }
      this.caveatEnforcers.set(CAVEAT_TYPES.TIME_RANGE, {
        address: CONTRACTS.TimestampEnforcer,
        encode: (terms) => this.encodeTimeRangeCaveat(terms),
        validate: (terms) => this.validateTimeRange(terms)
      });

      // Recipient (target) whitelist enforcer -> AllowedTargetsEnforcer
      if (!CONTRACTS.AllowedTargetsEnforcer || CONTRACTS.AllowedTargetsEnforcer === ZERO) {
        throw new Error('Missing AllowedTargetsEnforcer address in CONTRACTS');
      }
      this.caveatEnforcers.set(CAVEAT_TYPES.RECIPIENT_WHITELIST, {
        address: CONTRACTS.AllowedTargetsEnforcer,
        encode: (terms) => this.encodeTokenWhitelistCaveat(terms), // reuse address[] encoding
        validate: (terms) => this.validateTokenWhitelist(terms)
      });

      // Function whitelist enforcer -> AllowedMethodsEnforcer
      if (!CONTRACTS.AllowedMethodsEnforcer || CONTRACTS.AllowedMethodsEnforcer === ZERO) {
        throw new Error('Missing AllowedMethodsEnforcer address in CONTRACTS');
      }
      this.caveatEnforcers.set(CAVEAT_TYPES.FUNCTION_WHITELIST, {
        address: CONTRACTS.AllowedMethodsEnforcer,
        encode: (terms) => this.encodeFunctionWhitelistCaveat(terms),
        validate: (terms) => this.validateFunctionWhitelist(terms)
      });

      console.log('Caveat enforcers initialized');
    } catch (error) {
      console.error('Failed to initialize caveat enforcers:', error);
      throw error;
    }
  }

  /**
   * Create a root delegation for DCA operations
   */
  async createDelegation(params) {
    const {
      delegator,
      delegate,
      caveats = [],
      delegationType = DCA_DELEGATION_TYPES.DCA_STRATEGY,
      metadata = {}
    } = params;

    validateAddress(delegator, 'Delegator address');
    validateAddress(delegate, 'Delegate address');

    try {
      const delegationId = this.generateDelegationId();

      // Encode caveats with proper enforcers (returns ABI-encoded caveats)
      const encodedCaveats = await this.encodeCaveats(caveats);

      // Create delegation using MetaMask toolkit
      const delegation = createDelegation({
        delegator,
        delegate,
        authority: CONTRACTS.DelegationManager,
        caveats: encodedCaveats,
        // deterministic salt from delegationId
        salt: keccak256(utf8ToBytes(delegationId)),
        chainId: MONAD_CONFIG.chainId
      });

      // Store delegation data
      const delegationData = {
        id: delegationId,
        delegation, // the toolkit delegation object (with encoded caveats)
        delegator,
        delegate,
        type: delegationType,
        caveats, // raw, human-readable caveats (terms objects) — keep this for expiry and UI
        encodedCaveats, // ABI-encoded caveats used on-chain
        status: DELEGATION_STATUS.CREATED,
        createdAt: Date.now(),
        expiresAt: this.calculateExpiryTime(caveats),
        metadata,
        redemptions: []
      };

      // Validate delegation before storing
      validateDelegation(delegationData);

      // Store in secure memory
      await this.storeDelegation(delegationData);

      console.log(`Root delegation created: ${delegationId}`);
      return delegationData;
    } catch (error) {
      console.error('Failed to create root delegation:', error);
      throw new Error(`Root delegation creation failed: ${error.message}`);
    }
  }

  /**
   * Create a delegation for token swap operations
   */
  async createSwapDelegation(params) {
    const {
      delegator,
      delegate,
      tokenIn,
      tokenOut,
      maxAmountIn,
      maxSlippage,
      validUntil,
      metadata = {}
    } = params;

    try {
      // Create caveats for swap restrictions
      // NOTE: removed token-whitelist and gas-limit caveats (per decision).
      const exactInputSig = 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))';
      const approveSig = 'approve(address,uint256)';
      const exactInputSelector = '0x' + keccak256(utf8ToBytes(exactInputSig)).slice(2, 10);
      const approveSelector = '0x' + keccak256(utf8ToBytes(approveSig)).slice(2, 10);

      const caveats = [
        {
          type: CAVEAT_TYPES.SPENDING_LIMIT,
          terms: { token: tokenIn, maxAmount: maxAmountIn }
        },
        {
          type: CAVEAT_TYPES.TIME_RANGE,
          terms: { startTime: Date.now(), endTime: validUntil }
        },
        // restrict functions: swap + approve
        {
          type: CAVEAT_TYPES.FUNCTION_WHITELIST,
          terms: { functions: [exactInputSelector, approveSelector] }
        }
      ];

      const delegation = await this.createDelegation({
        delegator,
        delegate,
        caveats,
        delegationType: DCA_DELEGATION_TYPES.SWAP_EXECUTION,
        metadata: {
          ...metadata,
          tokenIn,
          tokenOut,
          maxAmountIn,
          maxSlippage,
          swapType: 'uniswap_v3'
        }
      });

      return delegation;
    } catch (error) {
      console.error('Failed to create swap delegation:', error);
      throw new Error(`Swap delegation creation failed: ${error.message}`);
    }
  }

  /**
   * Create a delegation for DCA strategy execution
   */
  async createDCAStrategyDelegation(params) {
    const {
      delegator,
      delegate,
      tokenIn,
      tokenOut,
      totalAmount,
      frequency,
      duration,
      maxSlippagePercent = 1,
      metadata = {}
    } = params;

    try {
      const validUntil = Date.now() + duration;
      const executionCount = Math.ceil(duration / this.getFrequencyInterval(frequency));
      const amountPerExecution = totalAmount / executionCount;

      const caveats = [
        {
          type: CAVEAT_TYPES.SPENDING_LIMIT,
          terms: {
            token: tokenIn,
            maxAmount: totalAmount,
            maxPerExecution: amountPerExecution
          }
        },
        {
          type: CAVEAT_TYPES.TIME_RANGE,
          terms: { startTime: Date.now(), endTime: validUntil }
        }
        // removed token whitelist + gas_limit caveats
      ];

      const delegation = await this.createDelegation({
        delegator,
        delegate,
        caveats,
        delegationType: DCA_DELEGATION_TYPES.DCA_STRATEGY,
        metadata: {
          ...metadata,
          tokenIn,
          tokenOut,
          totalAmount,
          amountPerExecution,
          frequency,
          duration,
          maxSlippagePercent,
          executionCount,
          executionsRemaining: executionCount,
          strategyType: 'dca'
        }
      });

      return delegation;
    } catch (error) {
      console.error('Failed to create DCA strategy delegation:', error);
      throw new Error(`DCA strategy delegation creation failed: ${error.message}`);
    }
  }

  /**
   * Redeem delegation to execute operations
   */
  async redeemDelegation(params) {
    const {
      delegationId,
      executions,
      mode = DELEGATION_CONFIG.modes.SINGLE_DEFAULT,
      gasOptions = {}
    } = params;

    try {
      const delegationData = await this.getDelegation(delegationId);
      if (!delegationData) {
        throw new Error(`Delegation not found: ${delegationId}`);
      }

      // Validate delegation status
      this.validateDelegationForRedemption(delegationData);

      // Prepare executions array
      const executionCalls = Array.isArray(executions) ? executions : [executions];

      // Estimate gas for redemption
      const gasEstimate = await gasEstimator.estimateOperationGas({
        account: delegationData.delegator,
        calls: executionCalls,
        operationType: 'delegation_redemption'
      });

      // Redeem delegation using toolkit
      const redemptionResult = await redeemDelegations({
        delegations: [delegationData.delegation],
        mode,
        executions: executionCalls,
        callGasLimit: gasEstimate.callGasLimit,
        verificationGasLimit: gasEstimate.verificationGasLimit,
        preVerificationGas: gasEstimate.preVerificationGas,
        maxFeePerGas: gasEstimate.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas
      });

      // Track redemption
      const redemptionRecord = {
        id: this.generateRedemptionId(),
        delegationId,
        executions: executionCalls,
        result: redemptionResult,
        timestamp: Date.now(),
        gasUsed: redemptionResult.gasUsed || gasEstimate.callGasLimit,
        status: redemptionResult.success ? 'success' : 'failed'
      };

      // Update executionsRemaining for DCA strategies
      if (delegationData.type === DCA_DELEGATION_TYPES.DCA_STRATEGY) {
        // ensure metadata.executionsRemaining exists
        delegationData.metadata.executionsRemaining = Math.max(
          0,
          (delegationData.metadata.executionsRemaining ?? delegationData.metadata.executionCount ?? 0) - executionCalls.length
        );
      }

      // Update delegation data
      delegationData.redemptions.push(redemptionRecord);
      delegationData.status = this.calculateDelegationStatus(delegationData);

      await this.updateDelegation(delegationData);

      console.log(`Delegation redeemed: ${delegationId}, redemption: ${redemptionRecord.id}`);

      return {
        delegationId,
        redemptionId: redemptionRecord.id,
        result: redemptionResult,
        gasUsed: redemptionRecord.gasUsed
      };
    } catch (error) {
      console.error(`Failed to redeem delegation ${delegationId}:`, error);
      throw new Error(`Delegation redemption failed: ${error.message}`);
    }
  }

  /**
   * Execute a DCA swap using delegation
   */
  async executeDCASwap(params) {
    const {
      delegationId,
      swapParams,
      gasOptions = {}
    } = params;

    try {
      // Encode Uniswap swap call
      const swapCalldata = encodeFunctionData({
        abi: parseAbi([
          'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
        ]),
        functionName: 'exactInputSingle',
        args: [swapParams]
      });

      const execution = {
        to: CONTRACTS.SwapRouter02,
        data: swapCalldata,
        value: 0n
      };

      const result = await this.redeemDelegation({
        delegationId,
        executions: [execution],
        mode: DELEGATION_CONFIG.modes.SINGLE_DEFAULT,
        gasOptions
      });

      return result;
    } catch (error) {
      console.error(`Failed to execute DCA swap for delegation ${delegationId}:`, error);
      throw error;
    }
  }

  /**
   * Get delegation by ID
   */
  async getDelegation(delegationId) {
    try {
      // Try active delegations first
      if (this.activeDelegations.has(delegationId)) {
        return this.activeDelegations.get(delegationId);
      }

      // Try secure storage
      const stored = await secureStorage.retrieve(`delegation_${delegationId}`, 'DELEGATION_DATA');
      return stored;
    } catch (error) {
      console.error(`Failed to get delegation ${delegationId}:`, error);
      return null;
    }
  }

  /**
   * List all delegations for a delegator
   */
  async getDelegationsForDelegator(delegatorAddress) {
    const delegations = [];

    // Active delegations
    for (const delegation of this.activeDelegations.values()) {
      if (delegation.delegator.toLowerCase() === delegatorAddress.toLowerCase()) {
        delegations.push(delegation);
      }
    }

    // Add historical delegations
    delegations.push(...this.delegationHistory.filter(
      d => d.delegator.toLowerCase() === delegatorAddress.toLowerCase()
    ));

    return delegations.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Revoke a delegation
   */
  async revokeDelegation(delegationId, reason = 'user_request') {
    try {
      const delegationData = await this.getDelegation(delegationId);
      if (!delegationData) {
        throw new Error(`Delegation not found: ${delegationId}`);
      }

      // Update status
      delegationData.status = DELEGATION_STATUS.REVOKED;
      delegationData.revokedAt = Date.now();
      delegationData.revokeReason = reason;

      await this.updateDelegation(delegationData);

      console.log(`Delegation revoked: ${delegationId}, reason: ${reason}`);
      return true;
    } catch (error) {
      console.error(`Failed to revoke delegation ${delegationId}:`, error);
      throw error;
    }
  }

  /**
   * Get delegation statistics
   */
  getDelegationStats(delegatorAddress = null) {
    const allDelegations = delegatorAddress
      ? Array.from(this.activeDelegations.values()).filter(
        d => d.delegator.toLowerCase() === delegatorAddress.toLowerCase()
      )
      : Array.from(this.activeDelegations.values());

    const stats = {
      total: allDelegations.length,
      active: 0,
      expired: 0,
      redeemed: 0,
      revoked: 0,
      totalRedemptions: 0,
      totalGasSpent: 0n
    };

    allDelegations.forEach(delegation => {
      switch (delegation.status) {
        case DELEGATION_STATUS.ACTIVE:
          stats.active++;
          break;
        case DELEGATION_STATUS.EXPIRED:
          stats.expired++;
          break;
        case DELEGATION_STATUS.REDEEMED:
          stats.redeemed++;
          break;
        case DELEGATION_STATUS.REVOKED:
          stats.revoked++;
          break;
      }

      stats.totalRedemptions += delegation.redemptions.length;
      stats.totalGasSpent += delegation.redemptions.reduce(
        (sum, redemption) => sum + BigInt(redemption.gasUsed || 0),
        0n
      );
    });

    return stats;
  }

  // Private helper methods

  async storeDelegation(delegationData) {
    // Store in active delegations
    this.activeDelegations.set(delegationData.id, delegationData);

    // Store in secure memory
    await secureStorage.store(
      `delegation_${delegationData.id}`,
      delegationData,
      'DELEGATION_DATA'
    );
  }

  async updateDelegation(delegationData) {
    this.activeDelegations.set(delegationData.id, delegationData);
    await secureStorage.store(
      `delegation_${delegationData.id}`,
      delegationData,
      'DELEGATION_DATA'
    );

    // Move to history if completed
    if ([DELEGATION_STATUS.REDEEMED, DELEGATION_STATUS.EXPIRED, DELEGATION_STATUS.REVOKED].includes(delegationData.status)) {
      this.delegationHistory.push(delegationData);
      this.activeDelegations.delete(delegationData.id);
    }
  }

  async encodeCaveats(caveats) {
    const encodedCaveats = [];

    for (const caveat of caveats) {
      const enforcer = this.caveatEnforcers.get(caveat.type);
      if (!enforcer) {
        throw new Error(`Unknown caveat type: ${caveat.type}`);
      }

      // Validate caveat terms
      enforcer.validate(caveat.terms);

      // Encode caveat (encoder accepts the full terms object)
      const encodedTerms = enforcer.encode(caveat.terms);

      encodedCaveats.push({
        enforcer: enforcer.address,
        terms: encodedTerms
      });
    }

    return encodedCaveats;
  }

  generateDelegationId() {
    return `del_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateRedemptionId() {
    return `red_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // NOTE: kept for reference but no longer used for production fallbacks
  generateEnforcerAddress(type) {
    const hash = keccak256(utf8ToBytes(`enforcer_${type}_${MONAD_CONFIG.chainId}`));
    return `0x${hash.slice(2, 42)}`;
  }

  calculateExpiryTime(caveats) {
    const timeRangeCaveat = caveats.find(c => c.type === CAVEAT_TYPES.TIME_RANGE);
    return timeRangeCaveat ? timeRangeCaveat.terms.endTime : null;
  }

  calculateDelegationStatus(delegationData) {
    const now = Date.now();

    // Check if expired
    if (delegationData.expiresAt && now > delegationData.expiresAt) {
      return DELEGATION_STATUS.EXPIRED;
    }

    // Check if fully redeemed (for DCA strategies)
    if (delegationData.type === DCA_DELEGATION_TYPES.DCA_STRATEGY) {
      const remainingExecutions = Math.max(
        0,
        delegationData.metadata.executionsRemaining || 0
      );
      if (remainingExecutions <= 0) {
        return DELEGATION_STATUS.REDEEMED;
      }
    }

    return DELEGATION_STATUS.ACTIVE;
  }

  validateDelegationForRedemption(delegationData) {
    const now = Date.now();

    if (delegationData.status === DELEGATION_STATUS.REVOKED) {
      throw new Error('Delegation has been revoked');
    }

    if (delegationData.status === DELEGATION_STATUS.EXPIRED) {
      throw new Error('Delegation has expired');
    }

    if (delegationData.expiresAt && now > delegationData.expiresAt) {
      throw new Error('Delegation has expired');
    }

    if (delegationData.status === DELEGATION_STATUS.REDEEMED) {
      throw new Error('Delegation has been fully redeemed');
    }
  }

  getFrequencyInterval(frequency) {
    const intervals = {
      'hourly': 60 * 60 * 1000,
      'daily': 24 * 60 * 60 * 1000,
      'weekly': 7 * 24 * 60 * 60 * 1000
    };
    return intervals[frequency] || intervals.daily;
  }

  // Caveat encoding methods — accept the terms object
  encodeSpendingLimitCaveat(terms) {
    // terms: { token: address, maxAmount: number|string|bigint }
    return encodeAbiParameters(parseAbiParameters('address,uint256'), [terms.token, BigInt(terms.maxAmount)]);
  }

  encodeTimeRangeCaveat(terms) {
    // terms: { startTime: number, endTime: number }
    return encodeAbiParameters(parseAbiParameters('uint256,uint256'), [BigInt(terms.startTime), BigInt(terms.endTime)]);
  }

  encodeTokenWhitelistCaveat(terms) {
    // reused for recipient whitelist (address[])
    return encodeAbiParameters(parseAbiParameters('address[]'), [terms.tokens || terms.addresses]);
  }

  encodeFunctionWhitelistCaveat(terms) {
    // terms.functions: array of bytes4 selectors (0x...)
    return encodeAbiParameters(parseAbiParameters('bytes4[]'), [terms.functions]);
  }

  // Caveat validation methods
  validateSpendingLimit(terms) {
    if (!terms.maxAmount || BigInt(terms.maxAmount) <= 0n) {
      throw new Error('Invalid spending limit amount');
    }
    if (!terms.token) {
      throw new Error('Spending limit must include token address');
    }
  }

  validateTimeRange(terms) {
    const { startTime, endTime } = terms;
    if (!startTime || !endTime || endTime <= startTime) {
      throw new Error('Invalid time range');
    }
  }

  validateTokenWhitelist(terms) {
    if (!Array.isArray(terms.tokens) && !Array.isArray(terms.addresses)) {
      throw new Error('Invalid recipient whitelist');
    }
  }

  validateFunctionWhitelist(terms) {
    if (!Array.isArray(terms.functions) || terms.functions.length === 0) {
      throw new Error('Invalid function whitelist');
    }
  }

  /**
   * Health check for the service
   */
  async healthCheck() {
    try {
      const checks = {
        initialized: this.initialized,
        activeDelegations: this.activeDelegations.size,
        historySize: this.delegationHistory.length,
        caveatEnforcers: this.caveatEnforcers.size,
        monadClient: await monadClient.healthCheck()
      };

      const isHealthy = checks.initialized && checks.caveatEnforcers > 0;
      return { isHealthy, checks };
    } catch (error) {
      console.error('Delegation service health check failed:', error);
      return { isHealthy: false, error: error.message };
    }
  }
}

// Create and export singleton instance
export const delegationService = new DelegationService();

// Export helper functions
export const createSwapDelegation = (params) => delegationService.createSwapDelegation(params);
export const createDCAStrategyDelegation = (params) => delegationService.createDCAStrategyDelegation(params);
export const redeemDelegation = (params) => delegationService.redeemDelegation(params);
export const executeDCASwap = (params) => delegationService.executeDCASwap(params);
export const getDelegationsForDelegator = (address) => delegationService.getDelegationsForDelegator(address);
