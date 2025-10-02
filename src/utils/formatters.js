import { formatUnits, parseUnits } from 'viem';
import { MONAD_CONFIG, SUPPORTED_TOKENS, UTILS } from './constants.js';

// ===== BLOCKCHAIN VALUE FORMATTERS =====

/**
 * Format wei/gwei values to human-readable strings
 * @param {bigint|string|number} value - Value in wei
 * @param {number} decimals - Token decimals (default: 18)
 * @param {number} precision - Display precision (default: 6)
 * @returns {string} Formatted value
 */
export const formatTokenAmount = (value, decimals = 18, precision = 6) => {
  if (!value || value === 0n || value === "0") return "0";
  
  try {
    const formatted = formatUnits(BigInt(value), decimals);
    const num = parseFloat(formatted);
    
    // Handle very small numbers
    if (num < 0.000001) {
      return num.toExponential(2);
    }
    
    // Handle large numbers with appropriate precision
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + "M";
    }
    
    if (num >= 1000) {
      return (num / 1000).toFixed(2) + "K";
    }
    
    // Standard formatting with dynamic precision
    const dynamicPrecision = num < 1 ? Math.min(precision, 8) : Math.min(precision, 4);
    return parseFloat(num.toFixed(dynamicPrecision)).toString();
    
  } catch (error) {
    console.error("Error formatting token amount:", error);
    return "0";
  }
};

/**
 * Parse human-readable amount to wei/gwei
 * @param {string|number} amount - Human readable amount
 * @param {number} decimals - Token decimals (default: 18)
 * @returns {bigint} Amount in wei/smallest unit
 */
export const parseTokenAmount = (amount, decimals = 18) => {
  if (!amount || amount === "" || amount === "0") return 0n;
  
  try {
    // Handle string inputs and remove commas
    const cleanAmount = amount.toString().replace(/,/g, "");
    return parseUnits(cleanAmount, decimals);
  } catch (error) {
    console.error("Error parsing token amount:", error);
    return 0n;
  }
};

/**
 * Format gas values (always in MON on Monad)
 * @param {bigint} gasUsed - Gas used in units
 * @param {bigint} gasPrice - Gas price in wei
 * @returns {object} Formatted gas info
 */
export const formatGasInfo = (gasUsed, gasPrice = MONAD_CONFIG.baseFee) => {
  const gasCostWei = gasUsed * gasPrice;
  const gasCostMON = formatTokenAmount(gasCostWei, 18, 6);
  
  return {
    gasUsed: gasUsed.toString(),
    gasPrice: (Number(gasPrice) / 1e9).toFixed(2) + "gwei", // Gas price in gwei
    gasCost: gasCostMON + " MON",
    gasCostWei: gasCostWei.toString()
  };
};

// ===== PRICE FORMATTERS =====

/**
 * Format price values with proper precision
 * @param {number|string} price - Price value
 * @param {string} currency - Currency symbol (default: "USD")
 * @param {boolean} compact - Use compact notation for large numbers
 * @returns {string} Formatted price
 */
