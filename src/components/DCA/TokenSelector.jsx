import { useState, useEffect, useCallback, useMemo } from 'react';
import { getPriceInUSD } from '../../services/dca/priceOracle';
import { motion, AnimatePresence } from 'framer-motion';
import { formatUnits } from 'viem';
import { useMonadBalance } from '../../hooks/useMonadBalance';
import { 
  formatTokenAmount, 
  formatPrice, 
  getTokenInfo 
} from '../../utils/formatters';
import { 
  SUPPORTED_TOKENS, 
  UI_CONFIG 
} from '../../utils/constants';

const TokenSelector = ({ 
  selectedToken, 
  onTokenSelect, 
  otherToken = null,
  label = 'Select Token',
  showBalance = true,
  showPrice = true,
  disabled = false,
  variant = 'default' // 'default' | 'compact'
}) => {
  // Hooks
  const { balances, isLoading: balancesLoading } = useMonadBalance();

  // State
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredToken, setHoveredToken] = useState(null);
  const [tokenPrices, setTokenPrices] = useState({});

  // Get selected token info
  const selectedTokenInfo = useMemo(() => {
    return selectedToken ? getTokenInfo(selectedToken) : null;
  }, [selectedToken]);

  // Filter tokens based on search
  const filteredTokens = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    
    return SUPPORTED_TOKENS.filter(token => {
      // Exclude the other token in a pair selector
      if (otherToken && token.address === otherToken) {
        return false;
      }

      // Search filter
      if (query) {
        return (
          token.symbol.toLowerCase().includes(query) ||
          token.name.toLowerCase().includes(query) ||
          token.address.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [searchQuery, otherToken]);

  // Sort tokens (native first, then by balance, then alphabetically)
  const sortedTokens = useMemo(() => {
    return [...filteredTokens].sort((a, b) => {
      // Native token first
      if (a.isNative && !b.isNative) return -1;
      if (!a.isNative && b.isNative) return 1;

      // Sort by balance if available
      const balanceA = balances[a.symbol]?.raw || 0n;
      const balanceB = balances[b.symbol]?.raw || 0n;
      
      if (balanceA > balanceB) return -1;
      if (balanceA < balanceB) return 1;

      // Alphabetically by symbol
      return a.symbol.localeCompare(b.symbol);
    });
  }, [filteredTokens, balances]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isOpen && !event.target.closest('[data-token-selector]')) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Handle token selection
  const handleSelect = useCallback((token) => {
    if (!disabled && onTokenSelect) {
      onTokenSelect(token.address);
      setIsOpen(false);
      setSearchQuery('');
    }
  }, [disabled, onTokenSelect]);

  // Toggle dropdown
  const handleToggle = useCallback(() => {
    if (!disabled) {
      setIsOpen(prev => !prev);
    }
  }, [disabled]);

  // Clear search on close
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);
  
  // 🧩 Fetch live USD prices when dropdown opens
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const updatedPrices = {};
        for (const token of SUPPORTED_TOKENS) {
          const price = await getPriceInUSD(token.symbol);
          if (price) {
            updatedPrices[token.symbol] = price;
          }
        }
        setTokenPrices(updatedPrices);
      } catch (err) {
        console.error('Error fetching token prices:', err);
      }
    };
  
    if (isOpen) {
      fetchPrices();
    }
  }, [isOpen]);
  
  // Render token icon
  const renderTokenIcon = (token) => {
    if (token.isNative) {
      return <div style={styles.tokenIconNative}>M</div>;
    }
    
    // Use first letter of symbol as fallback
    return (
      <div style={styles.tokenIconFallback}>
        {token.symbol[0]}
      </div>
    );
  };

  // Render balance
  const renderBalance = (token) => {
    if (!showBalance) return null;

    const balance = balances[token.symbol];
    
    if (balancesLoading) {
      return (
        <div style={styles.tokenBalance}>
          <div className="skeleton" style={{ width: '60px', height: '14px' }} />
        </div>
      );
    }

    if (balance) {
      return (
        <div style={styles.tokenBalance}>
          {balance.formatted} {token.symbol}
        </div>
      );
    }

    return (
      <div style={styles.tokenBalance}>
        0.0 {token.symbol}
      </div>
    );
  };

  // Render live token price from oracle
  const renderPrice = (token) => {
    if (!showPrice) return null;
    const price = tokenPrices[token.symbol];
    if (price === undefined) {
      return (
        <div style={styles.tokenPrice}>
          Loading...
        </div>
      );
    }
    return (
      <div style={styles.tokenPrice}>
        ${formatPrice(price)}
      </div>
    );
  };
  
  // Render selected token display
  const renderSelectedToken = () => {
    if (!selectedTokenInfo) {
      return (
        <div style={styles.placeholder}>
          {label}
        </div>
      );
    }

    if (variant === 'compact') {
      return (
        <div style={styles.selectedCompact}>
          {renderTokenIcon(selectedTokenInfo)}
          <span style={styles.tokenSymbol}>{selectedTokenInfo.symbol}</span>
        </div>
      );
    }

    return (
      <div style={styles.selected}>
        {renderTokenIcon(selectedTokenInfo)}
        <div style={styles.selectedInfo}>
          <div style={styles.tokenSymbol}>{selectedTokenInfo.symbol}</div>
          <div style={styles.tokenName}>{selectedTokenInfo.name}</div>
        </div>
        {showBalance && renderBalance(selectedTokenInfo)}
      </div>
    );
  };

  // Render token option
  const renderTokenOption = (token) => {
    const isSelected = selectedToken === token.address;
    const isHovered = hoveredToken === token.address;

    return (
      <motion.div
        key={token.address}
        style={{
          ...styles.option,
          ...(isSelected ? styles.optionSelected : {}),
          ...(isHovered ? styles.optionHovered : {}),
        }}
        onClick={() => handleSelect(token)}
        onMouseEnter={() => setHoveredToken(token.address)}
        onMouseLeave={() => setHoveredToken(null)}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <div style={styles.optionLeft}>
          {renderTokenIcon(token)}
          <div style={styles.optionInfo}>
            <div style={styles.optionSymbol}>
              {token.symbol}
              {token.isNative && (
                <span style={styles.nativeBadge}>Native</span>
              )}
            </div>
            <div style={styles.optionName}>{token.name}</div>
          </div>
        </div>

        <div style={styles.optionRight}>
          {renderBalance(token)}
          {renderPrice(token)}
        </div>

        {isSelected && (
          <motion.div
            style={styles.checkmark}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.2 }}
          >
            ✓
          </motion.div>
        )}
      </motion.div>
    );
  };

  // Render dropdown
  const renderDropdown = () => (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          style={styles.dropdown}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {/* Search input */}
          <div style={styles.searchWrapper}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or address..."
              style={styles.searchInput}
              autoFocus
            />
          </div>

          {/* Token list */}
          <div style={styles.optionList}>
            {sortedTokens.length > 0 ? (
              sortedTokens.map(renderTokenOption)
            ) : (
              <div style={styles.emptyState}>
                <div style={styles.emptyIcon}>🔍</div>
                <div style={styles.emptyText}>No tokens found</div>
              </div>
            )}
          </div>

          {/* Footer info */}
          <div style={styles.dropdownFooter}>
            <div style={styles.footerText}>
              {sortedTokens.length} token{sortedTokens.length !== 1 ? 's' : ''} available
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Main render
  return (
    <div style={styles.container} data-token-selector>
      {label && variant === 'default' && (
        <label style={styles.label}>{label}</label>
      )}

      <div
        style={{
          ...styles.selector,
          ...(variant === 'compact' ? styles.selectorCompact : {}),
          ...(isOpen ? styles.selectorOpen : {}),
          ...(disabled ? styles.selectorDisabled : {}),
        }}
        onClick={handleToggle}
      >
        {renderSelectedToken()}
        <div style={styles.arrow}>
          {isOpen ? '▲' : '▼'}
        </div>
      </div>

      {renderDropdown()}
    </div>
  );
};

