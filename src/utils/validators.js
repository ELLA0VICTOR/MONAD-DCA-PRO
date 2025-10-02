import { isAddress, parseUnits } from 'viem';
import { formatGwei } from 'viem';
import { 
  MONAD_CONFIG, 
  SUPPORTED_TOKENS, 
  DCA_CONFIG, 
  DELEGATION_CONFIG,
  GAS_LIMITS,
  UTILS 
} from './constants.js';

// ===== BLOCKCHAIN VALIDATORS =====

/**
 * Validate Ethereum address format and checksum
 * @param {string} address - Address to validate
 * @returns {object} Validation result with error message
 */
export const validateAddress = (address) => {
  if (!address) {
    return { isValid: false, error: "Address is required" };
  }
  
  if (typeof address !== 'string') {
    return { isValid: false, error: "Address must be a string" };
  }
  
  // Check basic format
  if (!isAddress(address)) {
    return { isValid: false, error: "Invalid address" };
  }
  
  // Use viem's checksum validation
  if (!isAddress(address)) {
    return { isValid: false, error: "Invalid address checksum" };
  }
  
  // Check for zero address
  if (address.toLowerCase() === UTILS.ZERO_ADDRESS.toLowerCase()) {
    return { isValid: false, error: "Cannot use zero address" };
  }
  
  return { isValid: true, error: null };
};

/**
 * Validate transaction hash format
 * @param {string} hash - Transaction hash
 * @returns {object} Validation result
 */
export const validateTxHash = (hash) => {
  if (!hash) {
    return { isValid: false, error: "Transaction hash is required" };
  }
  
  if (typeof hash !== 'string') {
    return { isValid: false, error: "Hash must be a string" };
  }
  
  if (!hash.match(/^0x[a-fA-F0-9]{64}$/)) {
    return { isValid: false, error: "Invalid transaction hash format" };
  }
  
  return { isValid: true, error: null };
};

/**
 * Validate private key format
 * @param {string} privateKey - Private key to validate
 * @returns {object} Validation result
 */
export const validatePrivateKey = (privateKey) => {
  if (!privateKey) {
    return { isValid: false, error: "Private key is required" };
  }
  
  if (typeof privateKey !== 'string') {
    return { isValid: false, error: "Private key must be a string" };
  }
  
  // Remove 0x prefix if present
  const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  
  if (!cleanKey.match(/^[a-fA-F0-9]{64}$/)) {
    return { isValid: false, error: "Invalid private key format" };
  }
  
  // Check for common weak keys
  const weakKeys = ['0'.repeat(64), 'f'.repeat(64), '1'.repeat(64)];
  if (weakKeys.includes(cleanKey.toLowerCase())) {
    return { isValid: false, error: "Weak private key detected" };
  }
  
  return { isValid: true, error: null };
};

// ===== TOKEN AMOUNT VALIDATORS =====

/**
 * Validate token amount input
 * @param {string|number} amount - Amount to validate
 * @param {object} token - Token configuration
 * @param {bigint} balance - User's token balance (optional)
 * @returns {object} Validation result
 */
export const validateTokenAmount = (amount, token, balance = null) => {
  if (!amount || amount === "" || amount === "0") {
    return { isValid: false, error: "Amount is required" };
  }
  
  // Convert to string and clean
  const cleanAmount = amount.toString().replace(/,/g, "");
  
  // Check for valid number format
  if (!cleanAmount.match(/^\d+(\.\d+)?$/)) {
    return { isValid: false, error: "Invalid amount format" };
  }
  
  const numAmount = parseFloat(cleanAmount);
  
  // Check for reasonable limits
  if (numAmount <= 0) {
    return { isValid: false, error: "Amount must be greater than zero" };
  }
  
  if (numAmount > 1e15) {
    return { isValid: false, error: "Amount too large" };
  }
  
  // Check decimal precision
  const decimals = cleanAmount.split('.')[1];
  if (decimals && decimals.length > token.decimals) {
    return { isValid: false, error: `Maximum ${token.decimals} decimal places allowed` };
  }
  
  // Check minimum amount for token
  const minAmount = token.minAmount || 0.001; // fallback for safety
  if (numAmount < minAmount) {
    return { isValid: false, error: `Minimum amount is ${minAmount} ${token.symbol}` };
  }
  
  // Check against balance if provided
  if (balance !== null) {
    try {
      const amountWei = parseUnits(cleanAmount, token.decimals);
      if (amountWei > balance) {
        return { isValid: false, error: "Insufficient balance" };
      }
    } catch (error) {
      return { isValid: false, error: "Error parsing amount" };
    }
  }
  
  return { isValid: true, error: null, amount: numAmount };
};

