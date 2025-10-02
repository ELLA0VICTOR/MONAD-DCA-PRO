import { 
    encodeFunctionData, 
    parseAbi, 
    keccak256, 
    toHex, 
    hexToBigInt, 
    parseUnits,
    formatUnits,
    getAddress,
    isAddress 
  } from 'viem';
  import { monadClient } from '../monad/monadClient.js';
  import { CONTRACTS, SUPPORTED_TOKENS, MONAD_CONFIG } from '../../utils/constants.js';
  import { validateAddress, validateTokenAmount } from '../../utils/validators.js';
  import { formatTokenAmount } from '../../utils/formatters.js';
  import { encodeAbiParameters, parseAbiParameters } from 'viem';
 
  /**
   * Caveat enforcer error types
   */
  export const ENFORCER_ERRORS = {
    SPENDING_LIMIT_EXCEEDED: 'spending_limit_exceeded',
    TIME_RANGE_INVALID: 'time_range_invalid',
    TOKEN_NOT_WHITELISTED: 'token_not_whitelisted',
    FUNCTION_NOT_ALLOWED: 'function_not_allowed',
    RECIPIENT_NOT_ALLOWED: 'recipient_not_allowed',
    GAS_LIMIT_EXCEEDED: 'gas_limit_exceeded',
    DAILY_LIMIT_EXCEEDED: 'daily_limit_exceeded',
    NONCE_INVALID: 'nonce_invalid'
  };
  
  /**
   * Enforcer deployment status
   */
  export const ENFORCER_STATUS = {
    NOT_DEPLOYED: 'not_deployed',
    DEPLOYING: 'deploying',
    DEPLOYED: 'deployed',
    FAILED: 'failed'
  };
  
  /**
   * Spending Limit Caveat Enforcer
   * Restricts total spending and per-transaction limits for tokens
   */
  export class SpendingLimitEnforcer {
    constructor() {
      this.address = CONTRACTS.SpendingLimitEnforcer || this.generateAddress('spending_limit');
      this.spentAmounts = new Map(); // Track spent amounts per delegation
      this.dailySpent = new Map(); // Track daily spending limits
    }
  
    /**
     * Encode spending limit caveat terms
     */
    encodeCaveat(terms) {
      const { token, maxAmount, maxPerTransaction, dailyLimit, resetTimestamp } = terms;
  
      validateAddress(token, 'Token address');
      validateTokenAmount(maxAmount, 'Maximum spending amount');
  
      if (maxPerTransaction) {
        validateTokenAmount(maxPerTransaction, 'Maximum per transaction');
        if (BigInt(maxPerTransaction) > BigInt(maxAmount)) {
          throw new Error('Per transaction limit cannot exceed total limit');
        }
      }
  
      // Encode as packed struct: (token, maxAmount, maxPerTx, dailyLimit, resetTime)
      const encoded = {
        token: getAddress(token),
        maxAmount: BigInt(maxAmount),
        maxPerTransaction: BigInt(maxPerTransaction || maxAmount),
        dailyLimit: BigInt(dailyLimit || maxAmount),
        resetTimestamp: BigInt(resetTimestamp || 0)
      };
  
      return encodeAbiParameters(
        parseAbiParameter('address token, uint256 maxAmount, uint256 maxPerTransaction, uint256 dailyLimit, uint256 resetTimestamp'),
        [encoded.token, encoded.maxAmount, encoded.maxPerTransaction, encoded.dailyLimit, encoded.resetTimestamp]
      );
    }
  
    /**
     * Validate spending against limits before execution
     */
    async validateSpending(delegationId, terms, amount, recipient = null) {
      const { token, maxAmount, maxPerTransaction, dailyLimit } = terms;
      const spendAmount = BigInt(amount);
  
      // Check per-transaction limit
      if (maxPerTransaction && spendAmount > BigInt(maxPerTransaction)) {
        throw new Error(
          `Transaction amount ${formatTokenAmount(spendAmount, 18)} exceeds per-transaction limit ${formatTokenAmount(maxPerTransaction, 18)}`
        );
      }
  
      // Check total spending limit
      const currentSpent = this.spentAmounts.get(delegationId) || 0n;
      if (currentSpent + spendAmount > BigInt(maxAmount)) {
        throw new Error(
          `Total spending ${formatTokenAmount(currentSpent + spendAmount, 18)} would exceed limit ${formatTokenAmount(maxAmount, 18)}`
        );
      }
  
      // Check daily limit if specified
      if (dailyLimit) {
        const today = this.getCurrentDay();
        const dailyKey = `${delegationId}_${today}`;
        const dailySpent = this.dailySpent.get(dailyKey) || 0n;
        
        if (dailySpent + spendAmount > BigInt(dailyLimit)) {
          throw new Error(
            `Daily spending ${formatTokenAmount(dailySpent + spendAmount, 18)} would exceed daily limit ${formatTokenAmount(dailyLimit, 18)}`
          );
        }
      }
  
      // Check token balance if possible
      if (recipient) {
        await this.validateTokenBalance(token, recipient, spendAmount);
      }
  
      return true;
    }
  
    /**
     * Record spending after successful execution
     */
    recordSpending(delegationId, terms, amount) {
      const spendAmount = BigInt(amount);
      
      // Update total spent
      const currentSpent = this.spentAmounts.get(delegationId) || 0n;
      this.spentAmounts.set(delegationId, currentSpent + spendAmount);
  
      // Update daily spent if daily limit exists
      if (terms.dailyLimit) {
        const today = this.getCurrentDay();
        const dailyKey = `${delegationId}_${today}`;
        const dailySpent = this.dailySpent.get(dailyKey) || 0n;
        this.dailySpent.set(dailyKey, dailySpent + spendAmount);
      }
  
      console.log(`Recorded spending: ${formatTokenAmount(spendAmount, 18)} for delegation ${delegationId}`);
    }
  
    /**
     * Get remaining spending allowance
     */
    getRemainingAllowance(delegationId, terms) {
      const { maxAmount, dailyLimit } = terms;
      const totalSpent = this.spentAmounts.get(delegationId) || 0n;
      const totalRemaining = BigInt(maxAmount) - totalSpent;
  
      let dailyRemaining = totalRemaining;
      if (dailyLimit) {
        const today = this.getCurrentDay();
        const dailyKey = `${delegationId}_${today}`;
        const dailySpent = this.dailySpent.get(dailyKey) || 0n;
        dailyRemaining = BigInt(dailyLimit) - dailySpent;
      }
  
      return {
        total: totalRemaining,
        daily: dailyRemaining,
        available: totalRemaining < dailyRemaining ? totalRemaining : dailyRemaining
      };
    }
  
    async validateTokenBalance(token, account, amount) {
      try {
        const balance = await monadClient.readContract({
          address: token,
          abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
          functionName: 'balanceOf',
          args: [account]
        });
  
        if (balance < amount) {
          throw new Error(`Insufficient token balance: ${formatTokenAmount(balance, 18)} < ${formatTokenAmount(amount, 18)}`);
        }
      } catch (error) {
        console.warn('Could not validate token balance:', error.message);
        // Don't throw - balance validation is optional
      }
    }
  
    getCurrentDay() {
      return Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    }
  
    generateAddress(salt) {
      return `0x${keccak256(toHex(`${salt}_${MONAD_CONFIG.chainId}`)).slice(2, 42)}`;
    }
  }
  
  /**
   * Time Range Caveat Enforcer
   * Restricts delegation execution to specific time windows
   */
  export class TimeRangeEnforcer {
    constructor() {
      this.address = CONTRACTS.TimeRangeEnforcer || this.generateAddress('time_range');
      this.executionTimes = new Map(); // Track execution times per delegation
    }
  
    /**
     * Encode time range caveat terms
     */
    encodeCaveat(terms) {
      const { startTime, endTime, executionWindows, timezone } = terms;
  
      if (!startTime || !endTime) {
        throw new Error('Start time and end time are required');
      }
  
      if (endTime <= startTime) {
        throw new Error('End time must be after start time');
      }
  
      if (startTime < Date.now() - 60000) { // Allow 1 minute grace period for past start times
        throw new Error('Start time cannot be in the past');
      }
  
      const encoded = {
        startTime: BigInt(Math.floor(startTime / 1000)), // Convert to seconds
        endTime: BigInt(Math.floor(endTime / 1000)),
        executionWindows: executionWindows ? this.encodeExecutionWindows(executionWindows) : 0n,
        timezone: BigInt(timezone || 0) // UTC offset in seconds
      };
  
      return encodeAbiParameters(
        parseAbiParameters('uint256 startTime, uint256 endTime, uint256 executionWindows, uint256 timezone'),
        [encoded.startTime, encoded.endTime, encoded.executionWindows, encoded.timezone]
      );
    }
  
    /**
     * Validate execution time against time range restrictions
     */
    validateExecutionTime(delegationId, terms, currentTime = Date.now()) {
      const { startTime, endTime, executionWindows, cooldownPeriod } = terms;
      const currentTimeSeconds = Math.floor(currentTime / 1000);
  
      // Check basic time range
      if (currentTimeSeconds < Math.floor(startTime / 1000)) {
        throw new Error(`Execution not allowed before ${new Date(startTime).toISOString()}`);
      }
  
      if (currentTimeSeconds > Math.floor(endTime / 1000)) {
        throw new Error(`Execution not allowed after ${new Date(endTime).toISOString()}`);
      }
  
      // Check execution windows (e.g., only weekdays, only business hours)
      if (executionWindows && !this.isInExecutionWindow(currentTime, executionWindows)) {
        throw new Error('Current time is outside allowed execution windows');
      }
  
      // Check cooldown period between executions
      if (cooldownPeriod) {
        const lastExecution = this.executionTimes.get(delegationId);
        if (lastExecution && currentTime - lastExecution < cooldownPeriod) {
          const nextAllowed = new Date(lastExecution + cooldownPeriod);
          throw new Error(`Cooldown period active. Next execution allowed at ${nextAllowed.toISOString()}`);
        }
      }
  
      return true;
    }
  
    /**
     * Record execution time
     */
    recordExecution(delegationId, executionTime = Date.now()) {
      this.executionTimes.set(delegationId, executionTime);
      console.log(`Recorded execution time for delegation ${delegationId}: ${new Date(executionTime).toISOString()}`);
    }
  
    /**
     * Check if current time falls within execution windows
     */
    isInExecutionWindow(currentTime, executionWindows) {
      const date = new Date(currentTime);
      const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
      const hourOfDay = date.getHours();
  
      // Check weekday restrictions
      if (executionWindows.weekdaysOnly && (dayOfWeek === 0 || dayOfWeek === 6)) {
        return false;
      }
  
      // Check business hours restrictions
      if (executionWindows.businessHoursOnly && (hourOfDay < 9 || hourOfDay >= 17)) {
        return false;
      }
  
      // Check custom hour ranges
      if (executionWindows.allowedHours && !executionWindows.allowedHours.includes(hourOfDay)) {
        return false;
      }
  
      // Check custom days
      if (executionWindows.allowedDays && !executionWindows.allowedDays.includes(dayOfWeek)) {
        return false;
      }
  
      return true;
    }
  
    encodeExecutionWindows(windows) {
      const { weekdaysOnly, businessHoursOnly, allowedHours, allowedDays } = windows;
      return encodeAbiParameters(
        parseAbiParameters('bool weekdaysOnly, bool businessHoursOnly, uint8[] allowedHours, uint8[] allowedDays'),
        [
          Boolean(weekdaysOnly),
          Boolean(businessHoursOnly),
          Array.isArray(allowedHours) ? allowedHours.map(Number) : [],
          Array.isArray(allowedDays) ? allowedDays.map(Number) : [],
        ]
      );
    }
  
    generateAddress(salt) {
      return `0x${keccak256(toHex(`${salt}_${MONAD_CONFIG.chainId}`)).slice(2, 42)}`;
    }
  }
  
  /**
   * Token Whitelist Caveat Enforcer
   * Restricts interactions to specific approved tokens
   */
  export class TokenWhitelistEnforcer {
    constructor() {
      this.address = CONTRACTS.TokenWhitelistEnforcer || this.generateAddress('token_whitelist');
    }
  
    /**
     * Encode token whitelist caveat terms
     */
    encodeCaveat(terms) {
      const { tokens, allowedPairs, strictMode } = terms;
  
      if (!Array.isArray(tokens) || tokens.length === 0) {
        throw new Error('Token whitelist must contain at least one token');
      }
  
      // Validate all token addresses
      tokens.forEach((token, index) => {
        validateAddress(token, `Token ${index} address`);
      });
  
      const encoded = {
        tokens: tokens.map(token => getAddress(token)),
        allowedPairs: allowedPairs || [],
        strictMode: Boolean(strictMode)
      };
  
      return encodeAbiParameters(
        parseAbiParameters('address[] tokens, address[][] allowedPairs, bool strictMode'),
        [encoded.tokens, encoded.allowedPairs, encoded.strictMode]
      );
      
    }
  
    /**
     * Validate token interaction against whitelist
     */
    validateToken(terms, tokenAddress, interactionType = 'transfer') {
      const { tokens, allowedPairs, strictMode } = terms;
  
      if (!isAddress(tokenAddress)) {
        throw new Error('Invalid token address');
      }
  
      const normalizedToken = getAddress(tokenAddress);
      const normalizedWhitelist = tokens.map(token => getAddress(token));
  
      // Check if token is in whitelist
      if (!normalizedWhitelist.includes(normalizedToken)) {
        const tokenInfo = this.getTokenInfo(normalizedToken);
        throw new Error(`Token ${tokenInfo.symbol || normalizedToken} is not in whitelist`);
      }
  
      // In strict mode, validate specific interaction types
      if (strictMode && interactionType === 'swap') {
        this.validateSwapPair(terms, tokenAddress);
      }
  
      return true;
    }
  
    /**
     * Validate token swap pairs
     */
    validateSwapPair(terms, tokenIn, tokenOut) {
      const { allowedPairs } = terms;
      
      if (!allowedPairs || allowedPairs.length === 0) {
        // If no specific pairs defined, any combination of whitelisted tokens is allowed
        this.validateToken(terms, tokenIn, 'swap');
        this.validateToken(terms, tokenOut, 'swap');
        return true;
      }
  
      const normalizedTokenIn = getAddress(tokenIn);
      const normalizedTokenOut = getAddress(tokenOut);
  
      // Check if the specific pair is allowed
      const pairAllowed = allowedPairs.some(pair => {
        const [pairTokenA, pairTokenB] = pair.map(token => getAddress(token));
        return (
          (normalizedTokenIn === pairTokenA && normalizedTokenOut === pairTokenB) ||
          (normalizedTokenIn === pairTokenB && normalizedTokenOut === pairTokenA)
        );
      });
  
      if (!pairAllowed) {
        const tokenInInfo = this.getTokenInfo(normalizedTokenIn);
        const tokenOutInfo = this.getTokenInfo(normalizedTokenOut);
        throw new Error(
          `Swap pair ${tokenInInfo.symbol || normalizedTokenIn}/${tokenOutInfo.symbol || normalizedTokenOut} is not allowed`
        );
      }
  
      return true;
    }
  
    /**
     * Get token information from supported tokens list
     */
    getTokenInfo(tokenAddress) {
      return Object.values(SUPPORTED_TOKENS).find(
        token => getAddress(token.address) === getAddress(tokenAddress)
      ) || { symbol: 'UNKNOWN', decimals: 18 };
    }
  
    generateAddress(salt) {
      return `0x${keccak256(toHex(`${salt}_${MONAD_CONFIG.chainId}`)).slice(2, 42)}`;
    }
  }
  
  /**
   * Function Whitelist Caveat Enforcer
   * Restricts execution to specific contract function calls
   */
  export class FunctionWhitelistEnforcer {
    constructor() {
      this.address = CONTRACTS.FunctionWhitelistEnforcer || this.generateAddress('function_whitelist');
      this.functionSignatures = new Map();
      this.initializeCommonFunctions();
    }
  
    /**
     * Initialize common DeFi function signatures
     */
    initializeCommonFunctions() {
      const commonFunctions = {
        // ERC-20 functions
        'transfer': '0xa9059cbb',
        'approve': '0x095ea7b3',
        'transferFrom': '0x23b872dd',
        
        // Uniswap V3 functions
        'exactInputSingle': '0x414bf389',
        'exactOutputSingle': '0xdb3e2198',
        'exactInput': '0xc04b8d59',
        'exactOutput': '0xf28c0498',
        'multicall': '0xac9650d8',
        
        // Common DeFi functions
        'swap': '0x38ed1739',
        'deposit': '0xd0e30db0',
        'withdraw': '0x2e1a7d4d'
      };
  
      Object.entries(commonFunctions).forEach(([name, selector]) => {
        this.functionSignatures.set(name, selector);
        this.functionSignatures.set(selector, name);
      });
    }
  
    /**
     * Encode function whitelist caveat terms
     */
    encodeCaveat(terms) {
      const { functions, contracts, strictMode } = terms;
  
      if (!Array.isArray(functions) || functions.length === 0) {
        throw new Error('Function whitelist must contain at least one function');
      }
  
      const functionSelectors = functions.map(func => {
        if (typeof func === 'string') {
          // Handle both function names and selectors
          return func.startsWith('0x') ? func : this.getFunctionSelector(func);
        }
        throw new Error(`Invalid function specification: ${func}`);
      });
  
      const encoded = {
        functions: functionSelectors,
        contracts: contracts || [],
        strictMode: Boolean(strictMode)
      };
  
      return encodeAbiParameters(
        parseAbiParameters('bytes4[] functions, address[] contracts, bool strictMode'),
        [encoded.functions, encoded.contracts, encoded.strictMode]
      );
      
    }
  
    /**
     * Validate function call against whitelist
     */
    validateFunctionCall(terms, contractAddress, calldata) {
      const { functions, contracts, strictMode } = terms;
  
      // Extract function selector from calldata
      const functionSelector = calldata.slice(0, 10); // First 4 bytes + '0x'
  
      // Check if function is in whitelist
      const allowedSelectors = functions.map(func => 
        typeof func === 'string' && func.startsWith('0x') ? func : this.getFunctionSelector(func)
      );
  
      if (!allowedSelectors.includes(functionSelector)) {
        const functionName = this.functionSignatures.get(functionSelector) || functionSelector;
        throw new Error(`Function ${functionName} is not in whitelist`);
      }
  
      // In strict mode, also validate contract address
      if (strictMode && contracts && contracts.length > 0) {
        const normalizedContract = getAddress(contractAddress);
        const normalizedWhitelist = contracts.map(contract => getAddress(contract));
        
        if (!normalizedWhitelist.includes(normalizedContract)) {
          throw new Error(`Contract ${contractAddress} is not in whitelist`);
        }
      }
  
      return true;
    }
  
    /**
     * Get function selector from function signature
     */
    getFunctionSelector(functionSignature) {
      // Return cached mapping if available
      if (this.functionSignatures.has(functionSignature)) {
        return this.functionSignatures.get(functionSignature);
      }
  
      // If already a selector (0x + 8 hex chars), normalize & return
      if (typeof functionSignature === 'string' && /^0x[0-9a-fA-F]{8}$/.test(functionSignature)) {
        this.functionSignatures.set(functionSignature, functionSignature);
        return functionSignature;
      }
  
      // If user passed a short name (e.g. "transfer"), try map
      if (typeof functionSignature === 'string' && !functionSignature.includes('(')) {
        const known = this.functionSignatures.get(functionSignature);
        if (known && typeof known === 'string' && known.startsWith('0x')) {
          return known;
        }
        throw new Error(
          `Function name "${functionSignature}" not recognized. Provide a full signature (e.g. "transfer(address,uint256)") or add it to initializeCommonFunctions.`
        );
      }
  
      // Now we expect a full signature like "transfer(address,uint256)"
      const signature = functionSignature;
  
      // Compute selector: keccak256 of UTF-8 bytes, first 4 bytes (8 hex chars) + "0x"
      // Use TextEncoder if available (browser/node recent); fallback to Buffer for older Node
      let bytes;
      if (typeof TextEncoder !== 'undefined') {
        bytes = new TextEncoder().encode(signature);
      } else {
        // Node fallback: Buffer -> Uint8Array
        bytes = Uint8Array.from(Buffer.from(signature, 'utf8'));
      }
  
      const hash = keccak256(bytes);       // keccak256 returns "0x..." hex string
      const selector = hash.slice(0, 10);  // "0x" + 8 hex chars
  
      // Cache bi-directional mapping
      this.functionSignatures.set(functionSignature, selector);
      this.functionSignatures.set(selector, functionSignature);
  
      return selector;
    }
  
    generateAddress(salt) {
      return `0x${keccak256(toHex(`${salt}_${MONAD_CONFIG.chainId}`)).slice(2, 42)}`;
    }
  }
  
  /**
   * Gas Limit Caveat Enforcer
   * Restricts maximum gas consumption per execution
   */
  export class GasLimitEnforcer {
    constructor() {
      this.address = CONTRACTS.GasLimitEnforcer || this.generateAddress('gas_limit');
      this.gasUsage = new Map(); // Track gas usage per delegation
    }
  
    /**
     * Encode gas limit caveat terms
     */
    encodeCaveat(terms) {
      const { maxGasPerExecution, maxTotalGas, maxGasPrice } = terms;
  
      if (!maxGasPerExecution || BigInt(maxGasPerExecution) <= 0n) {
        throw new Error('Maximum gas per execution must be positive');
      }
  
      const encoded = {
        maxGasPerExecution: BigInt(maxGasPerExecution),
        maxTotalGas: BigInt(maxTotalGas || maxGasPerExecution * 100n), // Default to 100 executions
        maxGasPrice: BigInt(maxGasPrice || (MONAD_CONFIG.baseFee * 2n)) 
      };
  
      return encodeAbiParameters(
        parseAbiParameters('uint256 maxGasPerExecution, uint256 maxTotalGas, uint256 maxGasPrice'),
        [encoded.maxGasPerExecution, encoded.maxTotalGas, encoded.maxGasPrice]
      );
      
    }
  
    /**
     * Validate gas parameters before execution
     */
    validateGasUsage(delegationId, terms, estimatedGas, gasPrice) {
      const { maxGasPerExecution, maxTotalGas, maxGasPrice } = terms;
      const gasAmount = BigInt(estimatedGas);
      const price = BigInt(gasPrice);
  
      // Check per-execution gas limit
      if (gasAmount > BigInt(maxGasPerExecution)) {
        throw new Error(
          `Estimated gas ${gasAmount} exceeds per-execution limit ${maxGasPerExecution}`
        );
      }
  
      // Check gas price limit
      if (price > BigInt(maxGasPrice)) {
        throw new Error(
          `Gas price ${formatUnits(price, 9)} gwei exceeds limit ${formatUnits(BigInt(maxGasPrice), 9)} gwei`
        );
      }
  
      // Check total gas consumption
      if (maxTotalGas) {
        const totalUsed = this.gasUsage.get(delegationId) || 0n;
        if (totalUsed + gasAmount > BigInt(maxTotalGas)) {
          throw new Error(
            `Total gas consumption ${totalUsed + gasAmount} would exceed limit ${maxTotalGas}`
          );
        }
      }
  
      return true;
    }
  
    /**
     * Record gas usage after execution
     */
    recordGasUsage(delegationId, gasUsed) {
      const currentUsage = this.gasUsage.get(delegationId) || 0n;
      this.gasUsage.set(delegationId, currentUsage + BigInt(gasUsed));
      
      console.log(`Recorded gas usage: ${gasUsed} for delegation ${delegationId}`);
    }
  
    /**
     * Get remaining gas allowance
     */
    getRemainingGasAllowance(delegationId, terms) {
      const { maxGasPerExecution, maxTotalGas } = terms;
      const totalUsed = this.gasUsage.get(delegationId) || 0n;
      
      return {
        perExecution: BigInt(maxGasPerExecution),
        totalRemaining: maxTotalGas ? BigInt(maxTotalGas) - totalUsed : null,
        totalUsed
      };
    }
  
    generateAddress(salt) {
      return `0x${keccak256(toHex(`${salt}_${MONAD_CONFIG.chainId}`)).slice(2, 42)}`;
    }
  }
  
  /**
   * Caveat Enforcer Factory
   * Creates and manages all caveat enforcer instances
   */
  export class CaveatEnforcerFactory {
    constructor() {
      this.enforcers = new Map();
      this.initializeEnforcers();
    }
  
    /**
     * Initialize all enforcer instances
     */
    initializeEnforcers() {
      this.enforcers.set('spending_limit', new SpendingLimitEnforcer());
      this.enforcers.set('time_range', new TimeRangeEnforcer());
      this.enforcers.set('token_whitelist', new TokenWhitelistEnforcer());
      this.enforcers.set('function_whitelist', new FunctionWhitelistEnforcer());
      this.enforcers.set('gas_limit', new GasLimitEnforcer());
    }
  
    /**
     * Get enforcer instance by type
     */
    getEnforcer(type) {
      const enforcer = this.enforcers.get(type);
      if (!enforcer) {
        throw new Error(`Unknown enforcer type: ${type}`);
      }
      return enforcer;
    }
  
    /**
     * Get all available enforcer types
     */
    getAvailableEnforcers() {
      return Array.from(this.enforcers.keys());
    }
  
    /**
     * Validate caveat terms for a specific enforcer type
     */
    validateCaveat(type, terms) {
      const enforcer = this.getEnforcer(type);
      return enforcer.encodeCaveat(terms); // This also validates
    }
  
    /**
     * Create a complete caveat specification
     */
    createCaveat(type, terms) {
      const enforcer = this.getEnforcer(type);
      
      return {
        enforcer: enforcer.address,
        terms: enforcer.encodeCaveat(terms),
        type,
        originalTerms: terms
      };
    }
  }
  
  // Create and export singleton factory
  export const caveatEnforcerFactory = new CaveatEnforcerFactory();
  
  // Export individual enforcer classes for direct use
  export const spendingLimitEnforcer = caveatEnforcerFactory.getEnforcer('spending_limit');
  export const timeRangeEnforcer = caveatEnforcerFactory.getEnforcer('time_range');
  export const tokenWhitelistEnforcer = caveatEnforcerFactory.getEnforcer('token_whitelist');
  export const functionWhitelistEnforcer = caveatEnforcerFactory.getEnforcer('function_whitelist');
  export const gasLimitEnforcer = caveatEnforcerFactory.getEnforcer('gas_limit');
  
  // Export helper functions
  export const createSpendingLimitCaveat = (terms) => caveatEnforcerFactory.createCaveat('spending_limit', terms);
  export const createTimeRangeCaveat = (terms) => caveatEnforcerFactory.createCaveat('time_range', terms);
  export const createTokenWhitelistCaveat = (terms) => caveatEnforcerFactory.createCaveat('token_whitelist', terms);
  export const createFunctionWhitelistCaveat = (terms) => caveatEnforcerFactory.createCaveat('function_whitelist', terms);
  export const createGasLimitCaveat = (terms) => caveatEnforcerFactory.createCaveat('gas_limit', terms);