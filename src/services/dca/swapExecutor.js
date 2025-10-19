import { parseUnits, formatUnits, encodeFunctionData, decodeFunctionResult } from 'viem';
import { monadClient } from '../monad/monadClient.js';
import { validateTokenAmount, validateAddress } from '../../utils/validators.js';
import { formatTokenAmount } from '../../utils/formatters.js';
import { 
  CONTRACTS, 
  SUPPORTED_TOKENS, 
  ALCHEMY_CONFIG,
  DCA_CONFIG 
} from '../../utils/constants.js';
import { keccak256, decodeEventLog } from 'viem';
import UniswapV3PoolABI from '../../contracts/abis/UniswapV3Pool.json';
import ERC20_ABI from '../../contracts/abis/ERC20.json';
import SWAP_ROUTER_JSON from '../../contracts/abis/SwapRouter02.json';

const SWAP_ROUTER_ABI = Array.isArray(SWAP_ROUTER_JSON) ? SWAP_ROUTER_JSON : SWAP_ROUTER_JSON.abi;

// Swap execution status
const SWAP_STATUS = {
  PENDING: 'pending',
  QUOTE_OBTAINED: 'quote_obtained',
  WRAPPING: 'wrapping',
  APPROVING: 'approving',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Fee tiers for Uniswap V3 pools
const FEE_TIERS = {
  LOW: 500,
  MEDIUM: 3000,
  HIGH: 10000
};

/**
 * ✅ FIXED Swap Executor Service - SPLIT TRANSACTIONS
 */
class SwapExecutorService {
  constructor() {
    this.activeSwaps = new Map();
    this.swapHistory = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await this.validateContracts();
      this.initialized = true;
      console.log('✅ SwapExecutorService initialized');
    } catch (error) {
      console.error('❌ Failed to initialize SwapExecutorService:', error);
      throw new Error(`Swap executor initialization failed: ${error.message}`);
    }
  }

  /**
   * Execute a single token swap - FIXED WITH SPLIT TRANSACTIONS!
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
      deadline = Math.floor(Date.now() / 1000) + 300
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
        txHash: null,
        error: null
      };

      this.activeSwaps.set(swapId, swap);

      console.log(`Starting swap ${swapId}: ${formatTokenAmount(swapParams.amountIn, swapParams.tokenInDecimals)} ${swapParams.tokenInSymbol} → ${swapParams.tokenOutSymbol}`);

      // Get quote
      if (!skipQuote) {
        const quoteResult = await this.getSwapQuote(swapParams, { maxSlippage, deadline });
        if (!quoteResult.success) {
          throw new Error(`Quote failed: ${quoteResult.error}`);
        }
        
        swap.quote = quoteResult.quote;
        swap.status = SWAP_STATUS.QUOTE_OBTAINED;
        
        console.log(`Quote obtained: ${formatTokenAmount(swap.quote.amountOut, swapParams.tokenOutDecimals)} ${swapParams.tokenOutSymbol}`);
      }

      // Execute swap
      const executionResult = await this.performSwap(swap);
      
      if (executionResult.success) {
        swap.status = SWAP_STATUS.COMPLETED;
        swap.actualOutput = executionResult.amountOut;
        swap.txHash = executionResult.txHash;
        swap.gasUsed = executionResult.gasUsed;
        swap.completedAt = Date.now();

        console.log(`✅ Swap ${swapId} completed successfully`);
        
        this.recordSwapHistory(swap);
        
        return {
          success: true,
          swapId,
          result: {
            amountOut: swap.actualOutput,
            txHash: swap.txHash,
            gasUsed: swap.gasUsed,
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
      const result = await monadClient.publicClient.call({ to, data });
      
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
      // Normalize tokens
      const normalizeToken = (token) => {
        if (!token || token === null || String(token).toUpperCase() === 'MON' || token === '0x0000000000000000000000000000000000000000') {
          console.log('🔄 Normalizing native MON → WMON for pool query');
          return CONTRACTS.WMON.toLowerCase();
        }
        return String(token).toLowerCase();
      };

      const tokenInAddress = normalizeToken(swapParams.tokenIn);
      const tokenOutAddress = normalizeToken(swapParams.tokenOut);

      if (!tokenInAddress || !tokenOutAddress || tokenInAddress === tokenOutAddress) {
        return { success: false, error: 'Invalid token addresses' };
      }

      if (!swapParams.amountIn || swapParams.amountIn === 0n) {
        return { success: false, error: 'Amount must be greater than zero' };
      }

      // Find optimal pool
      console.log(`📊 Finding pool for ${tokenInAddress} <-> ${tokenOutAddress}`);
      
      const poolData = await this.getOptimalFeeTierWithAddress(tokenInAddress, tokenOutAddress);
      const feeTier = poolData.fee;
      const poolAddress = poolData.poolAddress;

      console.log(`📊 Using pool ${poolAddress} with fee ${feeTier}`);

      // Get pool state
      const poolABI = [
        { inputs: [], name: 'slot0', outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' }], stateMutability: 'view', type: 'function' },
        { inputs: [], name: 'liquidity', outputs: [{ name: '', type: 'uint128' }], stateMutability: 'view', type: 'function' },
        { inputs: [], name: 'token0', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
        { inputs: [], name: 'token1', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' }
      ];

      const [slot0Result, liquidityResult, token0Result, token1Result] = await Promise.all([
        this.safeCall({ to: poolAddress, data: encodeFunctionData({ abi: poolABI, functionName: 'slot0', args: [] }) }),
        this.safeCall({ to: poolAddress, data: encodeFunctionData({ abi: poolABI, functionName: 'liquidity', args: [] }) }),
        this.safeCall({ to: poolAddress, data: encodeFunctionData({ abi: poolABI, functionName: 'token0', args: [] }) }),
        this.safeCall({ to: poolAddress, data: encodeFunctionData({ abi: poolABI, functionName: 'token1', args: [] }) })
      ]);

      const slot0Decoded = decodeFunctionResult({ abi: poolABI, functionName: 'slot0', data: slot0Result.data });
      const sqrtPriceX96 = Array.isArray(slot0Decoded) ? slot0Decoded[0] : slot0Decoded;

      const liquidityDecoded = decodeFunctionResult({ abi: poolABI, functionName: 'liquidity', data: liquidityResult.data });
      const liquidity = Array.isArray(liquidityDecoded) ? liquidityDecoded[0] : liquidityDecoded;

      const token0Decoded = decodeFunctionResult({ abi: poolABI, functionName: 'token0', data: token0Result.data });
      const token0Address = (Array.isArray(token0Decoded) ? token0Decoded[0] : token0Decoded).toLowerCase();

      console.log(`📊 Pool state: sqrtPrice=${sqrtPriceX96}, liquidity=${liquidity}`);

      if (!sqrtPriceX96 || sqrtPriceX96 === 0n || !liquidity || liquidity === 0n) {
        return { success: false, error: 'Invalid pool state' };
      }

      // Calculate output
      const isToken0In = tokenInAddress === token0Address;
      const Q96 = 2n ** 96n;
      const priceSquared = (sqrtPriceX96 * sqrtPriceX96) / Q96;

      let amountOut = isToken0In 
        ? (swapParams.amountIn * priceSquared) / Q96
        : (swapParams.amountIn * Q96) / priceSquared;

      // Apply fee
      const feeBps = BigInt(feeTier);
      amountOut = (amountOut * (1000000n - feeBps)) / 1000000n;

      console.log(`📊 Calculated output: ${amountOut.toString()}`);

      if (!amountOut || amountOut === 0n) {
        return { success: false, error: 'Calculated quote returned zero output' };
      }

      // Apply slippage
      const slippageBps = BigInt(Math.floor(maxSlippage * 10000));
      const minAmountOut = (amountOut * (10000n - slippageBps)) / 10000n;

      const quote = {
        amountOut,
        minAmountOut,
        feeTier,
        poolAddress,
        sqrtPriceX96,
        liquidity,
        timestamp: Date.now(),
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress
      };

      console.log(`✅ Quote success: ${amountOut.toString()} output (min: ${minAmountOut.toString()})`);
      return { success: true, quote };

    } catch (error) {
      console.error('❌ Failed to get swap quote:', error);
      return { success: false, error: error.message || 'Failed to get quote' };
    }
  }

  /**
   * ✅ FIXED performSwap - SPLIT INTO 3 SEPARATE TRANSACTIONS!
   */
  async performSwap(swap) {
    try {
      const { params, quote } = swap;

      // ✅ CRITICAL VALIDATION
      if (!params.smartAccount || !params.smartAccount.account) {
        throw new Error("Smart account object is required");
      }
      // ✅ CRITICAL FIX: Attach signer (walletClient) to account if missing
      if (!params.smartAccount.account.walletClient && params.smartAccount.walletClient) {
        console.log("🔧 Attaching walletClient to smart account...");
        params.smartAccount.account.walletClient = params.smartAccount.walletClient;
        
      }
      // ✅ Check again: does the account now have a signer?
      const hasSigner =
      !!params.smartAccount.walletClient ||
      !!params.smartAccount.account.walletClient ||
      typeof params.smartAccount.account.signUserOperation === 'function';
      console.log("🔍 Signer Availability:", {
        hasSigner,
        hasWalletClient: !!params.smartAccount.walletClient,
        accountWalletClient: !!params.smartAccount.account.walletClient
      });
      if (!hasSigner) {
        throw new Error("❌ Smart account still has no signer! Make sure walletClient is passed down correctly.");
      }

      // ✅ CRITICAL: Verify the account can sign
      if (!params.smartAccount.account.signUserOperation) {
        throw new Error("Smart account is missing signUserOperation function. The account may not be properly initialized with a signer.");
      }

      console.log('🔧 Smart Account:', params.smartAccount.address);
      
      // ✅ CRITICAL DEBUG: Check if account has signer
      console.log('🔍 Account Debug:', {
        hasAccount: !!params.smartAccount.account,
        hasClient: !!params.smartAccount.account?.client,
        hasSigner:
        !!params.smartAccount.walletClient ||
        !!params.smartAccount.account?.walletClient ||
        typeof params.smartAccount.account?.signUserOperation === 'function',
        hasSignUserOperation: typeof params.smartAccount.account?.signUserOperation === 'function',
        accountType: params.smartAccount.account?.type
      });

      // ✅ CRITICAL FIX: Don't create new clients - they lose the signer!
      // The account object already has everything configured
      const { createBundlerClient, createPaymasterClient } = await import('viem/account-abstraction');
      const { http } = await import('viem');

      // ✅ Use the account's existing client for balance/contract checks
      const publicClient = params.smartAccount.account.client;

      // ✅ Create bundler client - it will use the account's signer automatically
      const bundlerClient = createBundlerClient({
        account: params.smartAccount.account,
        client: publicClient, // Use the account's client that has the signer
        transport: http(`https://monad-testnet.g.alchemy.com/v2/${ALCHEMY_CONFIG.API_KEY}`),
      });

      const paymasterClient = createPaymasterClient({
        transport: http(`https://monad-testnet.g.alchemy.com/v2/${ALCHEMY_CONFIG.API_KEY}`),
      });

      const isNativeMON = !params.tokenIn || params.tokenIn === null || String(params.tokenIn).toLowerCase() === 'mon';

      // ✅ STEP 1: WRAP (if native MON)
      if (isNativeMON) {
        console.log('💰 Step 1/3: Wrapping MON...');
        
        // Check balance first
        const balance = await publicClient.getBalance({ address: params.smartAccount.address });
        console.log(`   Balance: ${formatUnits(balance, 18)} MON`);
        
        if (balance < params.amountIn) {
          throw new Error(`Insufficient balance: ${formatUnits(balance, 18)} MON < ${formatUnits(params.amountIn, 18)} MON`);
        }

        const wrapCall = {
          to: CONTRACTS.WMON,
          value: params.amountIn,
          data: encodeFunctionData({
            abi: [{ type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [], outputs: [] }],
            functionName: 'deposit'
          })
        };
        if (!params.smartAccount.account.signUserOperation) {
          throw new Error("Smart account cannot sign UserOperations (missing signUserOperation).");
        }        

        const wrapHash = await bundlerClient.sendUserOperation({
          account: params.smartAccount.account,
          calls: [wrapCall],
          paymaster: paymasterClient,
          paymasterContext: {
            policyId: ALCHEMY_CONFIG.POLICY_ID,
          },
        });

        console.log(`   ✅ Wrap UserOp: ${wrapHash}`);

        const wrapReceipt = await bundlerClient.waitForUserOperationReceipt({ hash: wrapHash });
        
        if (!wrapReceipt?.success) {
          throw new Error('Wrap transaction failed');
        }

        console.log(`   ✅ Wrapped! TX: ${wrapReceipt.receipt.transactionHash}`);
        
        // Wait a bit for state to settle
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // ✅ STEP 2: APPROVE
      console.log('🔓 Step 2/3: Approving token...');
      
      const tokenToApprove = isNativeMON ? CONTRACTS.WMON : params.tokenIn;
      
      // Check current allowance
      const currentAllowance = await publicClient.readContract({
        address: tokenToApprove,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [params.smartAccount.address, CONTRACTS.SwapRouter02]
      });

      console.log(`   Current allowance: ${currentAllowance.toString()}`);

      if (currentAllowance < params.amountIn) {
        const approveCall = {
          to: tokenToApprove,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [CONTRACTS.SwapRouter02, params.amountIn] // ✅ Exact amount, not 2x
          })
        };

        const approveHash = await bundlerClient.sendUserOperation({
          account: params.smartAccount.account,
          calls: [approveCall],
          paymaster: paymasterClient,
          paymasterContext: {
            policyId: ALCHEMY_CONFIG.POLICY_ID,
          },
        });

        console.log(`   ✅ Approve UserOp: ${approveHash}`);

        const approveReceipt = await bundlerClient.waitForUserOperationReceipt({ hash: approveHash });
        
        if (!approveReceipt?.success) {
          throw new Error('Approve transaction failed');
        }

        console.log(`   ✅ Approved! TX: ${approveReceipt.receipt.transactionHash}`);
        
        // Wait a bit for state to settle
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.log(`   ℹ️ Already approved, skipping`);
      }

      // ✅ STEP 3: SWAP
      console.log('🔄 Step 3/3: Executing swap...');

      const swapCall = {
        to: CONTRACTS.SwapRouter02,
        value: 0n,
        data: encodeFunctionData({
          abi: SWAP_ROUTER_ABI,
          functionName: 'exactInputSingle',
          args: [{
            tokenIn: isNativeMON ? CONTRACTS.WMON : params.tokenIn,
            tokenOut: params.tokenOut,
            fee: Number(quote.feeTier),
            recipient: params.smartAccount.address,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 300), // 5 minutes from now
            amountIn: params.amountIn,
            amountOutMinimum: quote.minAmountOut,
            sqrtPriceLimitX96: 0n
          }]
        })
      };

      console.log('   Swap params:', {
        tokenIn: isNativeMON ? CONTRACTS.WMON : params.tokenIn,
        tokenOut: params.tokenOut,
        fee: Number(quote.feeTier),
        amountIn: params.amountIn.toString(),
        minOut: quote.minAmountOut.toString()
      });

      const swapHash = await bundlerClient.sendUserOperation({
        account: params.smartAccount.account,
        calls: [swapCall],
        paymaster: paymasterClient,
        paymasterContext: {
          policyId: ALCHEMY_CONFIG.POLICY_ID,
        },
      });

      console.log(`   ✅ Swap UserOp: ${swapHash}`);

      const swapReceipt = await bundlerClient.waitForUserOperationReceipt({ hash: swapHash });
      
      if (!swapReceipt?.success) {
        throw new Error('Swap transaction failed');
      }

      console.log(`   ✅ Swap successful! TX: ${swapReceipt.receipt.transactionHash}`);

      const swapResult = await this.parseSwapResult(swapReceipt.receipt);

      return {
        success: true,
        amountOut: swapResult.amountOut,
        txHash: swapReceipt.receipt.transactionHash,
        gasUsed: swapReceipt.receipt.gasUsed || 0n,
        blockNumber: swapReceipt.receipt.blockNumber,
        userOpHash: swapHash
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
   * Get optimal fee tier AND pool address
   */
  async getOptimalFeeTierWithAddress(tokenA, tokenB) {
    if (!tokenA || !tokenB || tokenA.toLowerCase() === tokenB.toLowerCase()) {
      throw new Error('Invalid token pair');
    }

    const feeTiers = [FEE_TIERS.MEDIUM, FEE_TIERS.LOW, FEE_TIERS.HIGH];
    
    const factoryABI = [{
      inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }, { name: 'fee', type: 'uint24' }],
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
        const poolAddressResult = await this.safeCall({
          to: CONTRACTS.UniswapV3Factory,
          data: encodeFunctionData({ abi: factoryABI, functionName: 'getPool', args: [tokenA, tokenB, fee] })
        });

        const decoded = decodeFunctionResult({ abi: factoryABI, functionName: 'getPool', data: poolAddressResult.data });
        const poolAddress = Array.isArray(decoded) ? decoded[0] : decoded;

        const isZeroAddress = !poolAddress || poolAddress === '0x' || poolAddress.toLowerCase() === '0x0000000000000000000000000000000000000000' || BigInt(poolAddress) === 0n;

        if (isZeroAddress) {
          console.log(`  ❌ Fee ${fee}: No pool exists`);
          continue;
        }

        console.log(`  ✅ Fee ${fee}: Pool found at ${poolAddress}`);

        const liquidityResult = await this.safeCall({
          to: poolAddress,
          data: encodeFunctionData({ abi: poolABI, functionName: 'liquidity', args: [] })
        });

        const liquidityDecoded = decodeFunctionResult({ abi: poolABI, functionName: 'liquidity', data: liquidityResult.data });
        const liquidity = Array.isArray(liquidityDecoded) ? liquidityDecoded[0] : liquidityDecoded;

        if (liquidity && liquidity > 0n) {
          console.log(`  ✅ Fee ${fee}: Has liquidity ${liquidity.toString()}`);
          poolsFound.push({ fee, liquidity, poolAddress });
        }

      } catch (error) {
        console.log(`  ❌ Fee ${fee}: Error - ${error.message}`);
        continue;
      }
    }

    if (poolsFound.length === 0) {
      throw new Error('No liquidity pools found for this token pair');
    }

    poolsFound.sort((a, b) => (a.liquidity > b.liquidity ? -1 : 1));

    const bestPool = poolsFound[0];
    console.log(`🏆 Best pool: Fee ${bestPool.fee} with liquidity ${bestPool.liquidity.toString()}`);
    
    return bestPool;
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

    const normalizeToken = (token) => {
      if (!token) return SUPPORTED_TOKENS.MON || null;
      const tokenStr = String(token).trim();
      const symbolMatch = Object.keys(SUPPORTED_TOKENS).find(key => key.toLowerCase() === tokenStr.toLowerCase());
      if (symbolMatch) return SUPPORTED_TOKENS[symbolMatch];
      const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
      if (tokenStr === "" || tokenStr.toLowerCase() === ZERO_ADDR) return SUPPORTED_TOKENS.MON;
      const lowerAddr = tokenStr.toLowerCase();
      const found = Object.values(SUPPORTED_TOKENS).find(t => t.address && t.address.toLowerCase() === lowerAddr);
      return found || null;
    };

    const resolveAddress = (tokenInfo) => {
      if (!tokenInfo) return null;
      if (tokenInfo.isNative) return SUPPORTED_TOKENS.WMON.address;
      return tokenInfo.address;
    };

    // Smart account validation
    if (!params.smartAccount) {
      errors.push("Smart account object is missing");
    } else {
      if (!params.smartAccount.address) errors.push("Smart account address is missing");
      if (!params.smartAccount.account) errors.push("Smart account instance missing");
    }

    // Token validation
    const tokenInInfo = normalizeToken(params.tokenIn);
    const tokenOutInfo = normalizeToken(params.tokenOut);

    if (!tokenInInfo) errors.push("Invalid or unsupported tokenIn");
    if (!tokenOutInfo) errors.push("Invalid or unsupported tokenOut");

    if (tokenInInfo && tokenOutInfo) {
      const tokenInAddr = resolveAddress(tokenInInfo);
      const tokenOutAddr = resolveAddress(tokenOutInfo);

      if (!tokenInAddr) errors.push("tokenIn address resolution failed");
      if (!tokenOutAddr) errors.push("tokenOut address resolution failed");

      if (tokenInAddr && tokenOutAddr && tokenInAddr.toLowerCase() === tokenOutAddr.toLowerCase()) {
        errors.push("TokenIn and tokenOut must be different");
      }

      // Amount validation
      if (!params.amountIn || params.amountIn === 0n) {
        errors.push("AmountIn must be greater than zero");
      }
    }

    // Recipient validation
    if (!params.recipient) {
      errors.push("Recipient address is missing");
    } else if (!validateAddress(params.recipient).isValid) {
      errors.push("Invalid recipient address");
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

    console.log('✅ All Uniswap V3 contracts validated');
  }

  generateSwapId(params) {
    const key = `${params.tokenIn}-${params.tokenOut}-${params.amountIn}-${Date.now()}`;
    const encoded = btoa(key).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
    return `swap_${encoded}`;
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
      gasUsed: swap.gasUsed,
      executionTime: swap.completedAt - swap.startedAt,
      status: swap.status
    });
    
    if (history.length > 100) {
      this.swapHistory.set(tokenPair, history.slice(-100));
    }
  }

  getActiveSwaps() {
    return Array.from(this.activeSwaps.values()).map(swap => ({
      id: swap.id,
      tokenPair: `${swap.params.tokenInSymbol}/${swap.params.tokenOutSymbol}`,
      amountIn: formatTokenAmount(swap.params.amountIn, swap.params.tokenInDecimals),
      status: swap.status,
      startedAt: swap.startedAt,
      duration: Date.now() - swap.startedAt
    }));
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
      }
    };
  }
}

// Create singleton instance
const swapExecutor = new SwapExecutorService();

// Export
export { 
  SwapExecutorService,
  swapExecutor,
  SWAP_STATUS,
  FEE_TIERS,
};

// Auto-initialize
(async () => {
  try {
    console.log('Initializing SwapExecutorService...');
    await swapExecutor.initialize();
    console.log('✅ SwapExecutorService ready with SPLIT TRANSACTIONS!');
  } catch (error) {
    console.error('❌ Failed to initialize SwapExecutorService:', error);
  }
})();