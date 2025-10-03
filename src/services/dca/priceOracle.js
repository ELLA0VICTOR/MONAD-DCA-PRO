import { parseUnits, formatUnits, encodeFunctionData, decodeFunctionResult } from 'viem';
import { monadClient } from '../monad/monadClient.js';
import { validateAddress, validatePriceData } from '../../utils/validators.js';
import { formatPrice, formatPercentage, formatDateTime } from '../../utils/formatters.js';
import axios from 'axios';
import { 
  CONTRACTS, 
  SUPPORTED_TOKENS, 
  ORACLE_CONFIG,
  MONAD_CONFIG 
} from '../../utils/constants.js';

// Pyth Oracle ABI - Essential functions for price feeds
const PYTH_ORACLE_ABI = [
  {
    "inputs": [{"name": "id", "type": "bytes32"}],
    "name": "getPrice",
    "outputs": [
      {
        "components": [
          {"name": "price", "type": "int64"},
          {"name": "conf", "type": "uint64"},
          {"name": "expo", "type": "int32"},
          {"name": "publishTime", "type": "uint256"}
        ],
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "id", "type": "bytes32"}],
    "name": "getEmaPrice",
    "outputs": [
      {
        "components": [
          {"name": "price", "type": "int64"},
          {"name": "conf", "type": "uint64"},
          {"name": "expo", "type": "int32"},
          {"name": "publishTime", "type": "uint256"}
        ],
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "id", "type": "bytes32"}],
    "name": "getPriceUnsafe",
    "outputs": [
      {
        "components": [
          {"name": "price", "type": "int64"},
          {"name": "conf", "type": "uint64"},
          {"name": "expo", "type": "int32"},
          {"name": "publishTime", "type": "uint256"}
        ],
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "priceUpdateData", "type": "bytes[]"}
    ],
    "name": "updatePriceFeeds",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
];

// Price feed status
const PRICE_STATUS = {
  ACTIVE: 'active',
  STALE: 'stale',
  INACTIVE: 'inactive',
  ERROR: 'error'
};

// Price sources
const PRICE_SOURCES = {
  PYTH_MAINNET: 'pyth_mainnet',
  PYTH_BETA: 'pyth_beta',  // For MON/USD
  UNISWAP_V3: 'uniswap_v3',
  CACHED: 'cached',
  FALLBACK: 'fallback'
};

// TWAP calculation methods
const TWAP_METHODS = {
  SIMPLE: 'simple',           // Simple average
  WEIGHTED: 'weighted',       // Volume weighted
  EMA: 'exponential',         // Exponential moving average
  TIME_WEIGHTED: 'time_weighted' // Time-weighted average price
};
async function fetchFromHermes(feedIds, useBeta = false) {
  const baseUrl = useBeta 
    ? "https://hermes-beta.pyth.network" 
    : "https://hermes.pyth.network";

  try {
    const url = `${baseUrl}/v2/updates/price/latest?${feedIds.map(id => `ids[]=${id}`).join("&")}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Hermes fetch failed: ${response.status}`);
    const data = await response.json();
    return { success: true, data: data.parsed };
  } catch (error) {
    console.error("Hermes fetch error:", error);
    return { success: false, error: error.message };
  }
}


/**
 * Price Oracle Service
 * Manages real-time price feeds and TWAP calculations
 */
class PriceOracleService {
  constructor() {
    this.priceCache = new Map();
    this.twapCache = new Map();
    this.priceHistory = new Map();
    this.feedSubscriptions = new Map();
    this.updateCallbacks = new Map();
    this.initialized = false;
    this.updateTimer = null;
  }

