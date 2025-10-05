import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { parseUnits } from 'viem';
import { useDCAStrategy } from '../../hooks/useDCAStrategy';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { useMonadBalance } from '../../hooks/useMonadBalance';
import { 
  validateDCAStrategy, 
  validateTokenAmount, 
  validateSlippage 
} from '../../utils/validators';
import { 
  formatTokenAmount, 
  formatDCAFrequency,
  formatPrice,
  formatPercentage 
} from '../../utils/formatters';
import { 
  SUPPORTED_TOKENS, 
  DCA_CONFIG, 
  UI_CONFIG 
} from '../../utils/constants';

const StrategyBuilder = ({ onStrategyCreated, onCancel }) => {
  // Hooks
  const { smartAccount, isDeployed } = useSmartAccount();
  const { createDCAStrategy, getCurrentPrice, getTWAPPrice, isLoading: strategyLoading } = useDCAStrategy();
  const { balances, hasSufficientBalance, getMaxSpendableAmount } = useMonadBalance(smartAccount?.address);

  // Form state
  const [formData, setFormData] = useState({
    fromToken: SUPPORTED_TOKENS[0].address,
    toToken: SUPPORTED_TOKENS[1].address,
    amount: '',
    frequency: 'DAILY',
    executionCount: 10,
    slippage: DCA_CONFIG.defaultSlippage * 100, // Store as percentage
    startTime: Date.now() + 300000, // 5 minutes from now
  });

  // UI state
  const [step, setStep] = useState(1); // 1: Tokens, 2: Amount, 3: Schedule, 4: Review
  const [validationErrors, setValidationErrors] = useState({});
  const [prices, setPrices] = useState({ spot: null, twap: null, loading: true });
  const [estimatedTotal, setEstimatedTotal] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  // Get selected tokens
  const fromToken = SUPPORTED_TOKENS.find(t => t.address === formData.fromToken);
  const toToken = SUPPORTED_TOKENS.find(t => t.address === formData.toToken);

  // Fetch prices when tokens change
  useEffect(() => {
    if (!fromToken || !toToken) return;

    const fetchPrices = async () => {
      setPrices({ spot: null, twap: null, loading: true });
      try {
        const [spotPrice, twapPrice] = await Promise.all([
          getCurrentPrice(fromToken.address, toToken.address),
          getTWAPPrice(fromToken.address, toToken.address, DCA_CONFIG.defaultTwapPeriod)
        ]);
        setPrices({ spot: spotPrice, twap: twapPrice, loading: false });
      } catch (error) {
        console.error('Price fetch error:', error);
        setPrices({ spot: null, twap: null, loading: false });
      }
    };

    fetchPrices();
  }, [fromToken?.address, toToken?.address, getCurrentPrice, getTWAPPrice]);

  // Calculate estimated total
  useEffect(() => {
    if (!formData.amount || !prices.spot) {
      setEstimatedTotal(null);
      return;
    }

    try {
      const amountBigInt = parseUnits(formData.amount, fromToken.decimals);
      const total = Number(amountBigInt) * formData.executionCount;
      const totalFormatted = formatTokenAmount(total.toString(), fromToken.decimals, 6);
      setEstimatedTotal({
        total: totalFormatted,
        perExecution: formData.amount,
        executionCount: formData.executionCount,
      });
    } catch (error) {
      setEstimatedTotal(null);
    }
  }, [formData.amount, formData.executionCount, fromToken?.decimals, prices.spot]);

  // Handle input changes
  const handleChange = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setValidationErrors(prev => ({ ...prev, [field]: null }));
  }, []);

  // Validate current step
  const validateStep = useCallback(() => {
    const errors = {};

    if (step === 1) {
      // Token selection
      if (formData.fromToken === formData.toToken) {
        errors.toToken = 'Cannot swap token to itself';
      }
    } else if (step === 2) {
      // Amount validation
      if (!formData.amount || formData.amount <= 0) {
        errors.amount = 'Amount is required';
      } else {
        const validation = validateTokenAmount(formData.amount, fromToken, balances[fromToken.symbol]?.raw);
        if (!validation.isValid) {
          errors.amount = validation.error;
        }
      }

      // Slippage validation
      if (formData.slippage != null && !isNaN(formData.slippage)) {
        const slippageDecimal = formData.slippage / 100;
        const slippageValidation = validateSlippage(slippageDecimal);
        if (!slippageValidation.isValid) {
            errors.slippage = slippageValidation.error;
        }
    } else {
        errors.slippage = 'Invalid slippage value';
    } 

  } else if (step === 3) {
    // Schedule validation
    if (!formData.frequency) {
        errors.frequency = 'Frequency is required';
    }
    if (formData.executionCount < 1 || formData.executionCount > DCA_CONFIG.maxExecutionsPerStrategy) {
        errors.executionCount = `Must be between 1 and ${DCA_CONFIG.maxExecutionsPerStrategy}`;
    }
    if (formData.startTime < Date.now()) {
        errors.startTime = 'Start time must be in the future';
    }
  }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [step, formData, fromToken, balances]);

  // Navigation handlers
  const handleNext = useCallback(() => {
    if (validateStep()) {
      setStep(prev => Math.min(prev + 1, 4));
    }
  }, [validateStep]);

  const handleBack = useCallback(() => {
    setStep(prev => Math.max(prev - 1, 1));
  }, []);

  // Create strategy
  const handleCreate = useCallback(async () => {
    if (!isDeployed) {
      toast.error('Smart account must be deployed first');
      return;
    }

    if (!validateStep()) {
      return;
    }

    // Final validation
    const strategyConfig = {
      fromToken: formData.fromToken,
      toToken: formData.toToken,
      amount: formData.amount,
      frequency: formData.frequency,
      executionCount: formData.executionCount,
      slippage: formData.slippage / 100, // Convert back to decimal
      startTime: formData.startTime,
    };

    const validation = validateDCAStrategy(strategyConfig);
    if (!validation.isValid) {
      toast.error(validation.error);
      return;
    }

    setIsCreating(true);
    try {
      const strategy = await createDCAStrategy(strategyConfig);
      toast.success('DCA strategy created successfully!');
      if (onStrategyCreated) {
        onStrategyCreated(strategy);
      }
    } catch (error) {
      console.error('Strategy creation error:', error);
      toast.error(error.message || 'Failed to create strategy');
    } finally {
      setIsCreating(false);
    }
  }, [formData, isDeployed, validateStep, createDCAStrategy, onStrategyCreated]);

  // Use max amount
  const handleUseMax = useCallback(() => {
    const maxAmount = getMaxSpendableAmount(fromToken.symbol, true);
    if (maxAmount && maxAmount !== '0') {
      handleChange('amount', maxAmount);
    }
  }, [fromToken, getMaxSpendableAmount, handleChange]);

  // Swap tokens
  const handleSwapTokens = useCallback(() => {
    setFormData(prev => ({
      ...prev,
      fromToken: prev.toToken,
      toToken: prev.fromToken,
    }));
  }, []);

  // Render step indicator
  const renderStepIndicator = () => {
    const steps = [
      { num: 1, label: 'Select Tokens' },
      { num: 2, label: 'Set Amount' },
      { num: 3, label: 'Schedule' },
      { num: 4, label: 'Review' },
    ];

    return (
      <div style={styles.stepIndicator}>
        {steps.map((s, idx) => (
          <div key={s.num} style={styles.stepWrapper}>
            <div
              style={{
                ...styles.stepCircle,
                ...(step >= s.num ? styles.stepCircleActive : {}),
              }}
            >
              {s.num}
            </div>
            <span
              style={{
                ...styles.stepLabel,
                ...(step >= s.num ? styles.stepLabelActive : {}),
              }}
            >
              {s.label}
            </span>
            {idx < steps.length - 1 && (
              <div
                style={{
                  ...styles.stepLine,
                  ...(step > s.num ? styles.stepLineActive : {}),
                }}
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  // Render token selector
  const renderTokenSelector = (field, label) => (
    <div style={styles.formGroup}>
      <label style={styles.label}>{label}</label>
      <select
        value={formData[field]}
        onChange={(e) => handleChange(field, e.target.value)}
        style={styles.select}
        disabled={isCreating}
      >
        {SUPPORTED_TOKENS.map(token => (
          <option key={token.address} value={token.address}>
            {token.symbol} - {token.name}
          </option>
        ))}
      </select>
    </div>
  );

  // Render Step 1: Token Selection
  const renderStep1 = () => (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <h3 style={styles.stepTitle}>Select Token Pair</h3>
      
      {renderTokenSelector('fromToken', 'From Token')}
      
      <div style={styles.swapButtonWrapper}>
        <button
          type="button"
          onClick={handleSwapTokens}
          style={styles.swapButton}
          disabled={isCreating}
        >
          ⇅ Swap
        </button>
      </div>

      {renderTokenSelector('toToken', 'To Token')}

      {validationErrors.toToken && (
        <div style={styles.error}>{validationErrors.toToken}</div>
      )}

      {/* Price info */}
      {prices.loading ? (
        <div style={styles.priceBox}>
          <div className="spinner" />
          <span style={styles.priceLabel}>Loading prices...</span>
        </div>
      ) : prices.spot ? (
        <div style={styles.priceBox}>
          <div style={styles.priceRow}>
            <span style={styles.priceLabel}>Spot Price:</span>
            <span style={styles.priceValue}>
              1 {fromToken.symbol} = {formatPrice(prices.spot)} {toToken.symbol}
            </span>
          </div>
          {prices.twap && (
            <div style={styles.priceRow}>
              <span style={styles.priceLabel}>TWAP (15m):</span>
              <span style={styles.priceValue}>
                1 {fromToken.symbol} = {formatPrice(prices.twap)} {toToken.symbol}
              </span>
            </div>
          )}
        </div>
      ) : null}
    </motion.div>
  );

  // Render Step 2: Amount & Slippage
  const renderStep2 = () => (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <h3 style={styles.stepTitle}>Set Amount & Slippage</h3>

      <div style={styles.formGroup}>
        <label style={styles.label}>
          Amount per Execution ({fromToken.symbol})
        </label>
        <div style={styles.inputWithButton}>
          <input
            type="number"
            value={formData.amount}
            onChange={(e) => handleChange('amount', e.target.value)}
            placeholder="0.0"
            step="any"
            min="0"
            style={{
              ...styles.input,
              ...(validationErrors.amount ? styles.inputError : {}),
            }}
            disabled={isCreating}
          />
          <button
            type="button"
            onClick={handleUseMax}
            style={styles.maxButton}
            disabled={isCreating}
          >
            MAX
          </button>
        </div>
        {validationErrors.amount && (
          <div style={styles.error}>{validationErrors.amount}</div>
        )}
        {balances[fromToken.symbol] && (
          <div style={styles.balanceInfo}>
            Available: {balances[fromToken.symbol].formatted} {fromToken.symbol}
          </div>
        )}
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>
          Slippage Tolerance ({formatPercentage(formData.slippage / 100)})
        </label>
        <input
          type="range"
          value={formData.slippage}
          onChange={(e) => handleChange('slippage', parseFloat(e.target.value))}
          min={DCA_CONFIG.minSlippage * 100}
          max={DCA_CONFIG.maxSlippage * 100}
          step={0.1}
          style={styles.slider}
          disabled={isCreating}
        />
        {validationErrors.slippage && (
          <div style={styles.error}>{validationErrors.slippage}</div>
        )}
        {formData.slippage / 100 > 0.02 && (
          <div style={styles.warning}>
            High slippage tolerance may result in unfavorable trades
          </div>
        )}
      </div>
    </motion.div>
  );

  // Render Step 3: Schedule
  const renderStep3 = () => (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <h3 style={styles.stepTitle}>Configure Schedule</h3>

      <div style={styles.formGroup}>
        <label style={styles.label}>Frequency</label>
        <select
          value={formData.frequency}
          onChange={(e) => handleChange('frequency', e.target.value)}
          style={styles.select}
          disabled={isCreating}
        >
          {Object.entries(DCA_CONFIG.schedules).map(([key, config]) => (
            <option key={key} value={key}>
              {config.label}
            </option>
          ))}
        </select>
        {validationErrors.frequency && (
          <div style={styles.error}>{validationErrors.frequency}</div>
        )}
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Number of Executions</label>
        <input
          type="number"
          value={formData.executionCount}
          onChange={(e) => handleChange('executionCount', parseInt(e.target.value, 10))}
          min="1"
          max={DCA_CONFIG.maxExecutionsPerStrategy}
          style={{
            ...styles.input,
            ...(validationErrors.executionCount ? styles.inputError : {}),
          }}
          disabled={isCreating}
        />
        {validationErrors.executionCount && (
          <div style={styles.error}>{validationErrors.executionCount}</div>
        )}
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Start Time</label>
        <input
          type="datetime-local"
          value={new Date(formData.startTime).toISOString().slice(0, 16)}
          onChange={(e) => handleChange('startTime', new Date(e.target.value).getTime())}
          min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
          style={{
            ...styles.input,
            ...(validationErrors.startTime ? styles.inputError : {}),
          }}
          disabled={isCreating}
        />
        {validationErrors.startTime && (
          <div style={styles.error}>{validationErrors.startTime}</div>
        )}
      </div>
    </motion.div>
  );

  // Render Step 4: Review
  const renderStep4 = () => (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <h3 style={styles.stepTitle}>Review Strategy</h3>

      <div style={styles.reviewSection}>
        <div style={styles.reviewRow}>
          <span style={styles.reviewLabel}>From Token:</span>
          <span style={styles.reviewValue}>{fromToken.symbol}</span>
        </div>
        <div style={styles.reviewRow}>
          <span style={styles.reviewLabel}>To Token:</span>
          <span style={styles.reviewValue}>{toToken.symbol}</span>
        </div>
        <div style={styles.reviewRow}>
          <span style={styles.reviewLabel}>Amount per Execution:</span>
          <span style={styles.reviewValue}>
            {formData.amount} {fromToken.symbol}
          </span>
        </div>
        <div style={styles.reviewRow}>
          <span style={styles.reviewLabel}>Frequency:</span>
          <span style={styles.reviewValue}>
            {formatDCAFrequency(DCA_CONFIG.schedules[formData.frequency].interval)}
          </span>
        </div>
        <div style={styles.reviewRow}>
          <span style={styles.reviewLabel}>Executions:</span>
          <span style={styles.reviewValue}>{formData.executionCount}</span>
        </div>
        <div style={styles.reviewRow}>
          <span style={styles.reviewLabel}>Slippage:</span>
          <span style={styles.reviewValue}>
            {formatPercentage(formData.slippage / 100)}
          </span>
        </div>
        <div style={styles.reviewRow}>
          <span style={styles.reviewLabel}>Start Time:</span>
          <span style={styles.reviewValue}>
            {new Date(formData.startTime).toLocaleString()}
          </span>
        </div>
      </div>

      {estimatedTotal && (
        <div style={styles.totalBox}>
          <div style={styles.totalRow}>
            <span style={styles.totalLabel}>Total Investment:</span>
            <span style={styles.totalValue}>
              {estimatedTotal.total} {fromToken.symbol}
            </span>
          </div>
        </div>
      )}

      <div style={styles.infoBox}>
        <strong>Important:</strong> This will create a delegation allowing automated
        swaps on your behalf. You can pause or cancel the strategy at any time.
      </div>
    </motion.div>
  );

  // Main render
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h2 style={styles.title}>Create DCA Strategy</h2>
          {renderStepIndicator()}
        </div>

        <div style={styles.body}>
          <AnimatePresence mode="wait">
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
            {step === 4 && renderStep4()}
          </AnimatePresence>
        </div>

        <div style={styles.footer}>
          <div style={styles.buttonGroup}>
            {step > 1 && (
              <button
                type="button"
                onClick={handleBack}
                style={styles.btnSecondary}
                disabled={isCreating || strategyLoading}
              >
                Back
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                style={styles.btnGhost}
                disabled={isCreating || strategyLoading}
              >
                Cancel
              </button>
            )}
          </div>
          
          {step < 4 ? (
            <button
              type="button"
              onClick={handleNext}
              style={styles.btnPrimary}
              disabled={isCreating || strategyLoading}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              style={styles.btnPrimary}
              disabled={isCreating || strategyLoading || !isDeployed}
            >
              {isCreating ? (
                <>
                  <div className="spinner" style={{ marginRight: '8px' }} />
                  Creating...
                </>
              ) : (
                'Create Strategy'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Styles
const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    minHeight: '100vh',
    padding: '2rem',
  },
  card: {
    width: '100%',
    maxWidth: '800px',
    background: UI_CONFIG.glass.backdrop,
    backdropFilter: UI_CONFIG.glass.blur,
    border: UI_CONFIG.glass.border,
    borderRadius: '16px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  },
  header: {
    padding: '2rem',
    borderBottom: `1px solid ${UI_CONFIG.colors.border}`,
  },
  title: {
    margin: 0,
    marginBottom: '2rem',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '2rem',
    color: UI_CONFIG.colors.text,
  },
  stepIndicator: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepWrapper: {
    display: 'flex',
    alignItems: 'center',
    flex: 1,
    position: 'relative',
  },
  stepCircle: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    background: UI_CONFIG.colors.secondary,
    border: `2px solid ${UI_CONFIG.colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1rem',
    fontWeight: 'bold',
    color: 'rgba(255, 255, 255, 0.5)',
    transition: UI_CONFIG.transitions.default,
    zIndex: 1,
  },
  stepCircleActive: {
    background: UI_CONFIG.colors.success,
    borderColor: UI_CONFIG.colors.success,
    color: UI_CONFIG.colors.background,
  },
  stepLabel: {
    marginLeft: '0.5rem',
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.5)',
    transition: UI_CONFIG.transitions.default,
  },
  stepLabelActive: {
    color: UI_CONFIG.colors.text,
  },
  stepLine: {
    position: 'absolute',
    left: '40px',
    right: '0',
    top: '50%',
    height: '2px',
    background: UI_CONFIG.colors.border,
    transition: UI_CONFIG.transitions.default,
    zIndex: 0,
  },
  stepLineActive: {
    background: UI_CONFIG.colors.success,
  },
  body: {
    padding: '2rem',
    minHeight: '400px',
  },
  stepTitle: {
    margin: '0 0 1.5rem 0',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.5rem',
    color: UI_CONFIG.colors.text,
  },
  formGroup: {
    marginBottom: '1.5rem',
  },
  label: {
    display: 'block',
    marginBottom: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    color: UI_CONFIG.colors.text,
    fontSize: '1rem',
    fontFamily: UI_CONFIG.fonts.secondary,
    transition: UI_CONFIG.transitions.default,
    outline: 'none',
  },
  inputError: {
    borderColor: UI_CONFIG.colors.error,
  },
  select: {
    width: '100%',
    padding: '0.75rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    color: UI_CONFIG.colors.text,
    fontSize: '1rem',
    fontFamily: UI_CONFIG.fonts.secondary,
    transition: UI_CONFIG.transitions.default,
    outline: 'none',
    cursor: 'pointer',
  },
  slider: {
    width: '100%',
    height: '6px',
    borderRadius: '3px',
    background: UI_CONFIG.colors.secondary,
    outline: 'none',
    cursor: 'pointer',
  },
  inputWithButton: {
    display: 'flex',
    gap: '0.5rem',
  },
  maxButton: {
    padding: '0.75rem 1.5rem',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    color: UI_CONFIG.colors.text,
    fontSize: '0.875rem',
    fontWeight: '600',
    fontFamily: UI_CONFIG.fonts.primary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
    whiteSpace: 'nowrap',
  },
  swapButtonWrapper: {
    display: 'flex',
    justifyContent: 'center',
    margin: '1rem 0',
  },
  swapButton: {
    padding: '0.5rem 1rem',
    background: 'transparent',
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    color: UI_CONFIG.colors.text,
    fontSize: '1rem',
    fontFamily: UI_CONFIG.fonts.primary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
  },
  error: {
    marginTop: '0.5rem',
    fontSize: '0.875rem',
    color: UI_CONFIG.colors.error,
  },
  warning: {
    marginTop: '0.5rem',
    fontSize: '0.875rem',
    color: UI_CONFIG.colors.warning,
  },
  balanceInfo: {
    marginTop: '0.5rem',
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  priceBox: {
    marginTop: '1.5rem',
    padding: '1rem',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
  },
  priceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
  },
  priceLabel: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  priceValue: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
  },
  reviewSection: {
    padding: '1rem',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    marginBottom: '1.5rem',
  },
  reviewRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 0',
    borderBottom: `1px solid ${UI_CONFIG.colors.border}`,
  },
  reviewLabel: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  reviewValue: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
  },
  totalBox: {
    padding: '1rem',
    background: `linear-gradient(135deg, ${UI_CONFIG.colors.success}20, ${UI_CONFIG.colors.success}10)`,
    border: `1px solid ${UI_CONFIG.colors.success}`,
    borderRadius: '8px',
    marginBottom: '1.5rem',
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: '1rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
  },
  totalValue: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    fontFamily: UI_CONFIG.fonts.primary,
    color: UI_CONFIG.colors.success,
  },
  infoBox: {
    padding: '1rem',
    background: `${UI_CONFIG.colors.info}20`,
    border: `1px solid ${UI_CONFIG.colors.info}`,
    borderRadius: '8px',
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: '1.5',
  },
  footer: {
    padding: '1.5rem 2rem',
    borderTop: `1px solid ${UI_CONFIG.colors.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  buttonGroup: {
    display: 'flex',
    gap: '1rem',
  },
  btnPrimary: {
    padding: '0.75rem 2rem',
    background: `linear-gradient(135deg, ${UI_CONFIG.colors.success}, #00cc70)`,
    border: 'none',
    borderRadius: '8px',
    color: UI_CONFIG.colors.background,
    fontSize: '1rem',
    fontWeight: 'bold',
    fontFamily: UI_CONFIG.fonts.primary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 4px 12px ${UI_CONFIG.colors.success}40`,
  },
  btnSecondary: {
    padding: '0.75rem 2rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    color: UI_CONFIG.colors.text,
    fontSize: '1rem',
    fontWeight: '600',
    fontFamily: UI_CONFIG.fonts.primary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
  },
  btnGhost: {
    padding: '0.75rem 2rem',
    background: 'transparent',
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    color: UI_CONFIG.colors.text,
    fontSize: '1rem',
    fontWeight: '600',
    fontFamily: UI_CONFIG.fonts.primary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
  },
};

export default StrategyBuilder;