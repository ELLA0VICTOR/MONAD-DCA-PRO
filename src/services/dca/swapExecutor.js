import { parseUnits, formatUnits, encodeFunctionData, decodeFunctionResult } from 'viem';
import { monadClient, monadTestnet } from '../monad/monadClient.js';
import { gasEstimator } from '../monad/gasEstimator.js';
import { hexToBytes } from 'viem';
import { userOperationsService } from '../smartAccount/userOperations.js';
import { validateTokenAmount, validateSlippage, validateAddress } from '../../utils/validators.js';
import { formatTokenAmount, formatPrice, formatPercentage } from '../../utils/formatters.js';
import { 
  CONTRACTS, 
  SUPPORTED_TOKENS, 
  ALCHEMY_CONFIG,
  MONAD_CONFIG,
  DCA_CONFIG 
} from '../../utils/constants.js';
import { keccak256, decodeEventLog } from 'viem';
import UniswapV3PoolABI from '../../contracts/abis/UniswapV3Pool.json';
import ERC20_ABI from '../../contracts/abis/ERC20.json';
import SWAP_ROUTER_JSON from '../../contracts/abis/SwapRouter02.json';
import { smartAccountActions } from 'permissionless';
import { call } from 'viem/actions';

const SWAP_ROUTER_ABI = Array.isArray(SWAP_ROUTER_JSON) ? SWAP_ROUTER_JSON : SWAP_ROUTER_JSON.abi;

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
 * Handles token swaps on Uniswap V3 with Alchemy Gas Manager sponsorship
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
      console.log('SwapExecutorService initialized (Alchemy Gas Manager)');
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
      maxSlippage = DCA_CONFIG.DEFAULT_SLIPPAGE,
      deadline = Math.floor(Date.now() / 1000) + 300, // 5 minutes
      enableGasOptimization = true
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
        error: null
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
  
      // Step 2: Execute swap (NO RETRY)
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
 * Safe contract call wrapper
 */
  async safeCall({ to, data }) {
    try {
      const result = await monadClient.publicClient.call({ 
        to, 
        data 
      });
      
      // Handle both string and Uint8Array responses
      if (result instanceof Uint8Array) {
        return { data: `0x${Array.from(result).map(b => b.toString(16).padStart(2, '0')).join('')}` };
      }
      
      return { data: result.data || result };
    } catch (error) {
      console.error('Contract call failed:', error);
      throw error;
    }
  }
  
  /**
   * Get swap quote DIRECTLY from pool
   */
  async getSwapQuote(swapParams, options = {}) {
    const { maxSlippage = DCA_CONFIG.DEFAULT_SLIPPAGE } = options;
  
    try {
      // ✅ 1) Normalize tokens - convert null/native to WMON
      const normalizeToken = (token) => {
        // If it's null, undefined, or "MON" symbol → use WMON address
        if (!token || 
            token === null || 
            token === undefined ||
            String(token).toUpperCase() === 'MON' ||
            token === '0x0000000000000000000000000000000000000000') {
          console.log('🔄 Normalizing native MON → WMON for pool query');
          return CONTRACTS.WMON.toLowerCase();
        }
        
        return String(token).toLowerCase();
      };
  
      const tokenInAddress = normalizeToken(swapParams.tokenIn);
      const tokenOutAddress = normalizeToken(swapParams.tokenOut);
  
      // Validation
      if (!tokenInAddress || !tokenOutAddress) {
        return { success: false, error: 'Invalid token addresses' };
      }
  
      if (tokenInAddress === tokenOutAddress) {
        return { success: false, error: 'Cannot swap token to itself' };
      }
  
      if (!swapParams.amountIn || swapParams.amountIn === 0n) {
        return { success: false, error: 'Amount must be greater than zero' };
      }
  
      // ✅ 2) Find optimal pool
      console.log(`📊 Finding pool for ${tokenInAddress} <-> ${tokenOutAddress}`);
      
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
          error: 'No liquidity available for this token pair'
        };
      }
  
      console.log(`📊 Getting quote for ${swapParams.amountIn.toString()} using fee tier ${feeTier}`);
      console.log(`📊 Pool address: ${poolAddress}`);
  
      // ✅ 3) Get pool state
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
      const token0Address = (Array.isArray(token0Decoded) ? token0Decoded[0] : token0Decoded).toLowerCase();
  
      const token1Decoded = decodeFunctionResult({
        abi: poolABI,
        functionName: 'token1',
        data: token1Result.data
      });
      const token1Address = (Array.isArray(token1Decoded) ? token1Decoded[0] : token1Decoded).toLowerCase();
  
      console.log(`📊 Pool state: sqrtPrice=${sqrtPriceX96}, liquidity=${liquidity}`);
  
      if (!sqrtPriceX96 || sqrtPriceX96 === 0n) {
        return { success: false, error: 'Invalid pool price data' };
      }
  
      if (!liquidity || liquidity === 0n) {
        return { success: false, error: 'Pool has no liquidity' };
      }
  
      // ✅ 4) Calculate output amount
      const isToken0In = tokenInAddress === token0Address;
  
      let amountOut;
      try {
        const Q96 = 2n ** 96n;
        const priceSquared = (sqrtPriceX96 * sqrtPriceX96) / Q96;
  
        if (isToken0In) {
          amountOut = (swapParams.amountIn * priceSquared) / Q96;
        } else {
          amountOut = (swapParams.amountIn * Q96) / priceSquared;
        }
  
        // Apply fee
        const feeBps = BigInt(feeTier);
        const feeMultiplier = 1000000n - feeBps;
        amountOut = (amountOut * feeMultiplier) / 1000000n;
  
        console.log(`📊 Calculated output (before slippage): ${amountOut.toString()}`);
  
      } catch (mathError) {
        console.error('Math calculation error:', mathError);
        return { success: false, error: 'Failed to calculate swap output' };
      }
  
      if (!amountOut || amountOut === 0n) {
        return { success: false, error: 'Calculated quote returned zero output' };
      }
  
      // ✅ 5) Apply slippage
      const slippageBps = BigInt(Math.floor(maxSlippage * 10000));
      const minAmountOut = (amountOut * (10000n - slippageBps)) / 10000n;
  
      const quote = {
        amountOut,
        minAmountOut,
        feeTier,
        poolAddress,
        sqrtPriceX96,
        liquidity,
        gasEstimate: 200000,
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
   *  FIXED performSwap using Alchemy Gas Manager
   *  Following the exact flow from Alchemy docs
   * */
  async performSwap(swap, enableGasOptimization = true) {
    try {
      const { params, quote } = swap;
  
      if (!params.smartAccount || !params.smartAccount.account) {
        throw new Error("Smart account object is required");
      }
  
      console.log('🔧 Smart Account:', params.smartAccount.address);
  
      // Build transaction calls
      const calls = [];
      const isNativeMON = !params.tokenIn || 
                          params.tokenIn === null || 
                          String(params.tokenIn).toLowerCase() === 'mon';
  
      if (isNativeMON) {
        console.log('⚡ Native MON → wrapping, approving, swapping');
        
        calls.push({
          to: CONTRACTS.WMON,
          value: params.amountIn,
          data: encodeFunctionData({
            abi: [{ type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [] }],
            functionName: 'deposit'
          })
        });
  
        calls.push({
          to: CONTRACTS.WMON,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [CONTRACTS.SwapRouter02, params.amountIn * 2n]
          })
        });
  
        calls.push({
          to: CONTRACTS.SwapRouter02,
          value: 0n,
          data: encodeFunctionData({
            abi: SWAP_ROUTER_ABI,
            functionName: 'exactInputSingle',
            args: [{
              tokenIn: CONTRACTS.WMON,
              tokenOut: params.tokenOut,
              fee: Number(quote.feeTier),
              recipient: params.smartAccount.address,
              deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
              amountIn: params.amountIn,
              amountOutMinimum: quote.minAmountOut,
              sqrtPriceLimitX96: 0n
            }]
          })
        });
      } else {
        console.log('🔓 ERC20 → approving and swapping');
        
        calls.push({
          to: params.tokenIn,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [CONTRACTS.SwapRouter02, params.amountIn * 2n]
          })
        });
  
        calls.push({
          to: CONTRACTS.SwapRouter02,
          value: 0n,
          data: encodeFunctionData({
            abi: SWAP_ROUTER_ABI,
            functionName: 'exactInputSingle',
            args: [{
              tokenIn: params.tokenIn,
              tokenOut: params.tokenOut,
              fee: Number(quote.feeTier),
              recipient: params.smartAccount.address,
              deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
              amountIn: params.amountIn,
              amountOutMinimum: quote.minAmountOut,
              sqrtPriceLimitX96: 0n
            }]
          })
        });
      }
  
      console.log(`📦 Prepared ${calls.length} calls`);
  
      // ✅ Get account and encode callData
      const account = params.smartAccount.account;
      const nonce = await account.getNonce();
      const callData = await account.encodeCalls(calls);
  
      console.log('📝 CallData length:', callData.length);
      console.log('🔢 Nonce:', nonce);
  
      // ✅ Get dummy signature
      const dummySignature = account.getDummySignature 
        ? await account.getDummySignature()
        : '0x' + '00'.repeat(65);
  
      // ✅ STEP 1: Call Alchemy Gas Manager API to get gas estimates + paymaster signature
      console.log('💰 Calling Alchemy Gas Manager API...');
      
      const alchemyResponse = await fetch(
        `https://monad-testnet.g.alchemy.com/v2/${ALCHEMY_CONFIG.API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'alchemy_requestGasAndPaymasterAndData',
            params: [{
              policyId: ALCHEMY_CONFIG.POLICY_ID,
              entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032', // EntryPoint v0.7
              dummySignature: dummySignature,
              userOperation: {
                sender: params.smartAccount.address,
                nonce: `0x${nonce.toString(16)}`,
                callData: callData
              }
            }]
          })
        }
      );
  
      const alchemyData = await alchemyResponse.json();
  
      if (alchemyData.error) {
        console.error('❌ Alchemy Gas Manager error:', alchemyData.error);
        throw new Error(`Gas Manager API error: ${alchemyData.error.message}`);
      }
  
      console.log('✅ Alchemy Gas Manager response:', {
        paymaster: alchemyData.result.paymaster,
        callGasLimit: alchemyData.result.callGasLimit,
        verificationGasLimit: alchemyData.result.verificationGasLimit
      });
  
      // ✅ STEP 2: Use viem to send with Alchemy's gas values
      const { createBundlerClient } = await import('viem/account-abstraction');
      const { http } = await import('viem');
      const { monadTestnet } = await import('../monad/monadClient.js');
      const { createPublicClient } = await import('viem');
  
      const publicClient = createPublicClient({
        chain: monadTestnet,
        transport: http(monadTestnet.rpcUrls.default.http[0])
      });
  
      const bundlerClient = createBundlerClient({
        client: publicClient,
        transport: http(`https://monad-testnet.g.alchemy.com/v2/${ALCHEMY_CONFIG.API_KEY}`),
        chain: monadTestnet
      });
  
      console.log('🚀 Sending UserOperation with Alchemy gas values...');
  
      // Build UserOp with Alchemy's values
      const userOp = {
        sender: params.smartAccount.address,
        nonce: nonce,
        callData: callData,
        callGasLimit: BigInt(alchemyData.result.callGasLimit),
        verificationGasLimit: BigInt(alchemyData.result.verificationGasLimit),
        preVerificationGas: BigInt(alchemyData.result.preVerificationGas),
        maxFeePerGas: BigInt(alchemyData.result.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(alchemyData.result.maxPriorityFeePerGas),
        paymaster: alchemyData.result.paymaster,
        paymasterData: alchemyData.result.paymasterData || '0x',
        paymasterVerificationGasLimit: BigInt(alchemyData.result.paymasterVerificationGasLimit || '0x0'),
        paymasterPostOpGasLimit: BigInt(alchemyData.result.paymasterPostOpGasLimit || '0x0')
      };
  
      // Sign the UserOp
      const signature = await account.signUserOperation(userOp);
      userOp.signature = signature;
  
      console.log('✅ UserOp signed, sending...');
  
      // Send via bundler
      const userOpHash = await bundlerClient.sendUserOperation({
        ...userOp,
        account: account,
        entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032'
      });
  
      console.log('✅ UserOpHash:', userOpHash);
  
      // Wait for receipt
      console.log('⏰ Waiting for confirmation...');
      const receipt = await bundlerClient.waitForUserOperationReceipt({
        hash: userOpHash
      });
  
      if (!receipt?.success) {
        throw new Error('UserOperation failed');
      }
  
      console.log('✅ Swap successful! TX:', receipt.receipt.transactionHash);
  
      const swapResult = await this.parseSwapResult(receipt.receipt);
  
      return {
        success: true,
        amountOut: swapResult.amountOut,
        txHash: receipt.receipt.transactionHash,
        gasUsed: receipt.receipt.gasUsed || 0n,
        gasCost: 0n,
        blockNumber: receipt.receipt.blockNumber,
        userOpHash
      };
  
    } catch (error) {
      console.error("❌ Swap failed:", error);
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
  
        // Check liquidity
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
    
    return bestPool;
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
  
    // ==========================================
    // 1) INLINE NORMALIZE TOKEN helper (SAFE)
    // ==========================================
    const normalizeToken = (token) => {
      // token can be: symbol ("MON"), address, null, or zero address
      if (!token) {
        // null or undefined => treat as native MON
        return SUPPORTED_TOKENS.MON || null;
      }
  
      const tokenStr = String(token).trim();
  
      // If it's "MON" / "USDC" / etc.
      const symbolMatch = Object.keys(SUPPORTED_TOKENS).find(
        (key) => key.toLowerCase() === tokenStr.toLowerCase()
      );
      if (symbolMatch) {
        return SUPPORTED_TOKENS[symbolMatch];
      }
  
      // If zero address or empty => treat as MON/native
      const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
      if (
        tokenStr === "" ||
        tokenStr.toLowerCase() === ZERO_ADDR
      ) {
        return SUPPORTED_TOKENS.MON;
      }
  
      // Otherwise assume address → find in SUPPORTED_TOKENS
      const lowerAddr = tokenStr.toLowerCase();
      const found = Object.values(SUPPORTED_TOKENS).find(
        (t) => t.address && t.address.toLowerCase() === lowerAddr
      );
      return found || null;
    };
  
    // ==========================================
    // 2) Resolve Real On-Chain Address
    //    (MON/native => WMON)
    // ==========================================
    const resolveAddress = (tokenInfo) => {
      if (!tokenInfo) return null;
  
      // If token isNative, use its wrapped (WMON)
      if (tokenInfo.isNative) {
        return SUPPORTED_TOKENS.WMON.address;
      }
      return tokenInfo.address;
    };
  
    // ==========================================
    // 3) SMART ACCOUNT VALIDATION
    // ==========================================
    if (!params.smartAccount) {
      errors.push("Smart account object is missing");
    } else {
      if (!params.smartAccount.address) {
        errors.push("Smart account address is missing");
      } else if (!validateAddress(params.smartAccount.address).isValid) {
        errors.push("Invalid smart account address format");
      }
  
      if (!params.smartAccount.account) {
        errors.push(
          "Smart account instance (account property) is missing - account may need rehydration"
        );
      }
    }
  
    // ==========================================
    // 4) NORMALIZE TOKENS
    // ==========================================
    const tokenInInfo = normalizeToken(params.tokenIn);
    const tokenOutInfo = normalizeToken(params.tokenOut);
  
    if (!tokenInInfo) {
      errors.push("Invalid or unsupported tokenIn");
    }
    if (!tokenOutInfo) {
      errors.push("Invalid or unsupported tokenOut");
    }
  
    if (tokenInInfo && tokenOutInfo) {
      const tokenInAddr = resolveAddress(tokenInInfo);
      const tokenOutAddr = resolveAddress(tokenOutInfo);
  
      if (!tokenInAddr) {
        errors.push("tokenIn address resolution failed");
      }
      if (!tokenOutAddr) {
        errors.push("tokenOut address resolution failed");
      }
  
      if (tokenInAddr && tokenOutAddr) {
        const inLower = tokenInAddr.toLowerCase();
        const outLower = tokenOutAddr.toLowerCase();
  
        // Must be different tokens
        if (inLower === outLower) {
          errors.push("TokenIn and tokenOut must be different");
        }
  
        // Validate address format
        if (!validateAddress(inLower).isValid) {
          errors.push("Invalid tokenIn address format");
        }
        if (!validateAddress(outLower).isValid) {
          errors.push("Invalid tokenOut address format");
        }
  
        // Ensure supported
        const tokenInSupported = Object.values(SUPPORTED_TOKENS).some(
          (t) => t.address && t.address.toLowerCase() === inLower
        );
        if (!tokenInSupported) {
          errors.push("TokenIn not supported");
        }
  
        const tokenOutSupported = Object.values(SUPPORTED_TOKENS).some(
          (t) => t.address && t.address.toLowerCase() === outLower
        );
        if (!tokenOutSupported) {
          errors.push("TokenOut not supported");
        }
  
        // Validate amount
        if (!params.amountIn || params.amountIn === 0n) {
          errors.push("AmountIn must be greater than zero");
        } else {
          const { isValid } = validateTokenAmount(
            formatUnits(params.amountIn, tokenInInfo.decimals),
            {
              decimals: tokenInInfo.decimals,
              minAmount: tokenInInfo.minAmount || 0.001,
              symbol: tokenInInfo.symbol,
            }
          );
          if (!isValid) {
            errors.push("Invalid amountIn");
          }
        }
      }
    }
  
    // ==========================================
    // 5) RECIPIENT VALIDATION
    // ==========================================
    if (!params.recipient) {
      errors.push("Recipient address is missing");
    } else if (!validateAddress(params.recipient).isValid) {
      errors.push("Invalid recipient address");
    }
  
    // ==========================================
    // 6) DEBUG LOG IF FAIL
    // ==========================================
    if (errors.length > 0) {
      console.error("🔍 Validation failed. SmartAccount structure:", {
        hasSmartAccount: !!params.smartAccount,
        hasAddress: !!params.smartAccount?.address,
        hasAccount: !!params.smartAccount?.account,
        smartAccountKeys: params.smartAccount
          ? Object.keys(params.smartAccount)
          : [],
      });
    }
  
    return {
      isValid: errors.length === 0,
      errors,
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
 * Lightweight gas estimation for swaps
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
      gasLimit: 1_000_000n,
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
    console.log('✅ SwapExecutorService ready with Alchemy Gas Manager!');
  } catch (error) {
    console.error('❌ Failed to initialize SwapExecutorService:', error);
  }
})();