export const formatPrice = (price, currency = "USD", compact = false) => {
  if (!price || price === 0) return `$0.00`;
  
  const numPrice = parseFloat(price);
  
  if (isNaN(numPrice)) return `$0.00`;
  
  // Handle compact notation for large numbers
  if (compact && numPrice >= 1000000) {
    return `$${(numPrice / 1000000).toFixed(2)}M`;
  }
  
  if (compact && numPrice >= 1000) {
    return `$${(numPrice / 1000).toFixed(2)}K`;
  }
  
  // Dynamic precision based on price range
  let precision = 2;
  if (numPrice < 0.01) precision = 6;
  else if (numPrice < 1) precision = 4;
  else if (numPrice >= 1000) precision = 0;
  
  const formatted = numPrice.toLocaleString('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  });
  
  return formatted;
};

/**
 * Format percentage values
 * @param {number|string} percentage - Percentage value (0.05 = 5%)
 * @param {number} precision - Decimal precision (default: 2)
 * @param {boolean} showSign - Always show + for positive values
 * @returns {string} Formatted percentage
 */
export const formatPercentage = (percentage, precision = 2, showSign = false) => {
  if (percentage === null || percentage === undefined) return "0%";
  
  const numPercentage = parseFloat(percentage) * 100;
  
  if (isNaN(numPercentage)) return "0%";
  
  const sign = showSign && numPercentage > 0 ? "+" : "";
  return `${sign}${numPercentage.toFixed(precision)}%`;
};

/**
 * Format price change with color coding info
 * @param {number} currentPrice - Current price
 * @param {number} previousPrice - Previous price for comparison
 * @returns {object} Price change info with formatting
 */
export const formatPriceChange = (currentPrice, previousPrice) => {
  if (!currentPrice || !previousPrice) {
    return {
      change: "0",
      changePercent: "0%",
      isPositive: false,
      isNegative: false,
      colorClass: "text-gray-400"
    };
  }
  
  const change = currentPrice - previousPrice;
  const changePercent = (change / previousPrice) * 100;
  
  return {
    change: formatPrice(Math.abs(change)),
    changePercent: formatPercentage(changePercent / 100, 2),
    isPositive: change > 0,
    isNegative: change < 0,
    colorClass: change > 0 ? "text-green-400" : change < 0 ? "text-red-400" : "text-gray-400"
  };
};

// ===== TIME FORMATTERS =====

/**
 * Format timestamp to human-readable date/time
 * @param {number|Date} timestamp - Timestamp in milliseconds or Date object
 * @param {object} options - Formatting options
 * @returns {string} Formatted date/time
 */
export const formatDateTime = (timestamp, options = {}) => {
  const {
    includeTime = true,
    includeSeconds = false,
    format = "short", // "short", "medium", "long"
    timezone = "UTC"
  } = options;
  
  if (!timestamp) return "Never";
  
  try {
    const date = new Date(timestamp);
    
    if (isNaN(date.getTime())) return "Invalid Date";
    
    const dateOptions = {
      timeZone: timezone,
      year: 'numeric',
      month: format === "long" ? 'long' : format === "medium" ? 'short' : 'numeric',
      day: 'numeric'
    };
    
    if (includeTime) {
      dateOptions.hour = '2-digit';
      dateOptions.minute = '2-digit';
      if (includeSeconds) {
        dateOptions.second = '2-digit';
      }
    }
    
    return date.toLocaleString('en-US', dateOptions);
    
  } catch (error) {
    console.error("Error formatting date:", error);
    return "Invalid Date";
  }
};

/**
 * Format duration in seconds to human-readable format
 * @param {number} seconds - Duration in seconds
 * @param {boolean} short - Use short format (1h vs 1 hour)
 * @returns {string} Formatted duration
 */
export const formatDuration = (seconds, short = false) => {
  if (!seconds || seconds <= 0) return short ? "0s" : "0 seconds";
  
  const units = [
    { label: short ? "d" : " day", value: 86400 },
    { label: short ? "h" : " hour", value: 3600 },
    { label: short ? "m" : " minute", value: 60 },
    { label: short ? "s" : " second", value: 1 }
  ];
  
  const parts = [];
  let remaining = seconds;
  
  for (const unit of units) {
    if (remaining >= unit.value) {
      const count = Math.floor(remaining / unit.value);
      const suffix = short ? unit.label : count > 1 ? unit.label + "s" : unit.label;
      parts.push(`${count}${suffix}`);
      remaining -= count * unit.value;
    }
    
    // Limit to 2 most significant units
    if (parts.length === 2) break;
  }
  
  return parts.join(short ? " " : ", ") || (short ? "0s" : "0 seconds");
};

/**
 * Format relative time (time ago/from now)
 * @param {number|Date} timestamp - Target timestamp
 * @param {number|Date} baseTime - Base time for comparison (default: now)
 * @returns {string} Relative time string
 */
export const formatRelativeTime = (timestamp, baseTime = Date.now()) => {
  if (!timestamp) return "Never";
  
  const target = new Date(timestamp).getTime();
  const base = new Date(baseTime).getTime();
  const diffMs = target - base;
  const diffSeconds = Math.abs(diffMs) / 1000;
  
  // Less than 1 minute
  if (diffSeconds < 60) {
    return diffMs < 0 ? "Just now" : "In a moment";
  }
  
  // Use duration formatter for the rest
  const duration = formatDuration(diffSeconds, true);
  return diffMs < 0 ? `${duration} ago` : `In ${duration}`;
};

// ===== ADDRESS FORMATTERS =====

/**
 * Format Ethereum address for display
 * @param {string} address - Ethereum address
 * @param {number} startLength - Characters to show at start (default: 6)
 * @param {number} endLength - Characters to show at end (default: 4)
 * @returns {string} Formatted address
 */
export const formatAddress = (address, startLength = 6, endLength = 4) => {
  if (!address || typeof address !== "string") return "Unknown";
  
  // Validate address format
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return address; // show raw if not strict hex

  
  if (address.length <= startLength + endLength + 2) {
    return address; // Address is already short enough
  }
  
  return `${address.slice(0, startLength)}...${address.slice(-endLength)}`;
};

/**
 * Format transaction hash for display
 * @param {string} hash - Transaction hash
 * @returns {string} Formatted hash
 */
export const formatTxHash = (hash) => {
  return formatAddress(hash, 8, 6);
};

// ===== DCA SPECIFIC FORMATTERS =====

/**
 * Format DCA strategy frequency
 * @param {number} intervalSeconds - Interval in seconds
 * @returns {string} Human-readable frequency
 */
export const formatDCAFrequency = (intervalSeconds) => {
  const frequencies = {
    3600: "Hourly",
    86400: "Daily", 
    604800: "Weekly",
    2592000: "Monthly"
  };
  
  return frequencies[intervalSeconds] || `Every ${formatDuration(intervalSeconds)}`;
};

/**
 * Format DCA strategy status
 * @param {string} status - Strategy status
 * @param {number} nextExecution - Next execution timestamp
 * @returns {object} Formatted status info
 */
export const formatDCAStatus = (status, nextExecution) => {
  const statusConfig = {
    ACTIVE: {
      label: "Active",
      color: "text-green-400",
      bgColor: "bg-green-400/10",
      description: nextExecution ? `Next: ${formatRelativeTime(nextExecution)}` : "Running"
    },
    PAUSED: {
      label: "Paused", 
      color: "text-yellow-400",
      bgColor: "bg-yellow-400/10",
      description: "Strategy paused by user"
    },
    COMPLETED: {
      label: "Completed",
      color: "text-blue-400", 
      bgColor: "bg-blue-400/10",
      description: "All executions completed"
    },
    FAILED: {
      label: "Failed",
      color: "text-red-400",
      bgColor: "bg-red-400/10", 
      description: "Execution failed - needs attention"
    }
  };
  
  return statusConfig[status] || statusConfig.FAILED;
};

// ===== UTILITY FORMATTERS =====

/**
 * Format large numbers with appropriate suffixes
 * @param {number|string} num - Number to format
 * @param {number} precision - Decimal precision
 * @returns {string} Formatted number
 */
export const formatCompactNumber = (num, precision = 2) => {
  if (!num || num === 0) return "0";
  
  const numValue = parseFloat(num);
  
  if (isNaN(numValue)) return "0";
  
  const abs = Math.abs(numValue);
  const sign = numValue < 0 ? "-" : "";
  
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(precision)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(precision)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(precision)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(precision)}K`;
  
  return numValue.toString();
};

/**
 * Format slippage tolerance
 * @param {number} slippage - Slippage as decimal (0.005 = 0.5%)
 * @returns {string} Formatted slippage
 */
export const formatSlippage = (slippage) => {
  if (!slippage) return "0%";
  return `${(parseFloat(slippage) * 100).toFixed(2)}%`;
};

/**
 * Sanitize and format user input
 * @param {string} input - Raw user input
 * @param {string} type - Input type: "number", "address", "amount"
 * @returns {string} Sanitized input
 */
export const sanitizeInput = (input, type = "text") => {
  if (!input || typeof input !== "string") return "";
  
  switch (type) {
    case "number":
      return input.replace(/[^0-9.]/g, "").slice(0, 20);
    
    case "address":
      if (input.startsWith("0x")) {
        return "0x" + input.slice(2).toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 40);
      }
      return input.trim().toLowerCase();
    
    case "amount":
      // Allow numbers, decimal point, and commas
      return input.replace(/[^0-9.,]/g, "").slice(0, 30);
    
    default:
      // Basic sanitization - remove dangerous characters
      return input.replace(/[<>'"&]/g, "").trim().slice(0, 1000);
  }
};

/**
 * Get token info by address or symbol
 * @param {string} tokenId - Token address or symbol
 * @returns {object|null} Token info or null if not found
 */
export const getTokenInfo = (tokenId) => {
  if (!tokenId) return null;
  
  const token = SUPPORTED_TOKENS.find(t => 
    t.address.toLowerCase() === tokenId.toLowerCase() ||
    t.symbol.toLowerCase() === tokenId.toLowerCase()
  );
  
  return token || null;
};

/**
 * Format token amount with symbol
 * @param {bigint|string} amount - Amount in smallest unit
 * @param {string} tokenAddress - Token address
 * @param {boolean} includeSymbol - Include token symbol
 * @returns {string} Formatted amount with symbol
 */
export const formatTokenAmountWithSymbol = (amount, tokenAddress, includeSymbol = true) => {
  const token = getTokenInfo(tokenAddress);
  
  if (!token) {
    return formatTokenAmount(amount, 18) + (includeSymbol ? " UNKNOWN" : "");
  }
  
  const formattedAmount = formatTokenAmount(amount, token.decimals);
  return includeSymbol ? `${formattedAmount} ${token.symbol}` : formattedAmount;
};

// ===== EXPORTS =====
export default {
  // Blockchain formatters
  formatTokenAmount,
  parseTokenAmount,
  formatGasInfo,
  
  // Price formatters
  formatPrice,
  formatPercentage,
  formatPriceChange,
  
  // Time formatters
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  
  // Address formatters
  formatAddress,
  formatTxHash,
  
  // DCA formatters
  formatDCAFrequency,
  formatDCAStatus,
  
  // Utility formatters
  formatCompactNumber,
  formatSlippage,
  sanitizeInput,
  getTokenInfo,
  formatTokenAmountWithSymbol
};