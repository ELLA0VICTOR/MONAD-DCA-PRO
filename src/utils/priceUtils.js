import { formatUnits } from 'viem';
import { SUPPORTED_TOKENS } from '../utils/constants';

/**
 * Lightweight price conversion utility.
 * Replaces old priceOracle.convertBalanceToUSD without Pyth or backend dependencies.
 */

// Simple static USD price map (fallback values)
const STATIC_PRICES = {
  MON: 0.25,     // $0.25 per MON (example)
  WETH: 4200,    // $1,800 per ETH
  WBTC: 114000,   // $65,000 per BTC
  USDC: 1,       // Stable at $1
};

/**
 * Get the approximate USD price for a given symbol.
 * Later, you can easily plug in a live API (like CoinGecko).
 */
export async function getPriceInUSD(symbol) {
  try {
    const upperSymbol = symbol?.toUpperCase?.();
    const staticPrice = STATIC_PRICES[upperSymbol];
    if (staticPrice) return staticPrice;

    // Fallback for unknown tokens: 0
    const token = SUPPORTED_TOKENS.find(t => t.symbol === upperSymbol);
    if (!token) return 0;
    return 0; // Unknown tokens assumed zero until added
  } catch (err) {
    console.error(`[priceUtils] getPriceInUSD error for ${symbol}:`, err);
    return 0;
  }
}

/**
 * Convert a raw token balance to USD equivalent.
 * 
 * @param {string} symbol - Token symbol (e.g. "MON", "USDC")
 * @param {bigint} rawBalance - Raw token balance (BigInt)
 * @param {number} decimals - Token decimals
 * @returns {Promise<number|null>} USD value
 */
export async function convertBalanceToUSD(symbol, rawBalance, decimals = 18) {
  try {
    const price = await getPriceInUSD(symbol);
    if (!price || isNaN(price)) return null;

    const amount = Number(formatUnits(rawBalance, decimals));
    const usdValue = amount * price;
    return Number(usdValue.toFixed(4));
  } catch (err) {
    console.error(`[priceUtils] convertBalanceToUSD failed for ${symbol}:`, err);
    return null;
  }
}
