import { parseUnits, formatUnits, encodeFunctionData, decodeFunctionResult } from 'viem';
import { monadClient } from '../monad/monadClient.js';
import { gasEstimator } from '../monad/gasEstimator.js';
import { userOperationsService } from '../smartAccount/userOperations.js';
import { validateTokenAmount, validateSlippage, validateAddress } from '../../utils/validators.js';
import { formatTokenAmount, formatPrice, formatPercentage } from '../../utils/formatters.js';
import { 
  CONTRACTS, 
  SUPPORTED_TOKENS, 
  GAS_LIMITS, 
  MONAD_CONFIG,
  DCA_CONFIG 
} from '../../utils/constants.js';
import { keccak256, decodeEventLog } from 'viem';
import UniswapV3PoolABI from '../../contracts/abis/UniswapV3Pool.json';
import ERC20_ABI from '../../contracts/abis/ERC20.json';
import SWAP_ROUTER_ABI from '../../contracts/abis/SwapRouter02.json';
import QUOTER_V2_ABI from '../../contracts/abis/QuoterV2.json'


function safeBase64Encode(str) {
  try {
    if (typeof Buffer !== 'undefined') {
      // Node.js & bundlers
      return Buffer.from(str, 'utf-8').toString('base64');
    } else if (typeof btoa !== 'undefined') {
      // Browser safe UTF-8 → Base64
      return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
    } else {
      throw new Error('No base64 encoder available');
    }
  } catch (e) {
    // Fallback: timestamp + random
    return `${Date.now()}${Math.floor(Math.random() * 1e9)}`;
  }
}

