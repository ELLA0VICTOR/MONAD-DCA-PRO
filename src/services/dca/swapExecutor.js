import { parseUnits, formatUnits, encodeFunctionData, decodeFunctionResult } from 'viem';
import { monadClient } from '../monad/monadClient.js';
import { gasEstimator } from '../monad/gasEstimator.js';
import { hexToBytes } from 'viem';
import { userOperationsService } from '../smartAccount/userOperations.js';
import { validateTokenAmount, validateSlippage, validateAddress } from '../../utils/validators.js';
import { formatTokenAmount, formatPrice, formatPercentage } from '../../utils/formatters.js';
import { 
  CONTRACTS, 
  SUPPORTED_TOKENS, 
  GAS_LIMITS, 
  FASTLANE_CONFIG,
  MONAD_CONFIG,
  DCA_CONFIG 
} from '../../utils/constants.js';
import { keccak256, decodeEventLog } from 'viem';
import UniswapV3PoolABI from '../../contracts/abis/UniswapV3Pool.json';
import ERC20_ABI from '../../contracts/abis/ERC20.json';
import SWAP_ROUTER_JSON from '../../contracts/abis/SwapRouter02.json';
const SWAP_ROUTER_ABI = Array.isArray(SWAP_ROUTER_JSON) ? SWAP_ROUTER_JSON : SWAP_ROUTER_JSON.abi;
// ✅ CRITICAL DEBUG: Verify FASTLANE_CONFIG is loaded correctly
console.log('🔍 swapExecutor.js - FASTLANE_CONFIG on load:', {
  exists: !!FASTLANE_CONFIG,
  sponsorEOA: FASTLANE_CONFIG?.SPONSOR_EOA,
  allKeys: Object.keys(FASTLANE_CONFIG || {})
});



