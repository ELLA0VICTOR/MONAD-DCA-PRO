import { createPublicClient, createWalletClient, http, webSocket, formatUnits, parseUnits } from 'viem';
import { MONAD_CONFIG, CONTRACTS, GAS_LIMITS, ERROR_CODES } from '../../utils/constants.js';

// ===== MONAD CHAIN DEFINITION =====

/**
 * Monad testnet chain configuration for viem
 */
export const monadTestnet = {
  id: MONAD_CONFIG.chainId,
  name: MONAD_CONFIG.name,
  network: 'monad-testnet',
  nativeCurrency: {
    decimals: MONAD_CONFIG.decimals,
    name: MONAD_CONFIG.currency,
    symbol: MONAD_CONFIG.currency,
  },
  rpcUrls: {
    default: {
      http: [MONAD_CONFIG.rpcUrl],
      webSocket: [MONAD_CONFIG.wsUrl],
    },
    public: {
      http: [MONAD_CONFIG.rpcUrl],
      webSocket: [MONAD_CONFIG.wsUrl],
    },
  },
  blockExplorers: {
    default: {
      name: 'Monad Explorer',
      url: MONAD_CONFIG.explorer,
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11', // Standard multicall
      blockCreated: 0,
    },
  },
  fees: {
    baseFeeMultiplier: 1.0, // Monad uses fixed 50 gwei base fee
  },
  formatters: {
    // Custom formatters for Monad's gas charging model
    transactionRequest: (request) => ({
      ...request,
      gasPrice: request.gasPrice || MONAD_CONFIG.baseFee,
    }),
  },
};

// ===== CLIENT CREATION =====

/**
 * Create public client for read operations
 * @param {object} options - Client options
 * @returns {object} Viem public client
 */
export const createMonadPublicClient = (options = {}) => {
  const { 
    transport = 'http', 
    pollingInterval = 1000, // 1 second for 400ms blocks
    retryCount = 3,
    timeout = 10000 
  } = options;
  
  try {
    const transportConfig = transport === 'websocket' 
      ? webSocket(MONAD_CONFIG.wsUrl, {
          timeout,
          retryCount,
        })
      : http(MONAD_CONFIG.rpcUrl, {
          timeout,
          retryCount,
        });
    
    const client = createPublicClient({
      chain: monadTestnet,
      transport: transportConfig,
      pollingInterval,
      cacheTime: 2000, // 2 second cache for fast blocks
    });
    
    return client;
    
  } catch (error) {
    throw new Error(`Failed to create Monad public client: ${error.message}`);
  }
};

/**
 * Create wallet client for write operations
 * @param {object} account - Account object with private key or signer
 * @param {object} options - Client options
 * @returns {object} Viem wallet client
 */
export const createMonadWalletClient = (account, options = {}) => {
  const { 
    transport = 'http',
    retryCount = 3,
    timeout = 10000 
  } = options;
  
  if (!account) {
    throw new Error('Account is required for wallet client');
  }
  
  try {
    const transportConfig = transport === 'websocket'
      ? webSocket(MONAD_CONFIG.wsUrl, { timeout, retryCount })
      : http(MONAD_CONFIG.rpcUrl, { timeout, retryCount });
    
    const client = createWalletClient({
      account,
      chain: monadTestnet,
      transport: transportConfig,
    });
    
    return client;
    
  } catch (error) {
    throw new Error(`Failed to create Monad wallet client: ${error.message}`);
  }
};

// ===== MONAD CLIENT CLASS =====

/**
 * Comprehensive Monad network client
 */
export class MonadClient {
  constructor(options = {}) {
    if (MonadClient.instance) {
      return MonadClient.instance; // 🔒 enforce singleton
    }
  
    this.publicClient = null;
    this.walletClient = null;
    this.wsClient = null;
    this.subscriptions = new Map();
    this.connectionState = 'disconnected';
    this.blockNumber = 0n;
    this.gasPrice = MONAD_CONFIG.baseFee;
    this.deploymentCache = new Map(); // initialize cache here
    
    this.config = {
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelay: 2000,
      healthCheckInterval: 30000,
      ...options
    };
  
    MonadClient.instance = this; // cache singleton
    // 🔸 Don’t auto-initialize here — we’ll initialize on first use
  }
  