// Swap execution status
const SWAP_STATUS = {
  PENDING: 'pending',
  QUOTE_OBTAINED: 'quote_obtained',
  APPROVED: 'approved',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

// Swap types
const SWAP_TYPES = {
  EXACT_INPUT_SINGLE: 'exact_input_single',
  EXACT_INPUT_MULTI: 'exact_input_multi',
  EXACT_OUTPUT_SINGLE: 'exact_output_single',
  EXACT_OUTPUT_MULTI: 'exact_output_multi'
};

// Fee tiers for Uniswap V3 pools
const FEE_TIERS = {
  LOW: 500,      // 0.05%
  MEDIUM: 3000,  // 0.3%
  HIGH: 10000    // 1%
};

/**
 * Swap Executor Service
 * Handles token swaps on Uniswap V3 with advanced features
 */
class SwapExecutorService {
  constructor() {
    this.activeSwaps = new Map();
    this.swapHistory = new Map();
    this.priceImpactCache = new Map();
    this.gasEstimateCache = new Map();
    this.initialized = false;
  }

  /**
   * Initialize the swap executor
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Validate contract addresses
      await this.validateContracts();
      
      // Initialize price impact monitoring
      this.startPriceImpactMonitoring();
      
      this.initialized = true;
      console.log('SwapExecutorService initialized');
    } catch (error) {
      console.error('Failed to initialize SwapExecutorService:', error);
      throw new Error(`Swap executor initialization failed: ${error.message}`);
    }
  }

  /**
   * Execute a single token swap
   */
  async executeSwap(swapParams, options = {}) {
    if (!this.initialized) {
      throw new Error('Swap executor not initialized');
    }

    // Validate swap parameters
    const validation = this.validateSwapParams(swapParams);
    if (!validation.isValid) {
      throw new Error(`Invalid swap parameters: ${validation.errors.join(', ')}`);
    }

    const {
      skipQuote = false,
      skipApproval = false,
      maxSlippage = DCA_CONFIG.DEFAULT_SLIPPAGE,
      deadline = Math.floor(Date.now() / 1000) + 300, // 5 minutes
      enableGasOptimization = true,
      retryOnFailure = true,
      maxRetries = 3
    } = options;

    const swapId = this.generateSwapId(swapParams);
    
    try {
      // Create swap execution record
      const swap = {
        id: swapId,
        params: swapParams,
        options,
        status: SWAP_STATUS.PENDING,
        startedAt: Date.now(),
        completedAt: null,
        quote: null,
        actualOutput: 0n,
        gasUsed: 0n,
        gasCost: 0n,
        priceImpact: 0,
        slippage: 0,
        txHash: null,
        error: null,
        retryCount: 0
      };

      this.activeSwaps.set(swapId, swap);

      console.log(`Starting swap execution ${swapId}: ${formatTokenAmount(swapParams.amountIn, swapParams.tokenInDecimals)} ${swapParams.tokenInSymbol} → ${swapParams.tokenOutSymbol}`);

      // Step 1: Get quote (unless skipped)
      if (!skipQuote) {
        const quoteResult = await this.getSwapQuote(swapParams, { maxSlippage, deadline });
        if (!quoteResult.success) {
          throw new Error(`Quote failed: ${quoteResult.error}`);
        }
        
        swap.quote = quoteResult.quote;
        swap.status = SWAP_STATUS.QUOTE_OBTAINED;
        
        // Check price impact
        if (swap.quote.priceImpact > DCA_CONFIG.MAX_PRICE_IMPACT) {
          throw new Error(`Price impact too high: ${swap.quote.priceImpact}% > ${DCA_CONFIG.MAX_PRICE_IMPACT}%`);
        }
        
        console.log(`Quote obtained: ${formatTokenAmount(swap.quote.amountOut, swapParams.tokenOutDecimals)} ${swapParams.tokenOutSymbol}, price impact: ${formatPercentage(swap.quote.priceImpact)}`);
      }

      // Step 2: Check and approve tokens (unless skipped)
      if (!skipApproval) {
        const approvalResult = await this.ensureTokenApproval(swapParams);
        if (!approvalResult.success) {
          throw new Error(`Approval failed: ${approvalResult.error}`);
        }
        
        swap.status = SWAP_STATUS.APPROVED;
        console.log(`Token approval confirmed for ${swapParams.tokenInSymbol}`);
      }

      // Step 3: Execute the swap
      swap.status = SWAP_STATUS.EXECUTING;
      
      const executionResult = await this.performSwap(swap, enableGasOptimization);
      
      if (executionResult.success) {
        swap.status = SWAP_STATUS.COMPLETED;
        swap.actualOutput = executionResult.amountOut;
        swap.txHash = executionResult.txHash;
        swap.gasUsed = executionResult.gasUsed;
        swap.gasCost = executionResult.gasCost;
        swap.slippage = this.calculateActualSlippage(swap);
        swap.completedAt = Date.now();

        console.log(`Swap ${swapId} completed successfully`);
        console.log(`Output: ${formatTokenAmount(swap.actualOutput, swapParams.tokenOutDecimals)} ${swapParams.tokenOutSymbol}`);
        console.log(`Gas used: ${swap.gasUsed}, cost: ${formatTokenAmount(swap.gasCost, 18)} MON`);
        
        // Record successful swap
        this.recordSwapHistory(swap);
        
        return {
          success: true,
          swapId,
          result: {
            amountOut: swap.actualOutput,
            txHash: swap.txHash,
            gasUsed: swap.gasUsed,
            gasCost: swap.gasCost,
            slippage: swap.slippage,
            priceImpact: swap.quote?.priceImpact || 0,
            executionTime: swap.completedAt - swap.startedAt
          }
        };
      } else {
        // Handle execution failure
        swap.status = SWAP_STATUS.FAILED;
        swap.error = executionResult.error;
        swap.completedAt = Date.now();

        // Retry if enabled and retries remaining
        if (retryOnFailure && swap.retryCount < maxRetries) {
          console.warn(`Swap ${swapId} failed, retrying (${swap.retryCount + 1}/${maxRetries}): ${executionResult.error}`);
          swap.retryCount++;
          
          // Wait before retry with exponential backoff
          await this.delay(Math.pow(2, swap.retryCount) * 1000);
          
          // Recursive retry
          return this.executeSwap(swapParams, { 
            ...options, 
            retryOnFailure: swap.retryCount < maxRetries 
          });
        }

        throw new Error(`Swap execution failed: ${executionResult.error}`);
      }

    } catch (error) {
      console.error(`Swap execution ${swapId} failed:`, error);
      
      const swap = this.activeSwaps.get(swapId);
      if (swap) {
        swap.status = SWAP_STATUS.FAILED;
        swap.error = error.message;
        swap.completedAt = Date.now();
        this.recordSwapHistory(swap);
      }

      throw error;
    } finally {
      this.activeSwaps.delete(swapId);
    }
  }

  /**
   * Get swap quote from QuoterV2
   */
  async getSwapQuote(swapParams, options = {}) {
    const { maxSlippage = DCA_CONFIG.DEFAULT_SLIPPAGE } = options;

    try {
      // Determine optimal fee tier
      const feeTier = await this.getOptimalFeeTier(swapParams.tokenIn, swapParams.tokenOut);
      
      // Call QuoterV2 for quote
      const quoteCalldata = encodeFunctionData({
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          swapParams.tokenIn,
          swapParams.tokenOut,
          feeTier,
          swapParams.amountIn,
          0n // No price limit
        ]
      });

      const quoteResult = await monadClient.call({
        to: CONTRACTS.QuoterV2,
        data: quoteCalldata
      });

      const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = decodeFunctionResult({
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        data: quoteResult.data
      });

      // Calculate price impact
      const priceImpact = await this.calculatePriceImpact(
        swapParams.amountIn,
        amountOut,
        swapParams.tokenIn,
        swapParams.tokenOut
      );

      // Calculate minimum amount out with slippage protection
      // maxSlippage is decimal (e.g. 0.05 for 5%)
      // Convert to basis points (bps)
      const slippageBps = BigInt(Math.floor(maxSlippage * 10000));
      const minAmountOut = (amountOut * (10000n - slippageBps)) / 10000n;

      const quote = {
        amountOut,
        minAmountOut,
        priceImpact,
        feeTier,
        gasEstimate: Number(gasEstimate),
        sqrtPriceX96After,
        initializedTicksCrossed: Number(initializedTicksCrossed),
        timestamp: Date.now()
      };

      return {
        success: true,
        quote
      };

    } catch (error) {
      console.error('Failed to get swap quote:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Ensure token approval for SwapRouter02
   */
  async ensureTokenApproval(swapParams, options = {}) {
    const { forceApproval = false } = options;

    try {
      // Check current allowance
      const allowanceCalldata = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [swapParams.account, CONTRACTS.SwapRouter02]
      });

      const allowanceResult = await monadClient.call({
        to: swapParams.tokenIn,
        data: allowanceCalldata
      });

      const [currentAllowance] = decodeFunctionResult({
        abi: ERC20_ABI,
        functionName: 'allowance',
        data: allowanceResult.data
      });

      // Check if approval is needed
      if (currentAllowance >= swapParams.amountIn && !forceApproval) {
        return {
          success: true,
          approvalNeeded: false,
          currentAllowance
        };
      }

      console.log(`Token approval needed: current ${formatTokenAmount(currentAllowance, swapParams.tokenInDecimals)}, required ${formatTokenAmount(swapParams.amountIn, swapParams.tokenInDecimals)}`);

      // Create approval transaction
      const approvalAmount = swapParams.amountIn * 2n; // Approve 2x for efficiency
      
      const approvalResult = await userOperationsService.createTokenApproval({
        account: swapParams.account,
        token: swapParams.tokenIn,
        spender: CONTRACTS.SwapRouter02,
        amount: approvalAmount
      });

      if (approvalResult.success) {
        // Wait for approval confirmation
        const receipt = await userOperationsService.executeUserOperation(
          approvalResult.userOperation,
          { waitForConfirmation: true }
        );

        if (receipt.success) {
          return {
            success: true,
            approvalNeeded: true,
            approvedAmount: approvalAmount,
            txHash: receipt.txHash
          };
        } else {
          throw new Error(`Approval transaction failed: ${receipt.error}`);
        }
      } else {
        throw new Error(`Failed to create approval transaction: ${approvalResult.error}`);
      }

    } catch (error) {
      console.error('Token approval failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Perform the actual swap execution
   */
  async performSwap(swap, enableGasOptimization = true) {
    try {
      const { params, quote } = swap;
      
      // Prepare swap parameters
      const swapParams = {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: quote.feeTier,
        recipient: params.recipient,
        deadline: params.deadline || Math.floor(Date.now() / 1000) + 300,
        amountIn: params.amountIn,
        amountOutMinimum: quote.minAmountOut,
        sqrtPriceLimitX96: 0n // No price limit
      };

      // Encode swap function call
      const swapCalldata = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [swapParams]
      });

      // Estimate gas if optimization enabled
      let gasLimit = GAS_LIMITS.singleSwap;
      if (enableGasOptimization) {
        const gasEstimate = await gasEstimator.estimateOperationGas('uniswap_swap', {
          calldata: swapCalldata,
          to: CONTRACTS.SwapRouter02,
          value: 0n
        });
        gasLimit = gasEstimate.gasLimit;
      }

      // Create user operation for swap
      const swapOperation = await userOperationsService.createUniswapSwap({
        account: params.account,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        amountOutMinimum: quote.minAmountOut,
        recipient: params.recipient,
        deadline: swapParams.deadline,
        gasLimit
      });

      if (!swapOperation.success) {
        throw new Error(`Failed to create swap operation: ${swapOperation.error}`);
      }

      // Execute the swap
      const executionResult = await userOperationsService.executeUserOperation(
        swapOperation.userOperation,
        { 
          waitForConfirmation: true,
          timeout: 60000 // 1 minute timeout
        }
      );

      if (executionResult.success) {
        // Parse swap result from logs
        const swapResult = await this.parseSwapResult(executionResult.receipt);
        
        return {
          success: true,
          amountOut: swapResult.amountOut,
          txHash: executionResult.txHash,
          gasUsed: executionResult.gasUsed,
          gasCost: executionResult.gasCost
        };
      } else {
        return {
          success: false,
          error: executionResult.error
        };
      }

    } catch (error) {
      console.error('Swap execution failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute multiple swaps as a batch
   */
  async executeBatchSwaps(swapRequests, options = {}) {
    if (!this.initialized) {
      throw new Error('Swap executor not initialized');
    }

    const {
      maxBatchSize = 10,
      continueOnFailure = false,
      parallelExecution = false
    } = options;

    if (swapRequests.length > maxBatchSize) {
      throw new Error(`Batch size ${swapRequests.length} exceeds maximum ${maxBatchSize}`);
    }

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const results = [];

    console.log(`Starting batch swap execution ${batchId} with ${swapRequests.length} swaps`);

    try {
      if (parallelExecution) {
        // Execute swaps in parallel
        const promises = swapRequests.map(async (swapRequest, index) => {
          try {
            const result = await this.executeSwap(swapRequest.params, swapRequest.options);
            return { index, success: true, result };
          } catch (error) {
            return { index, success: false, error: error.message };
          }
        });

        const parallelResults = await Promise.allSettled(promises);
        
        for (const promiseResult of parallelResults) {
          if (promiseResult.status === 'fulfilled') {
            results.push(promiseResult.value);
          } else {
            results.push({ 
              success: false, 
              error: promiseResult.reason?.message || 'Unknown error' 
            });
          }
        }
      } else {
        // Execute swaps sequentially
        for (let i = 0; i < swapRequests.length; i++) {
          const swapRequest = swapRequests[i];
          
          try {
            const result = await this.executeSwap(swapRequest.params, swapRequest.options);
            results.push({ index: i, success: true, result });
          } catch (error) {
            const failure = { index: i, success: false, error: error.message };
            results.push(failure);
            
            if (!continueOnFailure) {
              console.error(`Batch swap ${batchId} stopped at index ${i} due to failure:`, error.message);
              break;
            }
          }
        }
      }

      const successfulSwaps = results.filter(r => r.success).length;
      const failedSwaps = results.length - successfulSwaps;

      console.log(`Batch swap ${batchId} completed: ${successfulSwaps} successful, ${failedSwaps} failed`);

      return {
        success: failedSwaps === 0 || continueOnFailure,
        batchId,
        results,
        summary: {
          total: swapRequests.length,
          successful: successfulSwaps,
          failed: failedSwaps,
          successRate: (successfulSwaps / swapRequests.length) * 100
        }
      };

    } catch (error) {
      console.error(`Batch swap ${batchId} failed:`, error);
      throw error;
    }
  }

  /**
   * Get optimal fee tier for a token pair
   */
  async getOptimalFeeTier(tokenA, tokenB) {
    // Check liquidity in different fee tiers
    const feeTiers = [FEE_TIERS.MEDIUM, FEE_TIERS.LOW, FEE_TIERS.HIGH];
    
    for (const fee of feeTiers) {
      try {
        // Try to get a quote with this fee tier
        const testAmount = parseUnits('1', 18); // Test with 1 token
        
        const quoteCalldata = encodeFunctionData({
          abi: QUOTER_V2_ABI,
          functionName: 'quoteExactInputSingle',
          args: [tokenA, tokenB, fee, testAmount, 0n]
        });

        const result = await monadClient.call({
          to: CONTRACTS.QuoterV2,
          data: quoteCalldata
        });

        if (result.data && result.data !== '0x') {
          console.log(`Using fee tier ${fee} for ${tokenA} -> ${tokenB}`);
          return fee;
        }
      } catch (error) {
        // Continue to next fee tier
        continue;
      }
    }

    // Default to medium fee tier if no liquidity found
    console.warn(`No liquidity found for ${tokenA} -> ${tokenB}, using default fee tier`);
    return FEE_TIERS.MEDIUM;
  }

  /**
   * Calculate price impact of a swap
   */
  async calculatePriceImpact(amountIn, amountOut, tokenIn, tokenOut) {
    try {
      // Get spot price (small amount)
      const spotAmount = parseUnits('0.001', 18); // Very small amount for spot price
      
      const spotQuoteCalldata = encodeFunctionData({
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        args: [tokenIn, tokenOut, FEE_TIERS.MEDIUM, spotAmount, 0n]
      });

      const spotResult = await monadClient.call({
        to: CONTRACTS.QuoterV2,
        data: spotQuoteCalldata
      });

      const [spotAmountOut] = decodeFunctionResult({
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        data: spotResult.data
      });

      // Calculate spot price and execution price
      const spotPrice = Number(formatUnits(spotAmountOut * BigInt(1000), 18)) / Number(formatUnits(spotAmount, 18));
      const executionPrice = Number(formatUnits(amountOut, 18)) / Number(formatUnits(amountIn, 18));

      // Calculate price impact
      const priceImpact = Math.abs((executionPrice - spotPrice) / spotPrice) * 100;
      
      return priceImpact;
    } catch (error) {
      console.warn('Failed to calculate price impact:', error);
      return 0; // Return 0 if calculation fails
    }
  }

  /**
   * Calculate actual slippage from execution
   */
  calculateActualSlippage(swap) {
    if (!swap.quote || swap.quote.amountOut === 0n) return 0;
    
    const expectedOutput = Number(formatUnits(swap.quote.amountOut, swap.params.tokenOutDecimals));
    const actualOutput = Number(formatUnits(swap.actualOutput, swap.params.tokenOutDecimals));
    
    return ((expectedOutput - actualOutput) / expectedOutput) * 100;
  }

  /**
   * Parse swap result from transaction receipt
   */
  async parseSwapResult(receipt) {
    try {
      const swapTopic = keccak256('Swap(address,address,int256,int256,uint160,uint128,int24)');
      const swapLog = receipt.logs.find(log => log.topics[0] === swapTopic);
  
      if (!swapLog) {
        console.warn('No Swap event found in receipt');
        return { amountOut: 0n, amountIn: 0n, fee: 0, tick: 0 };
      }
  
      const decoded = decodeEventLog({
        abi: UniswapV3PoolABI,
        data: swapLog.data,
        topics: swapLog.topics
      });
  
      const amount0 = decoded.args.amount0;
      const amount1 = decoded.args.amount1;
  
      return {
        amountIn: amount0 < 0n ? -amount0 : amount1 < 0n ? -amount1 : 0n,
        amountOut: amount0 > 0n ? amount0 : amount1 > 0n ? amount1 : 0n,
        fee: 0, // not in event
        tick: decoded.args.tick
      };
    } catch (error) {
      console.error('Failed to parse swap result:', error);
      return { amountOut: 0n, amountIn: 0n, fee: 0, tick: 0 };
    }
  }
  

  /**
   * Validate swap parameters
   */
  validateSwapParams(params) {
    const errors = [];

    // Validate addresses
    if (!validateAddress(params.tokenIn).isValid) {
      errors.push('Invalid tokenIn address');
    }
    if (!validateAddress(params.tokenOut).isValid) {
      errors.push('Invalid tokenOut address');
    }
    if (!validateAddress(params.account).isValid) {
      errors.push('Invalid account address');
    }
    if (!validateAddress(params.recipient).isValid) {
      errors.push('Invalid recipient address');
    }

    // Validate amounts
    if (!validateTokenAmount(params.amountIn, params.tokenInDecimals).isValid) {
      errors.push('Invalid amountIn');
    }

    // Check if tokens are different
    if (params.tokenIn.toLowerCase() === params.tokenOut.toLowerCase()) {
      errors.push('TokenIn and tokenOut must be different');
    }

    // Validate supported tokens
    const tokenInInfo = Object.values(SUPPORTED_TOKENS).find(
      t => t.address.toLowerCase() === params.tokenIn.toLowerCase()
    );
    const tokenOutInfo = Object.values(SUPPORTED_TOKENS).find(
      t => t.address.toLowerCase() === params.tokenOut.toLowerCase()
    );

    if (!tokenInInfo) {
      errors.push('TokenIn not supported');
    }
    if (!tokenOutInfo) {
      errors.push('TokenOut not supported');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate contract addresses
   */
  async validateContracts() {
    const contractsToValidate = [
      { name: 'SwapRouter02', address: CONTRACTS.SwapRouter02 },
      { name: 'QuoterV2', address: CONTRACTS.QuoterV2 }
    ];

    for (const contract of contractsToValidate) {
      try {
        const code = await monadClient.getBytecode({ address: contract.address });
        if (!code || code === '0x') {
          throw new Error(`Contract ${contract.name} not deployed at ${contract.address}`);
        }
      } catch (error) {
        throw new Error(`Failed to validate contract ${contract.name}: ${error.message}`);
      }
    }

    console.log('All Uniswap V3 contracts validated successfully');
  }

  /**
   * Start price impact monitoring
   */
  startPriceImpactMonitoring() {
    // Clear cache every 5 minutes to ensure fresh data
    setInterval(() => {
      this.priceImpactCache.clear();
      this.gasEstimateCache.clear();
      console.log('Price impact and gas estimate caches cleared');
    }, 5 * 60 * 1000);
  }

  /**
   * Generate unique swap ID
   */
  
  generateSwapId(params) {
    const key = `${params.tokenIn}-${params.tokenOut}-${params.amountIn}-${Date.now()}`;
    const encoded = safeBase64Encode(key);
    return `swap_${encoded.replace(/[^a-zA-Z0-9]/g, '').substring(0, 32)}`;
  }
  
  /**
   * Record swap in history
   */
  recordSwapHistory(swap) {
    const tokenPair = `${swap.params.tokenInSymbol}_${swap.params.tokenOutSymbol}`;
    
    if (!this.swapHistory.has(tokenPair)) {
      this.swapHistory.set(tokenPair, []);
    }
    
    const history = this.swapHistory.get(tokenPair);
    history.push({
      id: swap.id,
      timestamp: swap.completedAt,
      amountIn: swap.params.amountIn,
      amountOut: swap.actualOutput,
      priceImpact: swap.quote?.priceImpact || 0,
      slippage: swap.slippage,
      gasUsed: swap.gasUsed,
      gasCost: swap.gasCost,
      executionTime: swap.completedAt - swap.startedAt,
      status: swap.status
    });
    
    // Keep only last 100 swaps per pair
    if (history.length > 100) {
      this.swapHistory.set(tokenPair, history.slice(-100));
    }
  }

  /**
   * Get swap statistics for a token pair
   */
  getSwapStats(tokenA, tokenB) {
    const tokenPair = `${tokenA}_${tokenB}`;
    const reverseTokenPair = `${tokenB}_${tokenA}`;
    
    const history = [
      ...(this.swapHistory.get(tokenPair) || []),
      ...(this.swapHistory.get(reverseTokenPair) || [])
    ];

    if (history.length === 0) {
      return {
        totalSwaps: 0,
        successRate: 0,
        averagePriceImpact: 0,
        averageSlippage: 0,
        averageGasCost: 0,
        averageExecutionTime: 0
      };
    }

    const successfulSwaps = history.filter(h => h.status === SWAP_STATUS.COMPLETED);
    const totalPriceImpact = successfulSwaps.reduce((sum, h) => sum + h.priceImpact, 0);
    const totalSlippage = successfulSwaps.reduce((sum, h) => sum + h.slippage, 0);
    const totalGasCost = successfulSwaps.reduce((sum, h) => sum + Number(formatUnits(h.gasCost, 18)), 0);
    const totalExecutionTime = successfulSwaps.reduce((sum, h) => sum + h.executionTime, 0);

    return {
      totalSwaps: history.length,
      successfulSwaps: successfulSwaps.length,
      successRate: (successfulSwaps.length / history.length) * 100,
      averagePriceImpact: totalPriceImpact / successfulSwaps.length,
      averageSlippage: totalSlippage / successfulSwaps.length,
      averageGasCost: totalGasCost / successfulSwaps.length,
      averageExecutionTime: totalExecutionTime / successfulSwaps.length,
      last24Hours: this.getRecentSwapStats(tokenPair, 24 * 60 * 60 * 1000)
    };
  }

  /**
   * Get recent swap statistics
   */
  getRecentSwapStats(tokenPair, timeWindow) {
    const cutoff = Date.now() - timeWindow;
    const history = this.swapHistory.get(tokenPair) || [];
    const recentSwaps = history.filter(h => h.timestamp > cutoff);

    if (recentSwaps.length === 0) {
      return {
        count: 0,
        volume: 0,
        averageSize: 0,
        largestSwap: 0
      };
    }

    const volumes = recentSwaps.map(h => Number(formatUnits(h.amountIn, 18)));
    const totalVolume = volumes.reduce((sum, v) => sum + v, 0);
    const largestSwap = Math.max(...volumes);

    return {
      count: recentSwaps.length,
      volume: totalVolume,
      averageSize: totalVolume / recentSwaps.length,
      largestSwap
    };
  }

  /**
   * Get active swap information
   */
  getActiveSwaps() {
    return Array.from(this.activeSwaps.values()).map(swap => ({
      id: swap.id,
      tokenPair: `${swap.params.tokenInSymbol}/${swap.params.tokenOutSymbol}`,
      amountIn: formatTokenAmount(swap.params.amountIn, swap.params.tokenInDecimals),
      status: swap.status,
      startedAt: swap.startedAt,
      duration: Date.now() - swap.startedAt,
      retryCount: swap.retryCount
    }));
  }

  /**
   * Cancel an active swap
   */
  async cancelSwap(swapId, reason = 'manual_cancellation') {
    const swap = this.activeSwaps.get(swapId);
    if (!swap) {
      throw new Error('Swap not found or already completed');
    }

    if (swap.status === SWAP_STATUS.EXECUTING) {
      throw new Error('Cannot cancel swap that is currently executing');
    }

    swap.status = SWAP_STATUS.CANCELLED;
    swap.error = `Cancelled: ${reason}`;
    swap.completedAt = Date.now();

    this.recordSwapHistory(swap);
    this.activeSwaps.delete(swapId);

    console.log(`Swap ${swapId} cancelled: ${reason}`);

    return {
      success: true,
      swapId,
      reason
    };
  }

  /**
   * Estimate swap gas costs
   */
  async estimateSwapGas(swapParams, options = {}) {
    const cacheKey = `${swapParams.tokenIn}-${swapParams.tokenOut}-${swapParams.amountIn}`;
    
    // Check cache first
    const cached = this.gasEstimateCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30000) { // 30 second cache
      return cached.estimate;
    }

    try {
      // Get quote first to determine fee tier
      const quoteResult = await this.getSwapQuote(swapParams, options);
      if (!quoteResult.success) {
        throw new Error(`Failed to get quote for gas estimation: ${quoteResult.error}`);
      }

      // Prepare swap call for gas estimation
      const swapCallParams = {
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        fee: quoteResult.quote.feeTier,
        recipient: swapParams.recipient,
        deadline: Math.floor(Date.now() / 1000) + 300,
        amountIn: swapParams.amountIn,
        amountOutMinimum: quoteResult.quote.minAmountOut,
        sqrtPriceLimitX96: 0n
      };

      const swapCalldata = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [swapCallParams]
      });

      // Estimate gas using Monad gas estimator
      const gasEstimate = await gasEstimator.estimateOperationGas('uniswap_swap', {
        to: CONTRACTS.SwapRouter02,
        data: swapCalldata,
        value: 0n,
        from: swapParams.account
      });

      // Cache the result
      this.gasEstimateCache.set(cacheKey, {
        estimate: gasEstimate,
        timestamp: Date.now()
      });

      return gasEstimate;

    } catch (error) {
      console.error('Gas estimation failed:', error);
      
      // Return conservative estimate if estimation fails
      const bufferedLimit = Math.min(
        Math.floor(GAS_LIMITS.singleSwap * 1.2),
        Math.floor(GAS_LIMITS.singleSwap * 1.5)
      );
      
      return {
        gasLimit: BigInt(bufferedLimit), 
        totalCostMON: Number(formatUnits(BigInt(bufferedLimit) * MONAD_CONFIG.baseFee, 18)),
        baseFee: MONAD_CONFIG.baseFee,
        priorityFee: 0n
      };
    }
  }

  /**
   * Check if a token pair has sufficient liquidity
   */
  async checkLiquidity(tokenA, tokenB, minLiquidityUSD = 10000) {
    try {
      // Test with a small amount to check if pool exists
      const testAmount = parseUnits('1', 18);
      const quoteResult = await this.getSwapQuote({
        tokenIn: tokenA,
        tokenOut: tokenB,
        amountIn: testAmount
      });

      if (!quoteResult.success) {
        return {
          sufficient: false,
          reason: 'No pool exists'
        };
      }

      // Check if price impact is reasonable for small trade
      if (quoteResult.quote.priceImpact > 1) { // 1% impact for $1 worth suggests low liquidity
        return {
          sufficient: false,
          reason: `High price impact (${quoteResult.quote.priceImpact.toFixed(2)}%) suggests low liquidity`
        };
      }

      return {
        sufficient: true,
        feeTier: quoteResult.quote.feeTier,
        priceImpactFor1USD: quoteResult.quote.priceImpact
      };

    } catch (error) {
      return {
        sufficient: false,
        reason: `Liquidity check failed: ${error.message}`
      };
    }
  }

  /**
   * Get optimal swap route for a token pair
   */
  async getOptimalRoute(tokenA, tokenB, amountIn) {
    // For now, only support direct swaps
    // In production, this would check multi-hop routes for better prices
    
    const directRoute = {
      path: [tokenA, tokenB],
      pools: [{ tokenA, tokenB, fee: await this.getOptimalFeeTier(tokenA, tokenB) }],
      hops: 1
    };

    return {
      success: true,
      routes: [directRoute],
      recommended: directRoute
    };
  }

  /**
   * Utility function for delays
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get service health and statistics
   */
  getServiceHealth() {
    const now = Date.now();
    const last24h = now - (24 * 60 * 60 * 1000);
    
    let totalSwaps24h = 0;
    let successfulSwaps24h = 0;
    let totalVolume24h = 0;
    let totalGasSpent24h = 0;

    for (const history of this.swapHistory.values()) {
      const recent = history.filter(h => h.timestamp > last24h);
      totalSwaps24h += recent.length;
      successfulSwaps24h += recent.filter(h => h.status === SWAP_STATUS.COMPLETED).length;
      totalVolume24h += recent.reduce((sum, h) => sum + Number(formatUnits(h.amountIn, 18)), 0);
      totalGasSpent24h += recent.reduce((sum, h) => sum + Number(formatUnits(h.gasCost, 18)), 0);
    }

    return {
      initialized: this.initialized,
      activeSwaps: this.activeSwaps.size,
      metrics24h: {
        totalSwaps: totalSwaps24h,
        successfulSwaps: successfulSwaps24h,
        successRate: totalSwaps24h > 0 ? (successfulSwaps24h / totalSwaps24h) * 100 : 0,
        totalVolume: totalVolume24h,
        totalGasSpent: totalGasSpent24h,
        averageGasPerSwap: successfulSwaps24h > 0 ? totalGasSpent24h / successfulSwaps24h : 0
      },
      cache: {
        priceImpactEntries: this.priceImpactCache.size,
        gasEstimateEntries: this.gasEstimateCache.size
      },
      supportedPairs: this.swapHistory.size,
      lastActivity: Math.max(...Array.from(this.swapHistory.values()).flat().map(h => h.timestamp), 0)
    };
  }

  /**
   * Emergency stop all active swaps
   */
  async emergencyStop(reason = 'emergency_stop') {
    console.warn(`Emergency stop activated: ${reason}`);
    
    const stoppedSwaps = [];
    
    for (const [swapId, swap] of this.activeSwaps.entries()) {
      if (swap.status !== SWAP_STATUS.EXECUTING) {
        await this.cancelSwap(swapId, reason);
        stoppedSwaps.push(swapId);
      }
    }
    
    console.log(`Emergency stop completed: ${stoppedSwaps.length} swaps cancelled`);
    
    return {
      success: true,
      cancelledSwaps: stoppedSwaps.length,
      reason
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.activeSwaps.clear();
    this.swapHistory.clear();
    this.priceImpactCache.clear();
    this.gasEstimateCache.clear();
    this.initialized = false;
    
    console.log('SwapExecutorService destroyed');
  }
}

// Create singleton instance
const swapExecutor = new SwapExecutorService();

// Helper functions for common operations
export const executeSwap = (swapParams, options) => 
  swapExecutor.executeSwap(swapParams, options);

export const executeBatchSwaps = (swapRequests, options) => 
  swapExecutor.executeBatchSwaps(swapRequests, options);

export const getSwapQuote = (swapParams, options) => 
  swapExecutor.getSwapQuote(swapParams, options);

export const ensureTokenApproval = (swapParams, options) => 
  swapExecutor.ensureTokenApproval(swapParams, options);

export const getSwapStats = (tokenA, tokenB) => 
  swapExecutor.getSwapStats(tokenA, tokenB);

export const getActiveSwaps = () => 
  swapExecutor.getActiveSwaps();

export const cancelSwap = (swapId, reason) => 
  swapExecutor.cancelSwap(swapId, reason);

export const estimateSwapGas = (swapParams, options) => 
  swapExecutor.estimateSwapGas(swapParams, options);

export const checkLiquidity = (tokenA, tokenB, minLiquidityUSD) => 
  swapExecutor.checkLiquidity(tokenA, tokenB, minLiquidityUSD);

export const getSwapServiceHealth = () => 
  swapExecutor.getServiceHealth();

// Export main class, singleton, and constants
export { 
  SwapExecutorService,
  swapExecutor,
  SWAP_STATUS,
  SWAP_TYPES,
  FEE_TIERS
};