function safeBase64Encode(str) {
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str, 'utf-8').toString('base64');
    } else if (typeof btoa !== 'undefined') {
      return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
    } else {
      throw new Error('No base64 encoder available');
    }
  } catch (e) {
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

// Fee tiers for Uniswap V3 pools
const FEE_TIERS = {
  LOW: 500,      // 0.05%
  MEDIUM: 3000,  // 0.3%
  HIGH: 10000    // 1%
};

/**
 * Swap Executor Service
 * Handles token swaps on Uniswap V3 (NO ORACLE DEPENDENCIES)
 */
class SwapExecutorService {
  constructor() {
    this.activeSwaps = new Map();
    this.swapHistory = new Map();
    this.gasEstimateCache = new Map();
    this.initialized = false;
  }

  /**
   * Initialize the swap executor
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await this.validateContracts();
      this.initialized = true;
      console.log('SwapExecutorService initialized (No Oracle Mode)');
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
        slippage: 0,
        txHash: null,
        error: null,
        retryCount: 0
      };

      this.activeSwaps.set(swapId, swap);

      console.log(`Starting swap ${swapId}: ${formatTokenAmount(swapParams.amountIn, swapParams.tokenInDecimals)} ${swapParams.tokenInSymbol} → ${swapParams.tokenOutSymbol}`);

      // Step 1: Get quote
      if (!skipQuote) {
        const quoteResult = await this.getSwapQuote(swapParams, { maxSlippage, deadline });
        if (!quoteResult.success) {
          throw new Error(`Quote failed: ${quoteResult.error}`);
        }
        
        swap.quote = quoteResult.quote;
        swap.status = SWAP_STATUS.QUOTE_OBTAINED;
        
        console.log(`Quote obtained: ${formatTokenAmount(swap.quote.amountOut, swapParams.tokenOutDecimals)} ${swapParams.tokenOutSymbol}`);
      }
      // Step 3: Execute swap
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
            executionTime: swap.completedAt - swap.startedAt
          }
        };
      } else {
        swap.status = SWAP_STATUS.FAILED;
        swap.error = executionResult.error;
        swap.completedAt = Date.now();

        if (retryOnFailure && swap.retryCount < maxRetries) {
          console.warn(`Swap ${swapId} failed, retrying (${swap.retryCount + 1}/${maxRetries})`);
          swap.retryCount++;
          await this.delay(Math.pow(2, swap.retryCount) * 1000);
          return this.executeSwap(swapParams, { ...options, retryOnFailure: swap.retryCount < maxRetries });
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
  async safeCall({ to, data }) {
    try {
      const res = await monadClient.publicClient.call({ to, data });
      if (res instanceof Uint8Array) {
        return bytesToHex(res);
      }
      return res;
    } catch (err) {
      console.error('monadClient.call failed:', err);
      throw err;
    }
  }
  
  /**
 * Get swap quote DIRECTLY from pool (bypassing QuoterV2)
 */
  async getSwapQuote(swapParams, options = {}) {
    if (!swapParams?.tokenIn || !swapParams?.tokenOut) {
      console.warn('Missing token addresses in getSwapQuote');
      return { success: false, error: 'Missing token addresses' };
    }
  
    const { maxSlippage = DCA_CONFIG.DEFAULT_SLIPPAGE } = options;
  
    try {
      // Normalize token addresses
      let tokenInAddress = swapParams.tokenIn;
      let tokenOutAddress = swapParams.tokenOut;
      
      const isZeroOrNative = (addr) => 
        !addr || 
        addr === '0x0000000000000000000000000000000000000000' ||
        addr.toLowerCase() === '0x0000000000000000000000000000000000000000';
      
      if (isZeroOrNative(tokenInAddress)) {
        tokenInAddress = CONTRACTS.WMON;
        console.log('🔄 Converting native MON to WMON for tokenIn');
      }
      
      if (isZeroOrNative(tokenOutAddress)) {
        tokenOutAddress = CONTRACTS.WMON;
        console.log('🔄 Converting native MON to WMON for tokenOut');
      }
  
      if (!tokenInAddress || !tokenOutAddress) {
        return { 
          success: false, 
          error: 'Invalid token addresses after normalization'
        };
      }
  
      if (tokenInAddress.toLowerCase() === tokenOutAddress.toLowerCase()) {
        return {
          success: false,
          error: 'Cannot swap token to itself'
        };
      }
  
      if (!swapParams.amountIn || swapParams.amountIn === 0n) {
        return {
          success: false,
          error: 'Amount must be greater than zero'
        };
      }
  
      // Step 1: Find pool with liquidity
      let feeTier;
      let poolAddress;
      try {
        const poolData = await this.getOptimalFeeTierWithAddress(tokenInAddress, tokenOutAddress);
        feeTier = poolData.fee;
        poolAddress = poolData.poolAddress;
      } catch (error) {
        console.error('❌ No liquidity pool found:', error);
        return { 
          success: false, 
          error: `No liquidity available for this token pair`
        };
      }
  
      console.log(`📊 Getting quote for ${swapParams.amountIn.toString()} using fee tier ${feeTier}`);
      console.log(`📊 Pool address: ${poolAddress}`);
  
      // Step 2: Get quote DIRECTLY from pool using slot0 and liquidity
      const poolABI = [
        {
          inputs: [],
          name: 'slot0',
          outputs: [
            { name: 'sqrtPriceX96', type: 'uint160' },
            { name: 'tick', type: 'int24' },
            { name: 'observationIndex', type: 'uint16' },
            { name: 'observationCardinality', type: 'uint16' },
            { name: 'observationCardinalityNext', type: 'uint16' },
            { name: 'feeProtocol', type: 'uint8' },
            { name: 'unlocked', type: 'bool' }
          ],
          stateMutability: 'view',
          type: 'function'
        },
        {
          inputs: [],
          name: 'liquidity',
          outputs: [{ name: '', type: 'uint128' }],
          stateMutability: 'view',
          type: 'function'
        },
        {
          inputs: [],
          name: 'token0',
          outputs: [{ name: '', type: 'address' }],
          stateMutability: 'view',
          type: 'function'
        },
        {
          inputs: [],
          name: 'token1',
          outputs: [{ name: '', type: 'address' }],
          stateMutability: 'view',
          type: 'function'
        }
      ];
  
      // Get pool data
      const [slot0Result, liquidityResult, token0Result, token1Result] = await Promise.all([
        this.safeCall({
          to: poolAddress,
          data: encodeFunctionData({
            abi: poolABI,
            functionName: 'slot0',
            args: []
          })
        }),
        this.safeCall({
          to: poolAddress,
          data: encodeFunctionData({
            abi: poolABI,
            functionName: 'liquidity',
            args: []
          })
        }),
        this.safeCall({
          to: poolAddress,
          data: encodeFunctionData({
            abi: poolABI,
            functionName: 'token0',
            args: []
          })
        }),
        this.safeCall({
          to: poolAddress,
          data: encodeFunctionData({
            abi: poolABI,
            functionName: 'token1',
            args: []
          })
        })
      ]);
  
      // ✅ FIX: Proper decoding without destructuring issues
      const slot0Decoded = decodeFunctionResult({
        abi: poolABI,
        functionName: 'slot0',
        data: slot0Result.data
      });
      const sqrtPriceX96 = Array.isArray(slot0Decoded) ? slot0Decoded[0] : slot0Decoded;
  
      const liquidityDecoded = decodeFunctionResult({
        abi: poolABI,
        functionName: 'liquidity',
        data: liquidityResult.data
      });
      const liquidity = Array.isArray(liquidityDecoded) ? liquidityDecoded[0] : liquidityDecoded;
  
      const token0Decoded = decodeFunctionResult({
        abi: poolABI,
        functionName: 'token0',
        data: token0Result.data
      });
      const token0Address = Array.isArray(token0Decoded) ? token0Decoded[0] : token0Decoded;
  
      const token1Decoded = decodeFunctionResult({
        abi: poolABI,
        functionName: 'token1',
        data: token1Result.data
      });
      const token1Address = Array.isArray(token1Decoded) ? token1Decoded[0] : token1Decoded;
  
      console.log(`📊 Pool state: sqrtPrice=${sqrtPriceX96}, liquidity=${liquidity}`);
      console.log(`📊 Pool tokens: ${token0Address} / ${token1Address}`);
  
      // Validate we got valid data
      if (!sqrtPriceX96 || sqrtPriceX96 === 0n) {
        return {
          success: false,
          error: 'Invalid pool price data'
        };
      }
  
      if (!liquidity || liquidity === 0n) {
        return {
          success: false,
          error: 'Pool has no liquidity'
        };
      }
  
      // Calculate output amount using the pool's current price
      // Determine if tokenIn is token0 or token1
      const isToken0In = tokenInAddress.toLowerCase() === token0Address.toLowerCase();
      
      console.log(`📊 Swap direction: ${isToken0In ? 'token0 → token1' : 'token1 → token0'}`);
  
      let amountOut;
      
      try {
        const Q96 = 2n ** 96n;
        const priceSquared = (sqrtPriceX96 * sqrtPriceX96) / Q96; // Price in Q96 format
        
        if (isToken0In) {
          // Selling token0 for token1
          // amountOut = amountIn * price
          amountOut = (swapParams.amountIn * priceSquared) / Q96;
        } else {
          // Selling token1 for token0
          // amountOut = amountIn / price
          amountOut = (swapParams.amountIn * Q96) / priceSquared;
        }
  
        // Apply fee deduction
        // Fee is in hundredths of a bip, so 500 = 0.05%
        const feeBps = BigInt(feeTier);
        const feeMultiplier = 1000000n - feeBps;
        amountOut = (amountOut * feeMultiplier) / 1000000n;
  
        console.log(`📊 Calculated output (before slippage): ${amountOut.toString()}`);
  
      } catch (mathError) {
        console.error('Math calculation error:', mathError);
        return {
          success: false,
          error: 'Failed to calculate swap output'
        };
      }
  
      // Validate output
      if (!amountOut || amountOut === 0n) {
        return {
          success: false,
          error: 'Calculated quote returned zero output'
        };
      }
  
      // Calculate minimum output with slippage
      const slippageBps = BigInt(Math.floor(maxSlippage * 10000));
      const minAmountOut = (amountOut * (10000n - slippageBps)) / 10000n;
  
      const quote = {
        amountOut,
        minAmountOut,
        feeTier,
        poolAddress,
        sqrtPriceX96,
        liquidity,
        gasEstimate: 200000, // Estimated
        timestamp: Date.now(),
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress
      };
  
      console.log(`✅ Quote success: ${amountOut.toString()} output (min: ${minAmountOut.toString()})`);
  
      return { success: true, quote };
  
    } catch (error) {
      console.error('❌ Failed to get swap quote:', error);
      
      let errorMessage = 'Failed to get quote';
      if (error.message?.includes('execution reverted')) {
        errorMessage = 'Pool error - try different amount or pair';
      } else if (error.message?.includes('RPC')) {
        errorMessage = 'Network error - please try again';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return { 
        success: false, 
        error: errorMessage
      };
    }
  }

  /**
 * Check token approval status (HELPER METHOD - Does NOT send transaction)
 * This method only CHECKS if approval is sufficient
 * Actual approval is handled in performSwap() as part of the batch transaction
 */
  async ensureTokenApproval(swapParams, options = {}) {
    const { forceApproval = false } = options;

  // 🧩 Skip approval for native or wrapped MON tokens
  try {
    const tokenInfo = Object.values(SUPPORTED_TOKENS).find(
      t => t.address?.toLowerCase() === swapParams.tokenIn?.toLowerCase()
    );
  
    if (tokenInfo?.isNative) {
      console.log(`⚡ Skipping approval check for native/wrapped MON token (${tokenInfo.symbol})`);
      return { 
        success: true, 
        approvalNeeded: false, 
        currentAllowance: 0n,
        sufficient: true 
      };
    }
  } catch (lookupError) {
    console.warn('⚠️ Token lookup failed in ensureTokenApproval:', lookupError);
  }

  try {
    // ✅ Use smart account address
    const accountAddress = swapParams.smartAccount?.address;
    if (!accountAddress) {
      throw new Error('Smart account address is required');
    }

    // --- Check current allowance ---
    const allowanceCalldata = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [accountAddress, CONTRACTS.SwapRouter02]
    });

    const allowanceResult = await this.safeCall({
      to: swapParams.tokenIn,
      data: allowanceCalldata
    });

    let rawData;
    if (allowanceResult && typeof allowanceResult === 'object' && 'data' in allowanceResult) {
      rawData = allowanceResult.data;
    } else {
      rawData = allowanceResult;
    }
    
    if (typeof rawData === 'string' || rawData instanceof String) {
      rawData = hexToBytes(rawData);
    }

    const decoded = decodeFunctionResult({
      abi: ERC20_ABI,
      functionName: 'allowance',
      data: rawData
    });
    
    const currentAllowance = Array.isArray(decoded)
      ? decoded[0]
      : decoded?.[0] ?? decoded;
    
    console.log('🔍 Current allowance:', currentAllowance?.toString());
    console.log('🔍 Required amount:', swapParams.amountIn?.toString());

    // --- Check if approval is sufficient ---
    const isSufficient = currentAllowance >= swapParams.amountIn && !forceApproval;

    if (isSufficient) {
      console.log('✅ Sufficient allowance already exists');
      return { 
        success: true, 
        approvalNeeded: false, 
        currentAllowance,
        sufficient: true 
      };
    } else {
      console.log(`⚠️ Insufficient allowance: current ${formatTokenAmount(currentAllowance, swapParams.tokenInDecimals)}, required ${formatTokenAmount(swapParams.amountIn, swapParams.tokenInDecimals)}`);
      console.log('📝 Approval will be included in swap batch transaction');
      
      return {
        success: true,
        approvalNeeded: true,
        currentAllowance,
        sufficient: false,
        requiredAmount: swapParams.amountIn,
        recommendedAmount: swapParams.amountIn * 2n // 2x buffer
      };
    }

  } catch (error) {
    console.error('❌ Failed to check token approval:', error);
    
    // Return failure but don't throw - let performSwap handle it
    return { 
      success: false, 
      approvalNeeded: true, // Assume approval needed if check fails
      sufficient: false,
      error: error.message,
      details: error.shortMessage || error.details || 'Unknown error'
    };
  }
}

 /**
 * Perform the actual swap execution with FASTLANE SPONSORSHIP
 */

   async performSwap(swap, enableGasOptimization = true) {
    try {
      const { params, quote } = swap;
  
      // --- Step 1: Validate Smart Account ---
      if (!params.smartAccount || !params.smartAccount.account) {
        throw new Error("Smart account object is required for swap execution");
      }
  
      console.log('🔧 Smart Account Structure:', {
        hasSmartAccount: !!params.smartAccount,
        hasAccount: !!params.smartAccount.account,
        hasAddress: !!params.smartAccount.address,
        accountAddress: params.smartAccount.address
      });
  
      // --- Step 2: Prepare swap parameters ---
      const swapParams = {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: Number(quote.feeTier),
        recipient: params.recipient || params.smartAccount.address,
        deadline: BigInt(params.deadline || Math.floor(Date.now() / 1000) + 300),
        amountIn: BigInt(params.amountIn),
        amountOutMinimum: BigInt(quote.minAmountOut),
        sqrtPriceLimitX96: 0n,
      };
  
      console.log('📋 Swap Parameters:', {
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        fee: swapParams.fee,
        amountIn: swapParams.amountIn.toString(),
        minOut: swapParams.amountOutMinimum.toString()
      });
  
      // --- Step 3: Encode swap calldata ---
      const swapCalldata = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [swapParams],
      });
  
      // --- Step 4: Build calls (approval if needed) ---
      const tokenInfo = Object.values(SUPPORTED_TOKENS).find(
        t => t.address?.toLowerCase() === params.tokenIn?.toLowerCase()
      );
  
      let calls = [];
  
      if (tokenInfo?.isNative || params.tokenIn?.toLowerCase() === CONTRACTS.WMON?.toLowerCase()) {
        console.log('⚡ Native/WMON swap - no approval needed');
        calls = [{
          to: CONTRACTS.SwapRouter02,
          data: swapCalldata,
          value: 0n,
        }];
      } else {
        console.log('🔓 ERC-20 swap - including approval call');
        const approvalAmount = params.amountIn * 2n;
        const approvalCalldata = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [CONTRACTS.SwapRouter02, approvalAmount]
        });
  
        calls = [
          { to: params.tokenIn, data: approvalCalldata, value: 0n },
          { to: CONTRACTS.SwapRouter02, data: swapCalldata, value: 0n }
        ];
      }
  
      // --- Step 5: Get bundler client instance (singleton) ---
      const { bundlerClient } = await import('../smartAccount/bundlerClient.js');
  
      // --- Step 6: Get paymaster address (Fastlane) ---
      const paymasterAddress = await bundlerClient.getPaymasterAddress();
      if (!paymasterAddress) {
        throw new Error('Failed to get paymaster address');
      }
      console.log('💰 Paymaster address:', paymasterAddress);
  
      // --- Step 7: Create smart account client (no paymaster attached here) ---
      console.log('🔧 Creating smart account client...');
      let client = await bundlerClient.createSmartAccountClient(params.smartAccount.account, {
        sponsorUserOperation: false
      });
  
      if (!client.account) {
        throw new Error('Client is missing account property');
      }
  
      console.log('✅ Client created:', {
        clientAddress: client.account.address,
        expectedAddress: params.smartAccount.address
      });
  
      // --- Step 8: Get gas prices ---
      const gasPrice = await bundlerClient.getUserOperationGasPrice();
      const gasPricing = gasPrice.fast;
  
      console.log('💰 Gas pricing:', {
        maxFeePerGas: gasPricing.maxFeePerGas.toString(),
        maxPriorityFeePerGas: gasPricing.maxPriorityFeePerGas.toString()
      });
  
      // --- Step 9: Get gas estimates BEFORE preparing userOp ---
      const gasEstimate = await bundlerClient.estimateUserOperationGas({
        calls,
        account: client.account
      });
  
      console.log('⛽ Gas estimates:', {
        callGasLimit: gasEstimate.callGasLimit.toString(),
        verificationGasLimit: gasEstimate.verificationGasLimit.toString(),
        preVerificationGas: gasEstimate.preVerificationGas.toString()
      });
  
      // --- Step 10: Prepare UserOp for sponsor signature ---
      console.log('📦 Preparing UserOp for sponsor signature...');
      
      const tempUserOp = await client.prepareUserOperation({
        calls,
        account: client.account,
        callGasLimit: gasEstimate.callGasLimit,
        verificationGasLimit: gasEstimate.verificationGasLimit,
        preVerificationGas: gasEstimate.preVerificationGas,
        maxFeePerGas: gasPricing.maxFeePerGas,
        maxPriorityFeePerGas: gasPricing.maxPriorityFeePerGas
      });
  
      // Pack it for sponsor signature
      const { toPackedUserOperation } = await import('viem/account-abstraction');
      const packedUserOp = toPackedUserOperation(tempUserOp);
  
      // Get sponsor signature
      const { preparePaymasterContext } = await import('../smartAccount/paymasterHelper.js');
      const paymasterContext = await preparePaymasterContext(
        packedUserOp,
        paymasterAddress,
        BigInt(MONAD_CONFIG.chainId)
      );
  
      console.log('✅ Paymaster context prepared:', {
        hasSignature: !!paymasterContext?.sponsorSignature,
        sponsor: paymasterContext?.sponsor,
        mode: paymasterContext?.mode,
        validUntil: paymasterContext?.validUntil?.toString(),
        validAfter: paymasterContext?.validAfter?.toString()
      });
  
      // --- Step 11: ✅ CRITICAL FIX - Construct paymasterAndData manually ---
      console.log('🔧 Constructing paymasterAndData field...');
      
      // ✅ ROBUST FIX: Manual hex encoding to ensure exact byte lengths
      
      // Convert timestamps to hex with exact 6-byte padding
      const validUntilNum = Number(paymasterContext.validUntil);
      const validAfterNum = Number(paymasterContext.validAfter);
      
      // Create 6-byte hex strings (12 hex characters)
      const validUntilHex = '0x' + validUntilNum.toString(16).padStart(12, '0');
      const validAfterHex = '0x' + validAfterNum.toString(16).padStart(12, '0');
      
      console.log('🔍 Timestamp encoding:', {
        validUntil: paymasterContext.validUntil.toString(),
        validUntilHex,
        validUntilLength: validUntilHex.length - 2, // minus 0x
        validAfter: paymasterContext.validAfter.toString(),
        validAfterHex,
        validAfterLength: validAfterHex.length - 2 // minus 0x
      });
      
      // ✅ Manually construct paymasterAndData by concatenating hex strings
      const paymasterAndData = (
        paymasterAddress.toLowerCase() +
        validUntilHex.slice(2) +      // Remove 0x
        validAfterHex.slice(2) +       // Remove 0x
        paymasterContext.sponsor.toLowerCase().slice(2) +  // Remove 0x
        paymasterContext.sponsorSignature.slice(2)         // Remove 0x
      );
      
      // Add 0x prefix
      const finalPaymasterAndData = '0x' + paymasterAndData;
  
      console.log('✅ paymasterAndData constructed:', {
        fullData: finalPaymasterAndData,
        length: finalPaymasterAndData.length,
        expectedLength: 2 + (20 + 6 + 6 + 20 + 65) * 2, // 0x + 234 hex chars
        breakdown: {
          paymaster: paymasterAddress + ' (40 chars)',
          validUntil: validUntilHex + ' (12 chars)',
          validAfter: validAfterHex + ' (12 chars)',
          sponsor: paymasterContext.sponsor + ' (40 chars)',
          signature: paymasterContext.sponsorSignature.substring(0, 20) + '... (130 chars)'
        }
      });
  
      // --- Step 12: Send UserOp with paymasterAndData ---
      console.log('🚀 Sending UserOperation with paymasterAndData...');
      
      const userOpHash = await client.sendUserOperation({
        calls,
        // Gas values
        callGasLimit: gasEstimate.callGasLimit,
        verificationGasLimit: gasEstimate.verificationGasLimit,
        preVerificationGas: gasEstimate.preVerificationGas,
        maxFeePerGas: gasPricing.maxFeePerGas,
        maxPriorityFeePerGas: gasPricing.maxPriorityFeePerGas,
        // ✅ CRITICAL: Include paymasterAndData directly
        paymasterAndData: paymasterAndData
      });
  
      console.log(`⏳ UserOperation submitted: ${userOpHash}`);
  
      // --- Step 13: Wait for confirmation (receipt) ---
      console.log('⏰ Waiting for transaction confirmation...');
      const receipt = await bundlerClient.waitForUserOperationReceipt(userOpHash, 120000);
  
      if (!receipt?.success) {
        throw new Error('Swap UserOperation failed');
      }
  
      console.log(`✅ Swap executed successfully!`);
      console.log(`   Transaction: ${receipt.transactionHash}`);
  
      // --- Step 14: Parse swap results ---
      const swapResult = await this.parseSwapResult(receipt);
  
      return {
        success: true,
        amountOut: swapResult.amountOut,
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed || 0n,
        gasCost: receipt.gasCost || 0n,
        blockNumber: receipt.blockNumber,
        userOpHash
      };
  
    } catch (error) {
      console.error("❌ Swap execution failed:", error);
      return {
        success: false,
        error: error.message,
        details: error.shortMessage || error.details || 'Unknown error'
      };
    }
  }
 
      
  

  /**
 * Get optimal fee tier AND pool address for a token pair
 */
  async getOptimalFeeTierWithAddress(tokenA, tokenB) {
    if (!tokenA || !tokenB) {
      throw new Error('Missing token addresses');
    }
  
    if (tokenA.toLowerCase() === tokenB.toLowerCase()) {
      throw new Error('Cannot get pool for identical tokens');
    }
  
    const feeTiers = [FEE_TIERS.MEDIUM, FEE_TIERS.LOW, FEE_TIERS.HIGH];
    
    const factoryABI = [{
      inputs: [
        { name: 'tokenA', type: 'address' },
        { name: 'tokenB', type: 'address' },
        { name: 'fee', type: 'uint24' }
      ],
      name: 'getPool',
      outputs: [{ name: 'pool', type: 'address' }],
      stateMutability: 'view',
      type: 'function'
    }];
  
    const poolABI = [{
      inputs: [],
      name: 'liquidity',
      outputs: [{ name: '', type: 'uint128' }],
      stateMutability: 'view',
      type: 'function'
    }];
  
    console.log(`🔍 Finding optimal fee tier for ${tokenA} <-> ${tokenB}`);
  
    const poolsFound = [];
  
    for (const fee of feeTiers) {
      try {
        const getPoolCalldata = encodeFunctionData({
          abi: factoryABI,
          functionName: 'getPool',
          args: [tokenA, tokenB, fee]
        });
  
        const poolAddressResult = await this.safeCall({
          to: CONTRACTS.UniswapV3Factory,
          data: getPoolCalldata
        });
  
        const decoded = decodeFunctionResult({
          abi: factoryABI,
          functionName: 'getPool',
          data: poolAddressResult.data
        });
  
        const poolAddress = Array.isArray(decoded) ? decoded[0] : decoded;
  
        const isZeroAddress = 
          !poolAddress || 
          poolAddress === '0x' ||
          poolAddress === '0x0' ||
          poolAddress.toLowerCase() === '0x0000000000000000000000000000000000000000' ||
          BigInt(poolAddress) === 0n;
  
        if (isZeroAddress) {
          console.log(`  ❌ Fee ${fee}: No pool exists`);
          continue;
        }
  
        console.log(`  ✅ Fee ${fee}: Pool found at ${poolAddress}`);
  
        // Check pool liquidity
        let liquidity;
        try {
          const liquidityCalldata = encodeFunctionData({
            abi: poolABI,
            functionName: 'liquidity',
            args: []
          });
  
          const liquidityResult = await this.safeCall({
            to: poolAddress,
            data: liquidityCalldata
          });
  
          const liquidityDecoded = decodeFunctionResult({
            abi: poolABI,
            functionName: 'liquidity',
            data: liquidityResult.data
          });
  
          liquidity = Array.isArray(liquidityDecoded) ? liquidityDecoded[0] : liquidityDecoded;
        } catch (error) {
          console.log(`  ⚠️ Fee ${fee}: Could not check liquidity - ${error.message}`);
          continue;
        }
  
        if (liquidity && liquidity > 0n) {
          console.log(`  ✅ Fee ${fee}: Has liquidity ${liquidity.toString()}`);
          poolsFound.push({ fee, liquidity, poolAddress });
        } else {
          console.log(`  ⚠️ Fee ${fee}: Pool exists but has zero liquidity`);
        }
  
      } catch (error) {
        console.log(`  ❌ Fee ${fee}: Error - ${error.message}`);
        continue;
      }
    }
  
    if (poolsFound.length === 0) {
      throw new Error('No liquidity pools found for this token pair');
    }
  
    // Sort by liquidity descending
    poolsFound.sort((a, b) => {
      if (a.liquidity > b.liquidity) return -1;
      if (a.liquidity < b.liquidity) return 1;
      return 0;
    });
  
    const bestPool = poolsFound[0];
    console.log(`🏆 Best pool: Fee ${bestPool.fee} with liquidity ${bestPool.liquidity.toString()} at ${bestPool.poolAddress}`);
    
    return bestPool; // Returns { fee, liquidity, poolAddress }
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
        return { amountOut: 0n, amountIn: 0n };
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
        amountOut: amount0 > 0n ? amount0 : amount1 > 0n ? amount1 : 0n
      };
    } catch (error) {
      console.error('Failed to parse swap result:', error);
      return { amountOut: 0n, amountIn: 0n };
    }
  }



  /**
 * Validate swap parameters
 */