// Styles
const styles = {
  container: {
    position: 'relative',
    width: '100%',
  },
  label: {
    display: 'block',
    marginBottom: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
  },
  selector: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
  },
  selectorCompact: {
    padding: '0.75rem',
  },
  selectorOpen: {
    borderColor: UI_CONFIG.colors.success,
    boxShadow: `0 0 0 2px ${UI_CONFIG.colors.success}40`,
  },
  selectorDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  placeholder: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: '1rem',
  },
  selected: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flex: 1,
  },
  selectedCompact: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  selectedInfo: {
    flex: 1,
  },
  tokenIconNative: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    background: `linear-gradient(135deg, ${UI_CONFIG.colors.success}, #00cc70)`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.background,
  },
  tokenIconFallback: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.125rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.text,
  },
  tokenSymbol: {
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.text,
  },
  tokenName: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  tokenBalance: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'right',
  },
  tokenPrice: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'right',
  },
  arrow: {
    marginLeft: '1rem',
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)',
    transition: UI_CONFIG.transitions.fast,
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 0.5rem)',
    left: 0,
    right: 0,
    maxHeight: '400px',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    overflow: 'hidden',
  },
  searchWrapper: {
    padding: '1rem',
    borderBottom: `1px solid ${UI_CONFIG.colors.border}`,
  },
  searchInput: {
    width: '100%',
    padding: '0.75rem',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '6px',
    color: UI_CONFIG.colors.text,
    fontSize: '0.875rem',
    fontFamily: UI_CONFIG.fonts.secondary,
    outline: 'none',
    transition: UI_CONFIG.transitions.default,
  },
  optionList: {
    maxHeight: '280px',
    overflowY: 'auto',
    padding: '0.5rem',
  },
  option: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.75rem',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.fast,
    position: 'relative',
  },
  optionSelected: {
    background: `${UI_CONFIG.colors.success}20`,
  },
  optionHovered: {
    background: UI_CONFIG.colors.accent,
  },
  optionLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    flex: 1,
  },
  optionInfo: {
    flex: 1,
  },
  optionSymbol: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '0.875rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.text,
  },
  optionName: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  optionRight: {
    textAlign: 'right',
  },
  nativeBadge: {
    padding: '0.125rem 0.5rem',
    background: `${UI_CONFIG.colors.success}30`,
    border: `1px solid ${UI_CONFIG.colors.success}`,
    borderRadius: '4px',
    fontSize: '0.625rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.success,
  },
  checkmark: {
    position: 'absolute',
    top: '0.5rem',
    right: '0.5rem',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: UI_CONFIG.colors.success,
    color: UI_CONFIG.colors.background,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.75rem',
    fontWeight: 'bold',
  },
  emptyState: {
    padding: '2rem',
    textAlign: 'center',
  },
  emptyIcon: {
    fontSize: '2rem',
    marginBottom: '0.5rem',
  },
  emptyText: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  dropdownFooter: {
    padding: '0.75rem 1rem',
    borderTop: `1px solid ${UI_CONFIG.colors.border}`,
    background: UI_CONFIG.colors.accent,
  },
  footerText: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)',
  },
};

export default TokenSelector;