/**
 * Validate slippage percentage
 * @param {string|number} slippage - Slippage as percentage (0.5 = 0.5%)
 * @returns {object} Validation result
 */
export const validateSlippage = (slippage) => {
  if (!slippage && slippage !== 0) {
    return { isValid: false, error: "Slippage is required" };
  }
  
  const numSlippage = parseFloat(slippage);
  
  if (isNaN(numSlippage)) {
    return { isValid: false, error: "Invalid slippage format" };
  }
  
  if (numSlippage < 0) {
    return { isValid: false, error: "Slippage cannot be negative" };
  }
  
  if (numSlippage > 50) {
    return { isValid: false, error: "Slippage cannot exceed 50%" };
  }
  
  // Convert percentage to decimal for comparison
  const slippageDecimal = numSlippage / 100;
  
  if (slippageDecimal < DCA_CONFIG.minSlippage) {
    return { isValid: false, error: `Minimum slippage is ${DCA_CONFIG.minSlippage * 100}%` };
  }
  
  if (slippageDecimal > DCA_CONFIG.maxSlippage) {
    return { isValid: false, error: `Maximum slippage is ${DCA_CONFIG.maxSlippage * 100}%` };
  }
  
  // Warn about high slippage
  const warningThreshold = 0.02; // 2%
  const warning = slippageDecimal > warningThreshold ? "High slippage may result in significant losses" : null;
  
  return { isValid: true, error: null, warning, slippage: slippageDecimal };
};

// ===== DCA STRATEGY VALIDATORS =====

/**
 * Validate DCA strategy configuration
 * @param {object} strategy - Strategy configuration
 * @returns {object} Validation result with detailed errors
 */
export const validateDCAStrategy = (strategy) => {
  const errors = {};
  
  // Validate required fields
  if (!strategy.fromToken) {
    errors.fromToken = "Source token is required";
  }
  
  if (!strategy.toToken) {
    errors.toToken = "Destination token is required";
  }
  
  if (strategy.fromToken === strategy.toToken) {
    errors.toToken = "Source and destination tokens must be different";
  }
  
  // Validate amounts
  if (!strategy.amount || strategy.amount <= 0) {
    errors.amount = "Amount per execution is required";
  } else {
    if (strategy.amount < DCA_CONFIG.minSwapAmount) {
      errors.amount = `Minimum amount is $${DCA_CONFIG.minSwapAmount}`;
    }
    
    if (strategy.amount > DCA_CONFIG.maxSwapAmount) {
      errors.amount = `Maximum amount is $${DCA_CONFIG.maxSwapAmount}`;
    }
  }
  
  // Validate frequency
  if (!strategy.frequency || !DCA_CONFIG.schedules[strategy.frequency]) {
    errors.frequency = "Valid frequency is required";
  }
  
  // Validate execution count
  if (!strategy.executionCount || strategy.executionCount <= 0) {
    errors.executionCount = "Number of executions is required";
  } else {
    if (strategy.executionCount > DCA_CONFIG.maxExecutionsPerStrategy) {
      errors.executionCount = `Maximum ${DCA_CONFIG.maxExecutionsPerStrategy} executions allowed`;
    }
  }
  
  // Validate slippage
  if (strategy.slippage !== undefined) {
    const slippageResult = validateSlippage(strategy.slippage);
    if (!slippageResult.isValid) {
      errors.slippage = slippageResult.error;
    }
  }
  
  // Calculate total strategy value
  const totalValue = strategy.amount * strategy.executionCount;
  if (totalValue > 100000) { // $100k limit
    errors.totalValue = "Total strategy value cannot exceed $100,000";
  }
  
  // Validate start time
  if (strategy.startTime) {
    const startTime = new Date(strategy.startTime);
    const now = new Date();
    
    if (startTime < now) {
      errors.startTime = "Start time cannot be in the past";
    }
    
    // Check if start time is too far in the future (1 year)
    const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    if (startTime > oneYearFromNow) {
      errors.startTime = "Start time cannot be more than 1 year in the future";
    }
  }
  
  const isValid = Object.keys(errors).length === 0;
  
  return {
    isValid,
    errors: isValid ? null : errors,
    totalValue: isValid ? totalValue : null
  };
};

/**
 * Validate DCA frequency and schedule
 * @param {string} frequency - Frequency key (HOURLY, DAILY, etc.)
 * @param {number} startTime - Start time timestamp
 * @returns {object} Validation result
 */