  /**
   * Initialize the clients
   */
  async initialize() {
    try {
      // Create public client for read operations
      this.publicClient = createMonadPublicClient({
        transport: 'http',
        pollingInterval: 1000,
      });
      
      // Create WebSocket client for real-time updates
      this.wsClient = createMonadPublicClient({
        transport: 'websocket',
        pollingInterval: 500,
      });
      
      this.connectionState = 'connected';
      
      // Start monitoring
      //this.startHealthCheck();
      //this.subscribeToBlocks();  //i commented cause its causing my rpc to hit rate
      
    } catch (error) {
      this.connectionState = 'error';
      throw new Error(`Monad client initialization failed: ${error.message}`);
    }
  }
  
  /**
   * Set wallet account for transactions
   * @param {object} account - Account object
   */
  setAccount(account) {
    if (!account) {
      throw new Error('Account is required');
    }
    
    try {
      this.walletClient = createMonadWalletClient(account);
    } catch (error) {
      throw new Error(`Failed to set account: ${error.message}`);
    }
  }
  
  /**
   * Get current network status
   * @returns {object} Network status information
   */
  async getNetworkStatus() {
    try {
      const [blockNumber, gasPrice, chainId] = await Promise.all([
        this.publicClient.getBlockNumber(),
        this.publicClient.getGasPrice(),
        this.publicClient.getChainId(),
      ]);
      
      return {
        isConnected: this.connectionState === 'connected',
        blockNumber: blockNumber.toString(),
        gasPrice: gasPrice.toString(),
        chainId: chainId,
        baseFee: MONAD_CONFIG.baseFee.toString(),
        blockTime: MONAD_CONFIG.blockTime,
        currency: MONAD_CONFIG.currency
      };
      
    } catch (error) {
      throw new Error(`Failed to get network status: ${error.message}`);
    }
  }

  /**
 * Get account balance
 * @param {string} address - Account address
 * @param {string} tokenAddress - Token address (optional, defaults to native MON)
 * @returns {object|null} Balance information or null on failure
 */

