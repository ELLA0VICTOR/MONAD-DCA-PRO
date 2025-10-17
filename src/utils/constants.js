// ===== MONAD NETWORK CONFIGURATION =====
export const MONAD_CONFIG = {
  // Network Identifiers
  chainId: 10143,
  name: "Monad Testnet",
  currency: "MON",
  decimals: 18,
  
  // RPC Endpoints
  rpcUrl: "https://testnet-rpc.monad.xyz",
  wsUrl: "wss://testnet-rpc.monad.xyz",
  explorer: "https://testnet.monadexplorer.com",
  
  // Gas Configuration (CRITICAL - Monad charges gas_limit not gas_used)
  baseFee: 50n * 10n**9n, // 50 gwei HARDCODED on testnet
  maxGasPerTx: 30_000_000,
  blockGasLimit: 150_000_000,
  chargeGasLimit: true, // IMPORTANT: Charges gas_limit not gas_used
  
  // Block Timing (400ms blocks)
  blockTime: 400, // milliseconds
  speculativeFinality: 400, // milliseconds  
  fullFinality: 800, // milliseconds
  
  // Transaction Ordering
  priorityGasAuction: true, // Descending gas price ordering
  maxRetries: 3,
  retryBackoffMs: 1000
};

// ===== SMART ACCOUNT CONFIGURATION =====
export const SMART_ACCOUNT_CONFIG = {
  // Implementation types
  implementation: "Hybrid", // Supports EOA + passkeys
  
  // Deploy parameters format: [owner, [], [], []]
  deployParamsTemplate: (owner) => [owner, [], [], []],
  
  // Deterministic deployment
  deploySalt: "0x0000000000000000000000000000000000000000000000000000000000000000",
  
  // Account features
  supportsPasskeys: true,
  supportsEOA: true,
  deterministicAddresses: true
};

// ===== CONTRACT ADDRESSES (Monad Testnet) =====
export const CONTRACTS = {
  // ===== Account Abstraction Infrastructure =====
  EntryPoint_v06: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
  EntryPoint_v07: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  
  // ===== Uniswap V3 Core =====
  UniswapV3Factory: "0x961235a9020b05c44df1026d956d1f4d78014276",
  UniversalRouter: "0x3ae6d8a282d67893e17aa70ebffb33ee5aa65893",
  QuoterV2: "0x1b4e313fef15630af3e6f2de550dbf4cc9d3081d",
  NonfungiblePositionManager: "0x3dcc735c74f10fe2b9db2bb55c40fbbbf24490f7",
  Multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  SwapRouter02: "0x4c4eabd5fb1d1a7234a48692551eaecff8194ca7",

  
  // ===== Token Addresses =====
  WMON: "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701", // Wrapped MON
  USDC: "0xf817257fed379853cDe0fa4F97AB987181B1E5Ea", // USD Coin
  WBTC: "0xcf5a6076cfa32686c0Df13aBaDa2b40dec133F1d", // Wrapped Bitcoin
  WETH: "0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37", // Wrapped Ethereum
  USDT: "0x88b8E2161DEDC77EF4ab7585569D2415a1C1055D", // USDT Coin
  WSOL: "0x5387C85A4965769f6B0Df430638a1388493486F1", // Wrapped Solana
  
  // ===== DCA Protocol Contracts =====
  DelegationManager: "0x6FBcF655a896fC257258DCC4180EA3b533441816",
  FunctionWhitelistEnforcer: "0xFF7200E90e4cA696D449FE3d0dbC0481181db5C5",
  RecipientWhitelistEnforcer: "0x527aBE71924200C2bc2AF3bA0Fd4756225363d70",
  SpendingLimitEnforcer: "0xc1294bd66d95Ba3381eF66877bDcBa8142E11164",
  TimeRangeEnforcer: "0x18808aE7b6a6F84c35dCC494ec5ACC7cFC2c17a4",
  DCAVault: "0x0000000000000000000000000000000000000000" // To be deployed
};

// ===== FASTLANE CONFIGURATION =====
export const FASTLANE_CONFIG = {
  BUNDLER_URL: import.meta.env.VITE_BUNDLER_URL || 'https://monad-testnet.4337-shbundler-fra.fastlane-labs.xyz',
  PAYMASTER_URL: import.meta.env.VITE_PAYMASTER_URL || 'https://monad-testnet.4337-shbundler-fra.fastlane-labs.xyz',
  ADDRESS_HUB: '0xC9f0cDE8316AbC5Efc8C3f5A6b571e815C021B51',
  // ✅ CRITICAL: Your EOA that bonded shMON
  SPONSOR_EOA: import.meta.env.VITE_SPONSOR_EOA || '0x3dECa38860de5dBa2eC1292f0286495fCbEF09e5'
};

// ✅ Add validation on load
if (typeof window !== 'undefined') {
  console.log('🔍 FASTLANE_CONFIG loaded:', {
    SPONSOR_EOA: FASTLANE_CONFIG.SPONSOR_EOA,
    isValidAddress: /^0x[a-fA-F0-9]{40}$/.test(FASTLANE_CONFIG.SPONSOR_EOA)
  });
}