validateSwapParams(params) {
  const errors = [];

  if (!validateAddress(params.tokenIn).isValid) {
    errors.push('Invalid tokenIn address');
  }
  if (!validateAddress(params.tokenOut).isValid) {
    errors.push('Invalid tokenOut address');
  }
  
  // ✅ IMPROVED: Better validation with specific error messages
  if (!params.smartAccount) {
    errors.push('Smart account object is missing');
  } else {
    if (!params.smartAccount.address) {
      errors.push('Smart account address is missing');
    } else if (!validateAddress(params.smartAccount.address).isValid) {
      errors.push('Invalid smart account address format');
    }
    
    if (!params.smartAccount.account) {
      errors.push('Smart account instance (account property) is missing - account may need rehydration');
    }
  }
  
  if (!validateAddress(params.recipient).isValid) {
    errors.push('Invalid recipient address');
  }
  if (!validateTokenAmount(
    formatUnits(params.amountIn, params.tokenInDecimals),
    {
      decimals: params.tokenInDecimals,
      minAmount: 0.001,
      symbol: params.tokenInSymbol
    }
  ).isValid) {
    errors.push('Invalid amountIn');
  }

  if (params.tokenIn.toLowerCase() === params.tokenOut.toLowerCase()) {
    errors.push('TokenIn and tokenOut must be different');
  }

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

  // ✅ Add debug logging
  if (errors.length > 0) {
    console.error('🔍 Validation failed. SmartAccount structure:', {
      hasSmartAccount: !!params.smartAccount,
      hasAddress: !!params.smartAccount?.address,
      hasAccount: !!params.smartAccount?.account,
      smartAccountKeys: params.smartAccount ? Object.keys(params.smartAccount) : []
    });
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

  generateSwapId(params) {
    const key = `${params.tokenIn}-${params.tokenOut}-${params.amountIn}-${Date.now()}`;
    const encoded = safeBase64Encode(key);
    return `swap_${encoded.replace(/[^a-zA-Z0-9]/g, '').substring(0, 32)}`;
  }

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
      slippage: swap.slippage,
      gasUsed: swap.gasUsed,
      gasCost: swap.gasCost,
      executionTime: swap.completedAt - swap.startedAt,
      status: swap.status
    });
    
    if (history.length > 100) {
      this.swapHistory.set(tokenPair, history.slice(-100));
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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

  async checkLiquidity(tokenA, tokenB) {
    try {
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

      return {
        sufficient: true,
        feeTier: quoteResult.quote.feeTier
      };

    } catch (error) {
      return {
        sufficient: false,
        reason: `Liquidity check failed: ${error.message}`
      };
    }
  }

  getServiceHealth() {
    const now = Date.now();
    const last24h = now - (24 * 60 * 60 * 1000);
    
    let totalSwaps24h = 0;
    let successfulSwaps24h = 0;

    for (const history of this.swapHistory.values()) {
      const recent = history.filter(h => h.timestamp > last24h);
      totalSwaps24h += recent.length;
      successfulSwaps24h += recent.filter(h => h.status === SWAP_STATUS.COMPLETED).length;
    }

    return {
      initialized: this.initialized,
      activeSwaps: this.activeSwaps.size,
      metrics24h: {
        totalSwaps: totalSwaps24h,
        successfulSwaps: successfulSwaps24h,
        successRate: totalSwaps24h > 0 ? (successfulSwaps24h / totalSwaps24h) * 100 : 0
      },
      supportedPairs: this.swapHistory.size
    };
  }

  destroy() {
    this.activeSwaps.clear();
    this.swapHistory.clear();
    this.gasEstimateCache.clear();
    this.initialized = false;
    
    console.log('SwapExecutorService destroyed');
  }
}