  /**
 * Get account balance (cached for 5 minutes to prevent RPC overload)
 */
  async getBalance(address, tokenAddress = null) {
    if (!address) throw new Error("Address is required");
  
    // ✅ Initialize cache if not exists
    if (!this.balanceCache) this.balanceCache = new Map();
  
    // Create cache key per address + token
    const key = tokenAddress ? `${address}_${tokenAddress}` : address;
    const cached = this.balanceCache.get(key);
  
    // ✅ 5-minute cache window (300,000 ms)
    if (cached && Date.now() - cached.timestamp < 300000) {
      return cached.data;
    }
  
    try {
      let data;
  
      if (!tokenAddress) {
        // ✅ Native MON balance
        const addr =
        typeof address === "string"
          ? address
          : address?.address || address?.account || address;
        const balance = await this.publicClient.request({
          method: "eth_getBalance",
          params: [addr, "latest"], // ✅ correct JSON-RPC params
        });
        const balanceBigInt = BigInt(balance);
        data = {
          balance: balanceBigInt.toString(),
            formatted: formatUnits(balanceBigInt, 18),
            symbol: "MON",
            decimals: 18,
          };
      } else {
        // ✅ ERC-20 token balance
        const [balance, decimals, symbol] = await Promise.all([
          this.publicClient.readContract({
            address: tokenAddress,
            abi: [
              { name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
            ],
            functionName: "balanceOf",
            args: [address],
          }),
          this.publicClient.readContract({
            address: tokenAddress,
            abi: [
              { name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
            ],
            functionName: "decimals",
          }),
          this.publicClient.readContract({
            address: tokenAddress,
            abi: [
              { name: "symbol", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
            ],
            functionName: "symbol",
          }),
        ]);
  
        data = {
          balance: balance.toString(),
          formatted: formatUnits(balance, decimals),
          symbol,
          decimals,
          tokenAddress,
        };
      }
  
      // ✅ Store in cache with timestamp
      this.balanceCache.set(key, { data, timestamp: Date.now() });
      return data;
  
    } catch (error) {
      console.warn(`monadClient.getBalance failed for ${address} ${tokenAddress || ""}:`, error?.message || error);
      return cached?.data || null; // fallback to last cached value if exists
    }
  }
  /**
  * Get on-chain bytecode of a deployed contract
  * @param {object} params - { address: string }
  * @returns {Promise<string>} Contract bytecode (hex string)
  */
  async getBytecode({ address }) {
    if (!address) {
      throw new Error('Address is required');
    }
    if (!this.publicClient) {
      await this.initialize(); // ensure client ready
      }
      try {
        const bytecode = await this.publicClient.getCode({ address });
        return bytecode || '0x';
      } catch (error) {
        console.error(`[monadClient] getBytecode failed for ${address}:`, error.message);
        return '0x';
      }
    }
  
  
  

  /**
   * Estimate gas for a transaction
   * @param {object} transaction - Transaction parameters
   * @returns {object} Gas estimation with Monad-specific adjustments
   */
  async estimateGas(transaction) {
    if (!transaction) {
      throw new Error('Transaction parameters are required');
    }
    
    try {
      // Estimate gas limit
      const gasLimit = await this.publicClient.estimateGas(transaction);
      
      // Apply buffer for safety (Monad charges gas_limit not gas_used)
      const bufferedGasLimit = BigInt(Math.floor(Number(gasLimit) * GAS_LIMITS.bufferMultiplier));
      
      // Calculate total cost (Monad charges: value + gasPrice * gasLimit)
      const gasPrice = transaction.gasPrice || MONAD_CONFIG.baseFee;
      const gasCost = gasPrice * bufferedGasLimit;
      const totalCost = (transaction.value || 0n) + gasCost;
      
      return {
        gasLimit: bufferedGasLimit.toString(),
        gasPrice: gasPrice.toString(),
        gasCost: gasCost.toString(),
        totalCost: totalCost.toString(),
        estimatedGasLimit: gasLimit.toString(), // Original estimate
        buffer: GAS_LIMITS.bufferMultiplier,
        chargesGasLimit: true // Monad-specific behavior
      };
      
    } catch (error) {
      throw new Error(`Gas estimation failed: ${error.message}`);
    }
  }
  
  /**
   * Send transaction with Monad-specific optimizations
   * @param {object} transaction - Transaction parameters
   * @returns {string} Transaction hash
   */
  async sendTransaction(transaction) {
    if (!this.walletClient) {
      throw new Error('Wallet client not configured. Call setAccount() first.');
    }
    
    if (!transaction) {
      throw new Error('Transaction parameters are required');
    }
    
    try {
      // Estimate gas if not provided
      if (!transaction.gas && !transaction.gasLimit) {
        const gasEstimate = await this.estimateGas(transaction);
        transaction.gas = BigInt(gasEstimate.gasLimit);
      }
      
      // Set gas price if not provided (Monad uses fixed base fee)
      if (!transaction.gasPrice) {
        transaction.gasPrice = MONAD_CONFIG.baseFee;
      }
      
      // Send transaction
      const hash = await this.walletClient.sendTransaction(transaction);
      
      return hash;
      
    } catch (error) {
      // Handle specific Monad error cases
      if (error.message.includes('insufficient funds')) {
        throw new Error(`${ERROR_CODES.INSUFFICIENT_BALANCE}: Insufficient MON balance for gas`);
      }
      
      if (error.message.includes('gas limit')) {
        throw new Error(`${ERROR_CODES.NETWORK_ERROR}: Gas limit exceeded`);
      }
      
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }
  
  /**
   * Wait for transaction receipt with timeout
   * @param {string} hash - Transaction hash
   * @param {number} timeout - Timeout in milliseconds
   * @returns {object} Transaction receipt
   */
  async waitForTransaction(hash, timeout = 30000) {
    if (!hash) {
      throw new Error('Transaction hash is required');
    }
    
    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
        timeout,
        pollingInterval: 500, // Check every 500ms for 400ms blocks
      });
      
      // Add Monad-specific receipt information
      return {
        ...receipt,
        network: 'monad-testnet',
        gasChargedAsLimit: true,
        actualGasCost: receipt.effectiveGasPrice * receipt.gasUsed,
        chargedGasCost: receipt.effectiveGasPrice * receipt.gasUsed, // Same on Monad testnet
      };
      
    } catch (error) {
      if (error.message.includes('timeout')) {
        throw new Error(`${ERROR_CODES.TIMEOUT_ERROR}: Transaction confirmation timeout`);
      }
      
      throw new Error(`Failed to get transaction receipt: ${error.message}`);
    }
  }
  
  /**
   * Subscribe to new blocks
   * @param {function} callback - Callback function for new blocks
   * @returns {function} Unsubscribe function
   */
  async subscribeToBlocks(callback = null) {
    if (this.subscriptions.has('blocks')) return; // prevent duplicates
  
    if (!this.wsClient) {
      await this.initialize(); // now allowed
    }
  
    try {
      const unwatch = this.wsClient.watchBlockNumber({
        onBlockNumber: (blockNumber) => {
          this.blockNumber = blockNumber;
          if (callback) callback(blockNumber);
        },
        onError: (error) => {
          console.error('Block subscription error:', error);
          if (this.config.autoReconnect) {
            this.reconnectWebSocket();
          }
        },
      });
  
      this.subscriptions.set('blocks', unwatch);
      return unwatch;
    } catch (error) {
      throw new Error(`Block subscription failed: ${error.message}`);
    }
  }
  
  
  /**
   * Subscribe to pending transactions
   * @param {function} callback - Callback function for pending transactions
   * @returns {function} Unsubscribe function
   */
  async subscribeToPendingTransactions(callback) {
    if (!callback) {
      throw new Error('Callback function is required');
    }
  
    if (!this.wsClient) {
      await this.initialize(); // now safe
    }
  
    try {
      const unwatch = this.wsClient.watchPendingTransactions({
        onTransactions: callback,
        onError: (error) => {
          console.error('Pending transactions subscription error:', error);
          if (this.config.autoReconnect) {
            this.reconnectWebSocket();
          }
        },
      });
  
      this.subscriptions.set('pendingTxs', unwatch);
      return unwatch;
    } catch (error) {
      throw new Error(`Pending transactions subscription failed: ${error.message}`);
    }
  }
  
  
  /**
   * Health check for connection monitoring
   */
  async healthCheck() {
    try {
      const blockNumber = await this.publicClient.getBlockNumber();
      
      if (blockNumber > this.blockNumber) {
        this.connectionState = 'connected';
        return true;
      }
      
      // If block hasn't changed in a while, might be connection issue
      this.connectionState = 'slow';
      return false;
      
    } catch (error) {
      this.connectionState = 'error';
      return false;
    }
  }
  
  /**
   * Start periodic health checks
   */
  startHealthCheck() {
    setInterval(async () => {
      const isHealthy = await this.healthCheck();
      
      if (!isHealthy && this.config.autoReconnect) {
        await this.reconnect();
      }
    }, this.config.healthCheckInterval);
  }
  
  /**
   * Reconnect WebSocket client
   */
  async reconnectWebSocket() {
    try {
      // Unsubscribe from existing subscriptions
      for (const [key, unwatch] of this.subscriptions) {
        try {
          unwatch();
        } catch (error) {
          console.warn(`Failed to unwatch ${key}:`, error);
        }
      }
      this.subscriptions.clear();
      
      // Recreate WebSocket client
      this.wsClient = createMonadPublicClient({
        transport: 'websocket',
        pollingInterval: 500,
      });
      
      // Re-subscribe to blocks
      this.subscribeToBlocks();
      
      this.connectionState = 'connected';
      
    } catch (error) {
      console.error('WebSocket reconnection failed:', error);
      this.connectionState = 'error';
    }
  }
  
  /**
   * Full reconnection
   */
  async reconnect() {
    try {
      await this.initialize();
    } catch (error) {
      console.error('Reconnection failed:', error);
    }
  }
  
  /**
   * Clean up resources
   */
  destroy() {
    // Unsubscribe from all subscriptions
    for (const [key, unwatch] of this.subscriptions) {
      try {
        unwatch();
      } catch (error) {
        console.warn(`Failed to unwatch ${key}:`, error);
      }
    }
    this.subscriptions.clear();
    
    this.connectionState = 'disconnected';
  }
}
MonadClient.getInstance = function() {
  if (!MonadClient.instance) {
    MonadClient.instance = new MonadClient();
  }
  return MonadClient.instance;
};
// ===== SINGLETON CLIENT INSTANCE =====

/**
 * Default Monad client instance
 */
export const monadClient = MonadClient.getInstance();

// ===== UTILITY FUNCTIONS =====

/**
 * Check if connected to correct Monad network
 * @param {object} client - Public client instance
 * @returns {Promise<boolean>} True if on correct network
 */
export const validateMonadNetwork = async (client = monadClient.publicClient) => {
  try {
    const chainId = await client.getChainId();
    return chainId === MONAD_CONFIG.chainId;
  } catch (error) {
    return false;
  }
};

/**
 * Get current block information
 * @param {object} client - Public client instance
 * @returns {Promise<object>} Block information
 */
export const getCurrentBlock = async (client = monadClient.publicClient) => {
  try {
    const block = await client.getBlock();
    
    return {
      number: block.number.toString(),
      hash: block.hash,
      timestamp: Number(block.timestamp),
      gasLimit: block.gasLimit.toString(),
      gasUsed: block.gasUsed.toString(),
      baseFeePerGas: block.baseFeePerGas?.toString() || MONAD_CONFIG.baseFee.toString(),
      transactionCount: block.transactions.length,
    };
    
  } catch (error) {
    throw new Error(`Failed to get current block: ${error.message}`);
  }
};

// ===== EXPORTS =====
export default {
  monadTestnet,
  createMonadPublicClient,
  createMonadWalletClient,
  MonadClient,
  monadClient,
  validateMonadNetwork,
  getCurrentBlock
};