// ===== GAS ESTIMATION CONSTANTS =====
export const GAS_LIMITS = {
  // Basic operations
  transfer: 21_000,
  approve: 45_000,
  
  // Smart account operations
  accountDeployment: 300_000,
  userOperation: 150_000,
  
  // Delegation operations
  createDelegation: 100_000,
  redeemDelegation: 80_000,
  
  // Uniswap operations
  singleSwap: 200_000,
  multiHopSwap: 350_000,
  exactInputSwap: 180_000,
  exactOutputSwap: 220_000,
  
  // Buffer multiplier for safety
  bufferMultiplier: 1.2
};

// ===== SWAP INTERVALS (NEW) =====
export const SWAP_INTERVALS = {
  IMMEDIATE: {
    id: 'immediate',
    label: 'Immediately',
    description: 'Execute swap once, right now',
    intervalMs: 0,
    recurring: false
  },
  PER_MINUTE: {
    id: 'per_minute',
    label: 'Per Minute',
    description: 'Recurring swap every minute',
    intervalMs: 60 * 1000,
    recurring: true
  },
  HOURLY: {
    id: 'hourly',
    label: 'Hourly',
    description: 'Recurring swap every hour',
    intervalMs: 60 * 60 * 1000,
    recurring: true
  },
  DAILY: {
    id: 'daily',
    label: 'Daily',
    description: 'Recurring swap every 24 hours',
    intervalMs: 24 * 60 * 60 * 1000,
    recurring: true
  },
  WEEKLY: {
    id: 'weekly',
    label: 'Weekly',
    description: 'Recurring swap every 7 days',
    intervalMs: 7 * 24 * 60 * 60 * 1000,
    recurring: true
  },
  MONTHLY: {
    id: 'monthly',
    label: 'Monthly',
    description: 'Recurring swap every 30 days',
    intervalMs: 30 * 24 * 60 * 60 * 1000,
    recurring: true
  }
};

// ===== DCA STRATEGY CONFIGURATION =====
export const DCA_CONFIG = {
  // Slippage settings
  DEFAULT_SLIPPAGE: 0.005, // 0.5%
  MAX_SLIPPAGE: 0.05, // 5%
  MIN_SLIPPAGE: 0.001, // 0.1%
  
  // Amount limits (in base token units)
  MIN_SWAP_AMOUNT: 0.001,
  MAX_SWAP_AMOUNT: 10000,
  
  // Execution settings
  MAX_CONSECUTIVE_FAILURES: 3,
  EXECUTION_TIMEOUT_MS: 60000, // 60 seconds
  RETRY_DELAY_MS: 5000, // 5 seconds
  
  // Price impact protection
  MAX_PRICE_IMPACT: 5, // 5%
  
  // Strategy limits
  MAX_EXECUTIONS_PER_STRATEGY: 1000,
  MAX_ACTIVE_STRATEGIES: 50
};

// ===== DELEGATION FRAMEWORK CONSTANTS =====
export const DELEGATION_CONFIG = {
  // Caveat types
  caveats: {
    SPENDING_LIMIT: "SpendingLimit",
    TIME_RANGE: "TimeRange", 
    TOKEN_ALLOWLIST: "TokenAllowlist",
    RECIPIENT_ALLOWLIST: "RecipientAllowlist"
  },
  
  // Delegation modes
  modes: {
    SINGLE_DEFAULT: "SingleDefault",
    BATCH_DEFAULT: "BatchDefault"
  },
  
  // Time-based restrictions
  maxDelegationDuration: 86400 * 30, // 30 days in seconds
  defaultDelegationDuration: 86400 * 7, // 7 days
  
  // Spending limits
  dailySpendingLimits: {
    CONSERVATIVE: 100, // $100 USD
    MODERATE: 500,     // $500 USD  
    AGGRESSIVE: 2000   // $2000 USD
  }
};

// ===== UI CONFIGURATION =====
export const UI_CONFIG = {
  // Color palette
  colors: {
    background: "#000000",
    text: "#FFFFFF", 
    accent: "#1a1a1a",
    secondary: "#2a2a2a",
    border: "rgba(255, 255, 255, 0.1)",
    success: "#00ff88",
    warning: "#ffaa00", 
    error: "#ff4444",
    primary: "#00ff88",
    zIndex: {
      modal: 1300,
      toast: 1400,
      dropdown: 1200,
      header: 1000
    }
  },
  
  // Typography
  fonts: {
    primary: "Orbitron, monospace",
    secondary: "Inter, sans-serif"
  },
  
  // Animation settings
  transitions: {
    default: "400ms ease",
    fast: "200ms ease",
    slow: "600ms ease"
  },
  
  // Layout constants
  spacing: {
    xs: "0.25rem",
    sm: "0.5rem", 
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem"
  },
  
  // Glassmorphism settings
  glass: {
    backdrop: "rgba(26, 26, 26, 0.8)",
    blur: "blur(10px)",
    border: "1px solid rgba(255, 255, 255, 0.1)"
  }
};