/**
 * Lightweight gas estimation for swaps (DCA-compatible)
 * Returns a static fallback if live estimation fails.
 */
export async function estimateSwapGas({ tokenIn, tokenOut, amountIn }) {
  try {
    const swapCalldata = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [{
        tokenIn,
        tokenOut,
        fee: FEE_TIERS.MEDIUM,
        recipient: CONTRACTS.SwapRouter02,
        deadline: Math.floor(Date.now() / 1000) + 300,
        amountIn,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n
      }]
    });

    // Use the existing monad gas estimator
    const gasEstimate = await gasEstimator.estimateOperationGas('uniswap_swap', {
      calldata: swapCalldata,
      to: CONTRACTS.SwapRouter02,
      value: 0n
    });

    return {
      success: true,
      gasLimit: gasEstimate.gasLimit,
      gasPrice: gasEstimate.gasPrice,
      totalGasCost: gasEstimate.totalCost
    };
  } catch (error) {
    console.warn('[swapExecutor] estimateSwapGas failed, using fallback:', error);
    return {
      success: false,
      gasLimit: 1_000_000n,  // safe fallback
      gasPrice: 1n,
      totalGasCost: 0n
    };
  }
}

// Create singleton instance
const swapExecutor = new SwapExecutorService();

// Helper functions for common operations
export const executeSwap = (swapParams, options) => 
  swapExecutor.executeSwap(swapParams, options);

export const getSwapQuote = (swapParams, options) => 
  swapExecutor.getSwapQuote(swapParams, options);

export const ensureTokenApproval = (swapParams, options) => 
  swapExecutor.ensureTokenApproval(swapParams, options);

export const getActiveSwaps = () => 
  swapExecutor.getActiveSwaps();

export const checkLiquidity = (tokenA, tokenB) => 
  swapExecutor.checkLiquidity(tokenA, tokenB);

export const getSwapServiceHealth = () => 
  swapExecutor.getServiceHealth();

// Export main class, singleton, and constants
export { 
  SwapExecutorService,
  swapExecutor,
  SWAP_STATUS,
  FEE_TIERS,
  
};
// ✅ Automatically initialize the singleton on import
(async () => {
  try {
    console.log('Initializing SwapExecutorService...');
    await swapExecutor.initialize();
    console.log('✅ SwapExecutorService ready!');
  } catch (error) {
    console.error('❌ Failed to initialize SwapExecutorService:', error);
  }
})();