export const validateDCASchedule = (frequency, startTime = Date.now()) => {
  if (!frequency || !DCA_CONFIG.schedules[frequency]) {
    return { isValid: false, error: "Invalid frequency selected" };
  }
  
  const schedule = DCA_CONFIG.schedules[frequency];
  const start = new Date(startTime);
  const now = new Date();
  
  // Validate start time
  if (start < now) {
    return { isValid: false, error: "Schedule cannot start in the past" };
  }
  
  // Calculate next execution time
  const nextExecution = new Date(start.getTime() + schedule.interval * 1000);
  
  // Validate that we can execute within reasonable time
  const maxFutureTime = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year
  if (nextExecution > maxFutureTime) {
    return { isValid: false, error: "Next execution too far in the future" };
  }
  
  return {
    isValid: true,
    error: null,
    nextExecution: nextExecution.getTime(),
    interval: schedule.interval
  };
};

// ===== DELEGATION VALIDATORS =====

/**
 * Validate delegation configuration
 * @param {object} delegation - Delegation parameters
 * @returns {object} Validation result
 */
export const validateDelegation = (delegation) => {
  const errors = {};
  
  // Validate delegator address
  const delegatorResult = validateAddress(delegation.delegator);
  if (!delegatorResult.isValid) {
    errors.delegator = delegatorResult.error;
  }
  
  // Validate delegate address
  const delegateResult = validateAddress(delegation.delegate);
  if (!delegateResult.isValid) {
    errors.delegate = delegateResult.error;
  }
  
  // Ensure delegator and delegate are different
  if (delegation.delegator && delegation.delegate && 
      delegation.delegator.toLowerCase() === delegation.delegate.toLowerCase()) {
    errors.delegate = "Delegator and delegate cannot be the same address";
  }
  
  // Validate caveats
  if (delegation.caveats && Array.isArray(delegation.caveats)) {
    delegation.caveats.forEach((caveat, index) => {
      const enforcerCheck = validateAddress(caveat.enforcer);
      if (!enforcerCheck.isValid) {
        errors[`caveat_${index}_enforcer`] = enforcerCheck.error;
      }
      
      if (!caveat.terms) {
        errors[`caveat_${index}_terms`] = "Caveat terms are required";
      }
    });
  }
  
  // Validate duration if provided
  if (delegation.duration) {
    if (delegation.duration <= 0) {
      errors.duration = "Duration must be positive";
    }
    
    if (delegation.duration > DELEGATION_CONFIG.maxDelegationDuration) {
      errors.duration = `Maximum delegation duration is ${DELEGATION_CONFIG.maxDelegationDuration / 86400} days`;
    }
  }
  
  // Validate spending limits if provided
  if (delegation.spendingLimit) {
    if (delegation.spendingLimit <= 0) {
      errors.spendingLimit = "Spending limit must be positive";
    }
    
    if (delegation.spendingLimit > 100000) { // $100k limit
      errors.spendingLimit = "Spending limit cannot exceed $100,000";
    }
  }
  
  const isValid = Object.keys(errors).length === 0;
  
  return {
    isValid,
    errors: isValid ? null : errors
  };
};

// ===== GAS AND NETWORK VALIDATORS =====

/**
 * Validate gas parameters for Monad network
 * @param {object} gasParams - Gas parameters
 * @returns {object} Validation result
 */
export const validateGasParams = (gasParams) => {
  const errors = {};
  
  // Validate gas limit
  if (!gasParams.gasLimit) {
    errors.gasLimit = "Gas limit is required";
  } else {
    const gasLimit = BigInt(gasParams.gasLimit);
    
    if (gasLimit <= 0n) {
      errors.gasLimit = "Gas limit must be positive";
    }
    
    if (gasLimit > BigInt(MONAD_CONFIG.maxGasPerTx)) {
      errors.gasLimit = `Gas limit cannot exceed ${MONAD_CONFIG.maxGasPerTx.toLocaleString()}`;
    }
    
    // Check if gas limit is reasonable for operation type
    if (gasParams.operation && GAS_LIMITS[gasParams.operation]) {
      const recommendedLimit = GAS_LIMITS[gasParams.operation] * GAS_LIMITS.bufferMultiplier;
      
      if (gasLimit < BigInt(Math.floor(recommendedLimit * 0.5))) {
        errors.gasLimit = `Gas limit too low for ${gasParams.operation} operation`;
      }
    }
  }
  
  // Validate gas price (should be >= base fee on Monad)
  if (gasParams.gasPrice) {
    const gasPrice = BigInt(gasParams.gasPrice);
    
    if (gasPrice < MONAD_CONFIG.baseFee) {
      errors.gasPrice = `Gas price must be at least ${formatGwei(MONAD_CONFIG.baseFee)} gwei`;
    }
    
    // Warn about very high gas prices
    const maxReasonableGasPrice = MONAD_CONFIG.baseFee * 10n; // 500 gwei
    if (gasPrice > maxReasonableGasPrice) {
      errors.gasPrice = "Gas price is unusually high";
    }
  }
  
  const isValid = Object.keys(errors).length === 0;
  
  return {
    isValid,
    errors: isValid ? null : errors
  };
};