// ===== ERROR CODES =====
export const ERROR_CODES = {
  // Network errors
  NETWORK_ERROR: "NETWORK_ERROR",
  RPC_ERROR: "RPC_ERROR", 
  TIMEOUT_ERROR: "TIMEOUT_ERROR",
  
  // Account errors
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  DEPLOYMENT_FAILED: "DEPLOYMENT_FAILED",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  
  // Delegation errors
  DELEGATION_EXPIRED: "DELEGATION_EXPIRED",
  DELEGATION_INVALID: "DELEGATION_INVALID",
  CAVEAT_VIOLATION: "CAVEAT_VIOLATION",
  
  // Swap errors
  SLIPPAGE_EXCEEDED: "SLIPPAGE_EXCEEDED",
  INSUFFICIENT_LIQUIDITY: "INSUFFICIENT_LIQUIDITY",
  SWAP_FAILED: "SWAP_FAILED",
  
  // DCA errors
  STRATEGY_PAUSED: "STRATEGY_PAUSED",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  SCHEDULE_CONFLICT: "SCHEDULE_CONFLICT"
};

// ===== SUPPORTED TOKENS (Cleaned - no price feeds) =====
export const SUPPORTED_TOKENS = {
  MON: {
    symbol: "MON",
    name: "Monad",
    address: CONTRACTS.WMON,
    decimals: 18,
    isNative: true,
    minAmount: 0.001
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: CONTRACTS.USDC,
    decimals: 6,
    isStable: true,
    minAmount: 0.01
  },
  WBTC: {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    address: CONTRACTS.WBTC,
    decimals: 8,
    minAmount: 0.000005
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ethereum",
    address: CONTRACTS.WETH,
    decimals: 18,
    minAmount: 0.00008
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD",
    address: CONTRACTS.USDT,
    decimals: 6,
    isStable: true,
    minAmount: 0.01
  },
  WSOL: {
    symbol: "WSOL",
    name: "Wrapped Solana",
    address: CONTRACTS.WSOL,
    decimals: 9,
    minAmount: 0.0002
  }
};

// ===== UTILITY CONSTANTS =====
export const UTILS = {
  // Decimal precision
  PRICE_PRECISION: 8,
  AMOUNT_PRECISION: 6,
  
  // Time constants
  MILLISECONDS_PER_SECOND: 1000,
  SECONDS_PER_MINUTE: 60,
  MINUTES_PER_HOUR: 60,
  HOURS_PER_DAY: 24,
  DAYS_PER_WEEK: 7,

  // Storage TTLs
  DEFAULT_STORAGE_TTL: 7 * 24 * 60 * 60 * 1000, // 7 days
  CLEANUP_INTERVAL: 24 * 60 * 60 * 1000, // 24 hours
  MAX_DELEGATION_AGE: 30 * 24 * 60 * 60 * 1000, // 30 days

  // Math constants
  ZERO_ADDRESS: "0x0000000000000000000000000000000000000000",
  MAX_UINT256: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  
  // Storage keys (for non-sensitive data only)
  STORAGE_KEYS: {
    THEME: "monad-dca-theme",
    LANGUAGE: "monad-dca-language", 
    NOTIFICATIONS: "monad-dca-notifications",
    STRATEGIES: "monad-dca-strategies"
  }
};

// ===== GAS PRICE TIERS =====
export const GAS_PRICE_TIERS = {
  conservative: {
    label: "Conservative",
    description: "Lowest priority",
    multiplier: 1.0,
    confirmationTime: "≈ 2–3 seconds"
  },
  balanced: {
    label: "Balanced",
    description: "Standard priority",
    multiplier: 1.1,
    confirmationTime: "≈ 1–2 seconds"
  },
  aggressive: {
    label: "Aggressive",
    description: "High priority",
    multiplier: 1.25,
    confirmationTime: "≈ 0.5–1 second"
  }
};

// ===== ENVIRONMENT VALIDATION =====
export const validateEnvironment = () => {
  const requiredEnvVars = [
    'VITE_MONAD_RPC_URL'
  ];
  
  const missing = requiredEnvVars.filter(key => !import.meta.env[key]);
  
  if (missing.length > 0) {
    console.warn(`Missing environment variables: ${missing.join(', ')}`);
  }
  
  return true;
};

// ===== EXPORTS =====
export default {
  MONAD_CONFIG,
  SMART_ACCOUNT_CONFIG,
  CONTRACTS,
  GAS_LIMITS,
  SWAP_INTERVALS,
  DCA_CONFIG,
  DELEGATION_CONFIG,
  UI_CONFIG,
  ERROR_CODES,
  SUPPORTED_TOKENS,
  UTILS,
  GAS_PRICE_TIERS,
  validateEnvironment
};