  /**
   * Initialize the price oracle service
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Validate Pyth oracle contract
      await this.validateOracleContract();
      
      // Initialize supported price feeds
      await this.initializePriceFeeds();
      
      // Start price update scheduler
      this.startPriceUpdates();
      
      this.initialized = true;
      console.log('PriceOracleService initialized with', this.feedSubscriptions.size, 'price feeds');
    } catch (error) {
      console.error('Failed to initialize PriceOracleService:', error);
      throw new Error(`Price oracle initialization failed: ${error.message}`);
    }
  }

  /**
   * Get current price for a token pair
   */
  async getPrice(tokenSymbol, baseCurrency = 'USD', options = {}) {
    if (!this.initialized) {
      throw new Error('Price oracle not initialized');
    }

    const {
      maxStaleTime = ORACLE_CONFIG.maxPriceAge,
      useCache = true,
      source = 'auto',
      includeMeta = false
    } = options;

    const feedKey = `${tokenSymbol.toUpperCase()}/${baseCurrency.toUpperCase()}`;

    try {
      // Check cache first if enabled
      if (useCache) {
        const cached = this.priceCache.get(feedKey);
        if (cached && (Date.now() - cached.timestamp) < maxStaleTime) {
          return {
            success: true,
            price: cached.price,
            confidence: cached.confidence,
            timestamp: cached.timestamp,
            source: cached.source,
            meta: includeMeta ? cached.meta : undefined
          };
        }
      }

      // Get fresh price from oracle
      const priceResult = await this.fetchPriceFromOracle(feedKey, source);
      
      if (!priceResult.success) {
        // Try fallback sources
        const fallbackResult = await this.tryFallbackSources(feedKey);
        if (fallbackResult.success) {
          return fallbackResult;
        }
        throw new Error(`Failed to get price: ${priceResult.error}`);
      }

      // Validate price data
      const validation = validatePriceData(priceResult.data);
      if (!validation.isValid) {
        throw new Error(`Invalid price data: ${validation.errors.join(', ')}`);
      }

      // Process and cache the price
      const processedPrice = this.processPriceData(priceResult.data, feedKey);
      
      // Cache the result
      if (useCache) {
        this.priceCache.set(feedKey, {
          ...processedPrice,
          timestamp: Date.now()
        });
      }

      // Update price history
      this.updatePriceHistory(feedKey, processedPrice);

      return {
        success: true,
        price: processedPrice.price,
        confidence: processedPrice.confidence,
        timestamp: processedPrice.timestamp,
        source: processedPrice.source,
        meta: includeMeta ? processedPrice.meta : undefined
      };

    } catch (error) {
      console.error(`Failed to get price for ${feedKey}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Fetch latest USD price for a given token symbol
  
 









  /**
   * Get Time-Weighted Average Price (TWAP)
   */
  async getTWAP(tokenSymbol, baseCurrency = 'USD', options = {}) {
    const {
      period = ORACLE_CONFIG.TWAP_PERIOD,
      method = TWAP_METHODS.TIME_WEIGHTED,
      intervals = 60, // Number of data points
      useCache = true
    } = options;

    const feedKey = `${tokenSymbol.toUpperCase()}/${baseCurrency.toUpperCase()}`;
    const twapKey = `${feedKey}_${period}_${method}`;

    try {
      // Check cache first
      if (useCache) {
        const cached = this.twapCache.get(twapKey);
        if (cached && (Date.now() - cached.timestamp) < ORACLE_CONFIG.TWAP_CACHE_TIME) {
          return {
            success: true,
            twap: cached.twap,
            period,
            method,
            dataPoints: cached.dataPoints,
            timestamp: cached.timestamp
          };
        }
      }

      // Get price history for the period
      const history = await this.getPriceHistory(feedKey, period, intervals);
      if (history.length < 2) {
        throw new Error('Insufficient price history for TWAP calculation');
      }

      // Calculate TWAP based on method
      let twap;
      switch (method) {
        case TWAP_METHODS.SIMPLE:
          twap = this.calculateSimpleTWAP(history);
          break;
        case TWAP_METHODS.WEIGHTED:
          twap = this.calculateWeightedTWAP(history);
          break;
        case TWAP_METHODS.EMA:
          twap = this.calculateEMATWAP(history);
          break;
        case TWAP_METHODS.TIME_WEIGHTED:
        default:
          twap = this.calculateTimeWeightedTWAP(history);
          break;
      }

      // Cache the result
      if (useCache) {
        this.twapCache.set(twapKey, {
          twap,
          dataPoints: history.length,
          timestamp: Date.now()
        });
      }

      return {
        success: true,
        twap,
        period,
        method,
        dataPoints: history.length,
        timestamp: Date.now()
      };

    } catch (error) {
      console.error(`Failed to calculate TWAP for ${feedKey}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get multiple prices in a single call
   */
  async getMultiplePrices(tokenPairs, options = {}) {
    const {
      maxStaleTime = ORACLE_CONFIG.maxPriceAge,
      useCache = true,
      failOnError = false
    } = options;

    const results = new Map();
    const promises = tokenPairs.map(async ({ token, base = 'USD' }) => {
      try {
        const result = await this.getPrice(token, base, { maxStaleTime, useCache });
        results.set(`${token}/${base}`, result);
      } catch (error) {
        if (failOnError) {
          throw error;
        }
        results.set(`${token}/${base}`, {
          success: false,
          error: error.message
        });
      }
    });

    await Promise.all(promises);

    const successful = Array.from(results.values()).filter(r => r.success).length;
    const failed = results.size - successful;

    return {
      success: failed === 0 || !failOnError,
      results: Object.fromEntries(results),
      summary: {
        total: results.size,
        successful,
        failed,
        successRate: (successful / results.size) * 100
      }
    };
  }

  /**
   * Calculate price change percentage
   */
  async getPriceChange(tokenSymbol, baseCurrency = 'USD', period = 24 * 60 * 60 * 1000) {
    const feedKey = `${tokenSymbol.toUpperCase()}/${baseCurrency.toUpperCase()}`;

    try {
      // Get current price
      const currentResult = await this.getPrice(tokenSymbol, baseCurrency);
      if (!currentResult.success) {
        throw new Error(`Failed to get current price: ${currentResult.error}`);
      }

      // Get historical price
      const historicalPrice = await this.getHistoricalPrice(feedKey, Date.now() - period);
      if (!historicalPrice) {
        throw new Error('Historical price not available');
      }

      // Calculate change
      const currentPrice = currentResult.price;
      const change = currentPrice - historicalPrice;
      const changePercentage = (change / historicalPrice) * 100;

      return {
        success: true,
        currentPrice,
        historicalPrice,
        change,
        changePercentage,
        period,
        direction: change >= 0 ? 'up' : 'down'
      };

    } catch (error) {
      console.error(`Failed to calculate price change for ${feedKey}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Subscribe to price updates
   */
  subscribeToPrice(tokenSymbol, baseCurrency = 'USD', callback, options = {}) {
    const feedKey = `${tokenSymbol.toUpperCase()}/${baseCurrency.toUpperCase()}`;
    const subscriptionId = `${feedKey}_${Date.now()}_${Math.random()}`;

    const subscription = {
      id: subscriptionId,
      feedKey,
      callback,
      options: {
        minPriceChange: options.minPriceChange || 0.1, // 0.1%
        maxStaleTime: options.maxStaleTime || ORACLE_CONFIG.maxPriceAge,
        includeMeta: options.includeMeta || false
      },
      lastPrice: null,
      lastUpdate: null,
      active: true
    };

    // Store subscription
    if (!this.updateCallbacks.has(feedKey)) {
      this.updateCallbacks.set(feedKey, new Map());
    }
    this.updateCallbacks.get(feedKey).set(subscriptionId, subscription);

    console.log(`Created price subscription ${subscriptionId} for ${feedKey}`);

    // Return subscription control
    return {
      id: subscriptionId,
      feedKey,
      unsubscribe: () => this.unsubscribeFromPrice(subscriptionId),
      isActive: () => subscription.active
    };
  }

  /**
   * Unsubscribe from price updates
   */
  unsubscribeFromPrice(subscriptionId) {
    for (const [feedKey, callbacks] of this.updateCallbacks.entries()) {
      if (callbacks.has(subscriptionId)) {
        callbacks.delete(subscriptionId);
        if (callbacks.size === 0) {
          this.updateCallbacks.delete(feedKey);
        }
        console.log(`Removed price subscription ${subscriptionId}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Get price feed status and health
   */
  async getFeedStatus(tokenSymbol, baseCurrency = 'USD') {
    const feedKey = `${tokenSymbol.toUpperCase()}/${baseCurrency.toUpperCase()}`;

    try {
      // Get latest price
      const priceResult = await this.getPrice(tokenSymbol, baseCurrency, { useCache: false });
      
      if (!priceResult.success) {
        return {
          feedKey,
          status: PRICE_STATUS.ERROR,
          error: priceResult.error,
          lastUpdate: null
        };
      }

      // Check staleness
      const age = Date.now() - priceResult.timestamp;
      let status;
      if (age > ORACLE_CONFIG.maxPriceAge) {
        status = PRICE_STATUS.STALE;
      } else if (age > ORACLE_CONFIG.maxPriceAge * 5) {
        status = PRICE_STATUS.INACTIVE;
      } else {
        status = PRICE_STATUS.ACTIVE;
      }

      // Get update frequency stats
      const history = this.priceHistory.get(feedKey) || [];
      const recentUpdates = history.filter(h => Date.now() - h.timestamp < 60 * 60 * 1000); // Last hour
      
      return {
        feedKey,
        status,
        currentPrice: priceResult.price,
        confidence: priceResult.confidence,
        lastUpdate: priceResult.timestamp,
        age,
        source: priceResult.source,
        updateFrequency: {
          lastHour: recentUpdates.length,
          average: history.length > 1 ? this.calculateAverageUpdateInterval(history) : null
        },
        historicalDataPoints: history.length
      };

    } catch (error) {
      return {
        feedKey,
        status: PRICE_STATUS.ERROR,
        error: error.message,
        lastUpdate: null
      };
    }
  }

  /**
   * Get all supported price feeds
   */
  getSupportedFeeds() {
    const feeds = [];
    
    for (const tokenInfo of SUPPORTED_TOKENS) {
      if (tokenInfo.priceFeedId) {
        feeds.push({
          symbol: tokenInfo.symbol,
          name: tokenInfo.name,
          address: tokenInfo.address,
          decimals: tokenInfo.decimals,
          oracleId: tokenInfo.priceFeedId,
          baseCurrency: 'USD',
          feedKey: `${tokenInfo.symbol}/USD`,
          source: tokenInfo.symbol === 'MON'
            ? PRICE_SOURCES.PYTH_BETA
            : PRICE_SOURCES.PYTH_MAINNET
        });
      }
    }
    

    return feeds;
  }

  // --- PRIVATE HELPER METHODS ---

  async validateOracleContract() {
    try {
      const code = await monadClient.getBytecode({ address: CONTRACTS.PythOracle });
      if (!code || code === '0x') {
        throw new Error(`Pyth oracle contract not deployed at ${CONTRACTS.PythOracle}`);
      }
      console.log('Pyth oracle contract validated');
    } catch (error) {
      throw new Error(`Failed to validate oracle contract: ${error.message}`);
    }
  }

  async initializePriceFeeds() {
    const supportedFeeds = this.getSupportedFeeds();
    
    for (const feed of supportedFeeds) {
      try {
        // Test feed by getting a price
        const testResult = await this.fetchPriceFromOracle(feed.feedKey, feed.source);
        if (testResult.success) {
          this.feedSubscriptions.set(feed.feedKey, {
            ...feed,
            status: PRICE_STATUS.ACTIVE,
            lastUpdate: Date.now()
          });
          console.log(`Initialized price feed: ${feed.feedKey}`);
        } else {
          console.warn(`Failed to initialize feed ${feed.feedKey}: ${testResult.error}`);
        }
      } catch (error) {
        console.warn(`Error initializing feed ${feed.feedKey}: ${error.message}`);
      }
    }
  }

  async fetchPriceFromOracle(feedKey, source) {
    const [tokenSymbol, baseCurrency] = feedKey.split('/');
    try {
      // Get token info
      const getTokenInfo = (symbol) =>
        SUPPORTED_TOKENS.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
      const tokenInfo = getTokenInfo(tokenSymbol);
      if (!tokenInfo || !tokenInfo.priceFeedId) {
        throw new Error(`No PriceFeedId configured for ${tokenSymbol}`);
      }

      // Determine endpoint based on token
      const isMonToken = tokenSymbol === 'MON';
      const hermesResult = await fetchFromHermes([tokenInfo.priceFeedId], isMonToken);
      if (hermesResult.success && hermesResult.data.length > 0) {
        const hermesPrice = hermesResult.data[0];
        return {
          success: true,
          data: {
            price: hermesPrice.price.price,
            confidence: hermesPrice.price.conf,
            expo: hermesPrice.price.expo,
            publishTime: hermesPrice.price.publish_time,
            source: isMonToken ? PRICE_SOURCES.PYTH_BETA : PRICE_SOURCES.PYTH_MAINNET
      }
    };
  }
      const oracleEndpoint = isMonToken ? 
        ORACLE_CONFIG.pythEndpoint : 
        "https://hermes.pyth.network";

      // For on-chain oracle call
      const priceCalldata = encodeFunctionData({
        abi: PYTH_ORACLE_ABI,
        functionName: 'getPrice',
        args: [tokenInfo.priceFeedId]
      });

      const oracleAddress = isMonToken ? CONTRACTS.PythOracleBeta : CONTRACTS.PythOracle;
      const result = await monadClient.call({
        to: oracleAddress,
        data: priceCalldata
      });

      const [priceData] = decodeFunctionResult({
        abi: PYTH_ORACLE_ABI,
        functionName: 'getPrice',
        data: result.data
      });

      return {
        success: true,
        data: {
          price: priceData.price,
          confidence: priceData.conf,
          expo: priceData.expo,
          publishTime: Number(priceData.publishTime),
          source: isMonToken ? PRICE_SOURCES.PYTH_BETA : PRICE_SOURCES.PYTH_MAINNET
        }
      };

    } catch (error) {
      console.error(`Failed to fetch price from oracle for ${feedKey}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async tryFallbackSources(feedKey) {
    // Try Uniswap V3 as fallback
    try {
      const uniswapPrice = await this.getUniswapV3Price(feedKey);
      if (uniswapPrice.success) {
        return {
          success: true,
          price: uniswapPrice.price,
          confidence: 0, // No confidence data from Uniswap
          timestamp: Date.now(),
          source: PRICE_SOURCES.UNISWAP_V3
        };
      }
    } catch (error) {
      console.warn(`Uniswap V3 fallback failed for ${feedKey}:`, error);
    }

    // Try cached data as last resort
    const cached = this.priceCache.get(feedKey);
    if (cached && (Date.now() - cached.timestamp) < ORACLE_CONFIG.maxPriceAge * 10) {
      return {
        success: true,
        price: cached.price,
        confidence: cached.confidence,
        timestamp: cached.timestamp,
        source: PRICE_SOURCES.CACHED
      };
    }

    return {
      success: false,
      error: 'All price sources failed'
    };
  }

  async getUniswapV3Price(feedKey) {
    // Implementation would query Uniswap V3 pools for price data
    // This is a simplified placeholder
    return {
      success: false,
      error: 'Uniswap V3 price oracle not implemented'
    };
  }
  // price (BigInt): token price in USD, scaled by 1e18
 // confidence (BigInt): confidence interval, scaled by 1e18
// Example: if token = $2000.50 → price = 2000500000000000000000n
  processPriceData(rawData, feedKey) {
    // Convert Pyth price format to standardized format
    const price = Number(rawData.price) * Math.pow(10, rawData.expo);
    const confidence = Number(rawData.confidence) * Math.pow(10, rawData.expo);
    
    return {
      price: parseUnits(price.toFixed(18), 18),
      confidence: parseUnits(confidence.toFixed(18), 18),
      confidenceInterval: confidence / price * 100, // Confidence as percentage
      timestamp: rawData.publishTime * 1000, // Convert to milliseconds
      source: rawData.source,
      meta: {
        rawPrice: rawData.price,
        rawConfidence: rawData.confidence,
        expo: rawData.expo,
        feedKey
      }
    };
  }

  updatePriceHistory(feedKey, priceData) {
    if (!this.priceHistory.has(feedKey)) {
      this.priceHistory.set(feedKey, []);
    }

    const history = this.priceHistory.get(feedKey);
    history.push({
      price: priceData.price,
      timestamp: priceData.timestamp,
      confidence: priceData.confidence
    });

    // Keep only last 1000 data points per feed
    if (history.length > 1000) {
      this.priceHistory.set(feedKey, history.slice(-1000));
    }
  }

  async getPriceHistory(feedKey, period, maxPoints = 100) {
    const history = this.priceHistory.get(feedKey) || [];
    const cutoff = Date.now() - period;
    
    const relevantHistory = history.filter(h => h.timestamp > cutoff);
    
    // Subsample if we have too many points
    if (relevantHistory.length > maxPoints) {
      const step = Math.floor(relevantHistory.length / maxPoints);
      return relevantHistory.filter((_, index) => index % step === 0);
    }
    
    return relevantHistory;
  }

  async getHistoricalPrice(feedKey, timestamp) {
    const history = this.priceHistory.get(feedKey) || [];
    
    // Find closest price to the requested timestamp
    let closest = null;
    let minDiff = Infinity;
    
    for (const point of history) {
      const diff = Math.abs(point.timestamp - timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closest = point;
      }
    }
    
    // Return price if within 1 hour of requested time
    if (closest && minDiff < 60 * 60 * 1000) {
      return Number(formatUnits(closest.price, 18));
    }
    
    return null;
  }

  calculateSimpleTWAP(history) {
    const sum = history.reduce((acc, point) => acc + Number(formatUnits(point.price, 18)), 0);
    return parseUnits((sum / history.length).toFixed(18), 18);
  }

  calculateWeightedTWAP(history) {
    // For now, use simple TWAP (would need volume data for proper weighting)
    return this.calculateSimpleTWAP(history);
  }

  calculateEMATWAP(history, alpha = 0.1) {
    if (history.length === 0) return 0n;
    
    let ema = Number(formatUnits(history[0].price, 18));
    
    for (let i = 1; i < history.length; i++) {
      const price = Number(formatUnits(history[i].price, 18));
      ema = alpha * price + (1 - alpha) * ema;
    }
    
    return parseUnits(ema.toFixed(18), 18);
  }

  calculateTimeWeightedTWAP(history) {
    if (history.length < 2) return history[0]?.price || 0n;
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = 1; i < history.length; i++) {
      const timeDiff = history[i].timestamp - history[i-1].timestamp;
      const price = Number(formatUnits(history[i-1].price, 18));
      
      weightedSum += price * timeDiff;
      totalWeight += timeDiff;
    }
    
    const twap = totalWeight > 0 ? weightedSum / totalWeight : 0;
    return parseUnits(twap.toFixed(18), 18);
  }

  calculateAverageUpdateInterval(history) {
    if (history.length < 2) return null;
    
    const intervals = [];
    for (let i = 1; i < history.length; i++) {
      intervals.push(history[i].timestamp - history[i-1].timestamp);
    }
    
    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    return Math.round(avgInterval / 1000); // Return in seconds
  }

  startPriceUpdates() {
    // Update prices every 30 seconds
    this.updateTimer = setInterval(async () => {
      try {
        await this.updateAllPrices();
      } catch (error) {
        console.error('Price update cycle failed:', error);
      }
    }, ORACLE_CONFIG.priceUpdateInterval);

    console.log(`Started price update scheduler (${ORACLE_CONFIG.priceUpdateInterval / 1000}s interval)`);
  }

  async updateAllPrices() {
    const updatePromises = [];
    
    for (const [feedKey, feed] of this.feedSubscriptions.entries()) {
      updatePromises.push(this.updateSinglePrice(feedKey, feed));
    }
    
    const results = await Promise.allSettled(updatePromises);
    
    // Process results and trigger callbacks
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled' && result.value) {
        this.triggerPriceCallbacks(result.value.feedKey, result.value);
      }
    }
  }

  async updateSinglePrice(feedKey, feed) {
    try {
      const priceResult = await this.getPrice(feed.symbol, 'USD', { useCache: false });
      if (priceResult.success) {
        return {
          feedKey,
          price: priceResult.price,
          timestamp: priceResult.timestamp,
          source: priceResult.source
        };
      }
    } catch (error) {
      console.error(`Failed to update price for ${feedKey}:`, error);
    }
    return null;
  }

  triggerPriceCallbacks(feedKey, priceData) {
    const callbacks = this.updateCallbacks.get(feedKey);
    if (!callbacks) return;

    for (const [subscriptionId, subscription] of callbacks.entries()) {
      if (!subscription.active) continue;

      try {
        // Check if price change is significant enough
        if (subscription.lastPrice) {
          const oldPrice = Number(formatUnits(subscription.lastPrice, 18));
          const newPrice = Number(formatUnits(priceData.price, 18));
          const changePercent = Math.abs((newPrice - oldPrice) / oldPrice) * 100;

          if (changePercent < subscription.options.minPriceChange) {
            continue; // Skip if change is not significant
          }
        }

        // Trigger callback
        subscription.callback({
          feedKey,
          price: priceData.price,
          timestamp: priceData.timestamp,
          source: priceData.source,
          subscriptionId,
          changeFromLast: subscription.lastPrice ? 
            Number(formatUnits(priceData.price, 18)) - Number(formatUnits(subscription.lastPrice, 18)) : 0
        });

        // Update subscription state
        subscription.lastPrice = priceData.price;
        subscription.lastUpdate = priceData.timestamp;

      } catch (error) {
        console.error(`Price callback failed for subscription ${subscriptionId}:`, error);
      }
    }
  }

  /**
   * Get service health and statistics
   */
  getServiceHealth() {
    const now = Date.now();
    const activeFeeds = Array.from(this.feedSubscriptions.values()).filter(
      feed => feed.status === PRICE_STATUS.ACTIVE
    ).length;

    const totalSubscriptions = Array.from(this.updateCallbacks.values())
      .reduce((sum, callbacks) => sum + callbacks.size, 0);

    const cacheStats = {
      priceCache: this.priceCache.size,
      twapCache: this.twapCache.size,
      historySize: Array.from(this.priceHistory.values()).reduce((sum, arr) => sum + arr.length, 0)
    };

    return {
      initialized: this.initialized,
      priceFeeds: {
        total: this.feedSubscriptions.size,
        active: activeFeeds,
        inactive: this.feedSubscriptions.size - activeFeeds
      },
      subscriptions: {
        total: totalSubscriptions,
        activeFeeds: this.updateCallbacks.size
      },
      cache: cacheStats,
      updateScheduler: {
        running: this.updateTimer !== null,
        interval: ORACLE_CONFIG.priceUpdateInterval,
        lastUpdate: now
      },
      supportedTokens: SUPPORTED_TOKENS.length
    };
  }

  /**
   * Clear all caches
   */
  clearCache() {
    this.priceCache.clear();
    this.twapCache.clear();
    console.log('Price oracle caches cleared');
  }

  /**
   * Emergency stop price updates
   */
  emergencyStop(reason = 'emergency_stop') {
    console.warn(`Price oracle emergency stop activated: ${reason}`);
    
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    
    // Deactivate all subscriptions
    for (const callbacks of this.updateCallbacks.values()) {
      for (const subscription of callbacks.values()) {
        subscription.active = false;
      }
    }
    
    return {
      success: true,
      reason,
      stoppedAt: Date.now()
    };
  }

  /**
   * Restart price updates after emergency stop
   */
  restartUpdates() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    
    // Reactivate subscriptions
    for (const callbacks of this.updateCallbacks.values()) {
      for (const subscription of callbacks.values()) {
        subscription.active = true;
      }
    }
    
    this.startPriceUpdates();
    
    console.log('Price oracle updates restarted');
    return {
      success: true,
      restartedAt: Date.now()
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    this.priceCache.clear();
    this.twapCache.clear();
    this.priceHistory.clear();
    this.feedSubscriptions.clear();
    this.updateCallbacks.clear();
    this.initialized = false;

    console.log('PriceOracleService destroyed');
  }
}

// Create singleton instance
const priceOracle = new PriceOracleService();

// Helper functions for common operations
export const getPrice = (tokenSymbol, baseCurrency, options) => 
  priceOracle.getPrice(tokenSymbol, baseCurrency, options);

export const getTWAP = (tokenSymbol, baseCurrency, options) => 
  priceOracle.getTWAP(tokenSymbol, baseCurrency, options);

export const getMultiplePrices = (tokenPairs, options) => 
  priceOracle.getMultiplePrices(tokenPairs, options);

export const getPriceChange = (tokenSymbol, baseCurrency, period) => 
  priceOracle.getPriceChange(tokenSymbol, baseCurrency, period);

export const subscribeToPrice = (tokenSymbol, baseCurrency, callback, options) => 
  priceOracle.subscribeToPrice(tokenSymbol, baseCurrency, callback, options);

export const unsubscribeFromPrice = (subscriptionId) => 
  priceOracle.unsubscribeFromPrice(subscriptionId);

export const getFeedStatus = (tokenSymbol, baseCurrency) => 
  priceOracle.getFeedStatus(tokenSymbol, baseCurrency);

export const getSupportedFeeds = () => 
  priceOracle.getSupportedFeeds();

export const getPriceOracleHealth = () => 
  priceOracle.getServiceHealth();

export const clearPriceCache = () => 
  priceOracle.clearCache();

// Fetch latest USD price for a given token symbol
export async function getPriceInUSD(symbol) {
  try {
    const token = SUPPORTED_TOKENS.find(t => t.symbol === symbol);
    if (!token || !token.priceFeedId) throw new Error(`No price feed for ${symbol}`);

    const response = await axios.get(
      `${ORACLE_CONFIG.pythEndpoint}/v2/price_feeds/${token.priceFeedId}`
    );

    const price = response.data?.price?.price;
    const expo = response.data?.price?.expo || -8;

    if (price === undefined) throw new Error(`Price unavailable for ${symbol}`);

    return price * 10 ** expo; // normalized USD price
  } catch (err) {
    console.error(`[priceOracle] getPriceInUSD error for ${symbol}:`, err);
    return null;
  }
}

// Convert a token balance (BigInt) into USD value
export async function convertBalanceToUSD(symbol, rawBalance, decimals) {
  const price = await getPriceInUSD(symbol);
  if (!price) return null;

  const amount = parseFloat(formatUnits(rawBalance, decimals));
  return amount * price;
}

// Export main class, singleton, and constants
export { 
  PriceOracleService,
  priceOracle,
  PRICE_STATUS,
  PRICE_SOURCES,
  TWAP_METHODS
};