/**
 * Validate network configuration
 * @param {object} networkConfig - Network configuration
 * @returns {object} Validation result
 */
export const validateNetworkConfig = (networkConfig) => {
  const errors = {};
  
  // Validate chain ID
  if (networkConfig.chainId !== MONAD_CONFIG.chainId) {
    errors.chainId = `Invalid chain ID. Expected ${MONAD_CONFIG.chainId} for Monad testnet`;
  }
  
  // Validate RPC URL format
  if (!networkConfig.rpcUrl || !networkConfig.rpcUrl.startsWith('https://')) {
    errors.rpcUrl = "Invalid RPC URL format";
  }
  
  // Validate WebSocket URL format (optional)
  if (networkConfig.wsUrl && !networkConfig.wsUrl.startsWith('wss://')) {
    errors.wsUrl = "Invalid WebSocket URL format";
  }
  
  const isValid = Object.keys(errors).length === 0;
  
  return {
    isValid,
    errors: isValid ? null : errors
  };
};

// ===== UTILITY VALIDATORS =====

/**
 * Validate token configuration
 * @param {string} tokenAddress - Token address
 * @returns {object} Validation result with token info
 */
export const validateToken = (tokenAddress) => {
  const addressResult = validateAddress(tokenAddress);
  if (!addressResult.isValid) {
    return addressResult;
  }
  
  const token = SUPPORTED_TOKENS.find(t => 
    t.address.toLowerCase() === tokenAddress.toLowerCase()
  );
  
  if (!token) {
    return { isValid: false, error: "Token not supported" };
  }
  
  return { isValid: true, error: null, token };
};

/**
 * Validate price data from oracle
 * @param {object} priceData - Price data object
 * @returns {object} Validation result
 */
export const validatePriceData = (priceData) => {
  if (!priceData) {
    return { isValid: false, error: "Price data is required" };
  }
  
  if (typeof priceData.price !== 'number' || priceData.price <= 0) {
    return { isValid: false, error: "Invalid price value" };
  }
  
  if (typeof priceData.timestamp !== 'number' || priceData.timestamp <= 0) {
    return { isValid: false, error: "Invalid price timestamp" };
  }
  
  // Check price freshness
  const now = Date.now();
  const priceAge = now - priceData.timestamp;
  
  if (priceAge > DCA_CONFIG.priceStaleThreshold) {
    return { isValid: false, error: "Price data is too stale" };
  }
  
  // Check confidence level if provided
  if (priceData.confidence !== undefined) {
    if (typeof priceData.confidence !== 'number' || priceData.confidence < 0 || priceData.confidence > 1) {
      return { isValid: false, error: "Invalid confidence level" };
    }
  }
  
  return { isValid: true, error: null };
};

/**
 * Comprehensive validation for user operation
 * @param {object} userOp - User operation object
 * @returns {object} Validation result with detailed errors
 */
export const validateUserOperation = (userOp) => {
  const errors = {};
  
  // Validate sender
  const senderResult = validateAddress(userOp.sender);
  if (!senderResult.isValid) {
    errors.sender = senderResult.error;
  }
  
  // Validate nonce
  if (!['bigint', 'string', 'number'].includes(typeof userOp.nonce)) {
    errors.nonce = "Invalid nonce format";
  }
  
  // Validate gas parameters
  const gasResult = validateGasParams({
    gasLimit: userOp.callGasLimit || userOp.gasLimit,
    gasPrice: userOp.maxFeePerGas
  });
  
  if (!gasResult.isValid) {
    Object.assign(errors, gasResult.errors);
  }
  
  // Validate call data
  if (!userOp.callData || userOp.callData === '0x') {
    errors.callData = "Call data is required";
  }
  
  const isValid = Object.keys(errors).length === 0;
  
  return {
    isValid,
    errors: isValid ? null : errors
  };
};

// ===== EXPORTS =====
export default {
  // Blockchain validators
  validateAddress,
  validateTxHash,
  validatePrivateKey,
  
  // Token validators
  validateTokenAmount,
  validateSlippage,
  validateToken,
  
  // DCA validators
  validateDCAStrategy,
  validateDCASchedule,
  
  // Delegation validators
  validateDelegation,
  
  // Network validators
  validateGasParams,
  validateNetworkConfig,
  
  // Utility validators
  validatePriceData,
  validateUserOperation
};