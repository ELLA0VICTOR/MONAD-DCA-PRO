import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  formatDCAFrequency, 
  formatDateTime, 
  formatDuration 
} from '../../utils/formatters';
import { 
  DCA_CONFIG, 
  UI_CONFIG ,
  SUPPORTED_TOKENS
} from '../../utils/constants';

const ScheduleSelector = ({ 
  selectedFrequency, 
  onFrequencyChange, 
  startTime,
  onStartTimeChange,
  executionCount,
  onExecutionCountChange,
  disabled = false 
}) => {
  // State
  const [previewSchedule, setPreviewSchedule] = useState([]);
  const [totalDuration, setTotalDuration] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Calculate preview schedule
  useEffect(() => {
    if (!selectedFrequency || !startTime || !executionCount) {
      setPreviewSchedule([]);
      setTotalDuration(0);
      return;
    }

    const schedule = DCA_CONFIG.schedules[selectedFrequency];
    if (!schedule) return;

    const interval = schedule.interval * 1000; // Convert to ms
    const preview = [];
    let currentTime = startTime;

    // Generate preview (max 5 executions to display)
    const previewCount = Math.min(executionCount, 5);
    for (let i = 0; i < previewCount; i++) {
      preview.push({
        execution: i + 1,
        timestamp: currentTime,
        date: new Date(currentTime),
      });
      currentTime += interval;
    }

    setPreviewSchedule(preview);
    setTotalDuration(interval * (executionCount - 1));
  }, [selectedFrequency, startTime, executionCount]);

  // Frequency card click handler
  const handleFrequencySelect = useCallback((frequency) => {
    if (!disabled && onFrequencyChange) {
      onFrequencyChange(frequency);
    }
  }, [disabled, onFrequencyChange]);

  // Quick start time presets
  const handleQuickStart = useCallback((minutes) => {
    if (!disabled && onStartTimeChange) {
      const newStartTime = Date.now() + (minutes * 60 * 1000);
      onStartTimeChange(newStartTime);
    }
  }, [disabled, onStartTimeChange]);

  // Execution count presets
  const handleQuickCount = useCallback((count) => {
    if (!disabled && onExecutionCountChange) {
      onExecutionCountChange(count);
    }
  }, [disabled, onExecutionCountChange]);

  // Render frequency cards
  const renderFrequencyCards = () => {
    return Object.entries(DCA_CONFIG.schedules).map(([key, config]) => {
      const isSelected = selectedFrequency === key;
      const isDisabled = disabled;

      return (
        <motion.div
          key={key}
          onClick={() => handleFrequencySelect(key)}
          style={{
            ...styles.frequencyCard,
            ...(isSelected ? styles.frequencyCardActive : {}),
            ...(isDisabled ? styles.frequencyCardDisabled : {}),
          }}
          whileHover={!isDisabled ? { scale: 1.02 } : {}}
          whileTap={!isDisabled ? { scale: 0.98 } : {}}
          transition={{ duration: 0.2 }}
        >
          <div style={styles.frequencyIcon}>
            {getFrequencyIcon(key)}
          </div>
          <div style={styles.frequencyLabel}>{config.label}</div>
          <div style={styles.frequencyInterval}>
            Every {formatDuration(config.interval)}
          </div>
          <div style={styles.frequencyMin}>
            Min: {config.minAmount} {SUPPORTED_TOKENS[0].symbol}
          </div>
          {isSelected && (
            <motion.div
              style={styles.selectedBadge}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.2 }}
            >
              ✓
            </motion.div>
          )}
        </motion.div>
      );
    });
  };

  // Render start time section
  const renderStartTimeSection = () => (
    <div style={styles.section}>
      <h4 style={styles.sectionTitle}>Start Time</h4>
      
      <div style={styles.quickActions}>
        <button
          type="button"
          onClick={() => handleQuickStart(5)}
          style={styles.quickButton}
          disabled={disabled}
        >
          In 5 minutes
        </button>
        <button
          type="button"
          onClick={() => handleQuickStart(30)}
          style={styles.quickButton}
          disabled={disabled}
        >
          In 30 minutes
        </button>
        <button
          type="button"
          onClick={() => handleQuickStart(60)}
          style={styles.quickButton}
          disabled={disabled}
        >
          In 1 hour
        </button>
      </div>

      <div style={styles.inputGroup}>
        <label style={styles.label}>Custom Start Time</label>
        <input
          type="datetime-local"
          value={startTime ? new Date(startTime).toISOString().slice(0, 16) : ''}
          onChange={(e) => onStartTimeChange?.(new Date(e.target.value).getTime())}
          min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
          style={styles.input}
          disabled={disabled}
        />
        {startTime && (
          <div style={styles.inputHint}>
            Starts {formatDateTime(startTime, { format: 'long' })}
          </div>
        )}
      </div>
    </div>
  );

  // Render execution count section
  const renderExecutionCountSection = () => (
    <div style={styles.section}>
      <h4 style={styles.sectionTitle}>Number of Executions</h4>

      <div style={styles.quickActions}>
        <button
          type="button"
          onClick={() => handleQuickCount(10)}
          style={styles.quickButton}
          disabled={disabled}
        >
          10 times
        </button>
        <button
          type="button"
          onClick={() => handleQuickCount(25)}
          style={styles.quickButton}
          disabled={disabled}
        >
          25 times
        </button>
        <button
          type="button"
          onClick={() => handleQuickCount(50)}
          style={styles.quickButton}
          disabled={disabled}
        >
          50 times
        </button>
      </div>

      <div style={styles.inputGroup}>
        <label style={styles.label}>Custom Count</label>
        <input
          type="number"
          value={executionCount || ''}
          onChange={(e) => onExecutionCountChange?.(parseInt(e.target.value, 10))}
          min="1"
          max={DCA_CONFIG.maxExecutionsPerStrategy}
          style={styles.input}
          disabled={disabled}
        />
        <div style={styles.inputHint}>
          Max: {DCA_CONFIG.maxExecutionsPerStrategy} executions
        </div>
      </div>
    </div>
  );

  // Render schedule preview
  const renderSchedulePreview = () => {
    if (previewSchedule.length === 0) return null;

    return (
      <motion.div
        style={styles.previewBox}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h4 style={styles.previewTitle}>Execution Schedule Preview</h4>
        
        <div style={styles.previewList}>
          {previewSchedule.map((item) => (
            <div key={item.execution} style={styles.previewItem}>
              <div style={styles.previewNumber}>#{item.execution}</div>
              <div style={styles.previewDate}>
                {formatDateTime(item.timestamp, { format: 'medium' })}
              </div>
            </div>
          ))}
          {executionCount > 5 && (
            <div style={styles.previewMore}>
              ... and {executionCount - 5} more executions
            </div>
          )}
        </div>

        <div style={styles.previewSummary}>
          <div style={styles.summaryRow}>
            <span style={styles.summaryLabel}>Total Duration:</span>
            <span style={styles.summaryValue}>
              {formatDuration(Math.floor(totalDuration / 1000))}
            </span>
          </div>
          <div style={styles.summaryRow}>
            {startTime && totalDuration > 0 && (
              <>
                <span style={styles.summaryLabel}>End Date:</span>
                <span style={styles.summaryValue}>
                  {formatDateTime(startTime + totalDuration, { format: 'short' })}
                </span>
              </>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  // Render advanced options
  const renderAdvancedOptions = () => {
    if (!showAdvanced) return null;

    return (
      <motion.div
        style={styles.advancedSection}
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h4 style={styles.sectionTitle}>Advanced Options</h4>
        
        <div style={styles.infoBox}>
          <strong>Auto-pause conditions:</strong>
          <ul style={styles.infoList}>
            <li>Strategy will pause after {DCA_CONFIG.maxExecutionsPerStrategy} consecutive failures</li>
            <li>Execution timeout: {DCA_CONFIG.executionTimeoutMs / 1000}s</li>
            <li>Price staleness threshold: {DCA_CONFIG.priceStaleThreshold / 1000}s</li>
          </ul>
        </div>

        <div style={styles.infoBox}>
          <strong>AI Decision Engine:</strong>
          <ul style={styles.infoList}>
            <li>Minimum confidence threshold: 65%</li>
            <li>Evaluates: price freshness, TWAP signals, volatility, liquidity, gas efficiency</li>
            <li>May reduce execution amount or skip swaps based on market conditions</li>
          </ul>
        </div>
      </motion.div>
    );
  };

  // Main render
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Configure Schedule</h3>
        <p style={styles.subtitle}>
          Set up automated execution frequency and timing
        </p>
      </div>

      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>Frequency</h4>
        <div style={styles.frequencyGrid}>
          {renderFrequencyCards()}
        </div>
      </div>

      {renderStartTimeSection()}

      {renderExecutionCountSection()}

      {renderSchedulePreview()}

      <div style={styles.advancedToggle}>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={styles.toggleButton}
          disabled={disabled}
        >
          {showAdvanced ? '▼' : '▶'} Advanced Options
        </button>
      </div>

      {renderAdvancedOptions()}
    </div>
  );
};

// Helper: Get frequency icon
const getFrequencyIcon = (frequency) => {
  const icons = {
    HOURLY: '⏱️',
    DAILY: '📅',
    WEEKLY: '📆',
    MONTHLY: '🗓️',
  };
  return icons[frequency] || '⏰';
};

// Styles
const styles = {
  container: {
    width: '100%',
  },
  header: {
    marginBottom: '2rem',
  },
  title: {
    margin: 0,
    marginBottom: '0.5rem',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.5rem',
    color: UI_CONFIG.colors.text,
  },
  subtitle: {
    margin: 0,
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  section: {
    marginBottom: '2rem',
  },
  sectionTitle: {
    margin: 0,
    marginBottom: '1rem',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1.125rem',
    color: UI_CONFIG.colors.text,
  },
  frequencyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '1rem',
  },
  frequencyCard: {
    position: 'relative',
    padding: '1.5rem 1rem',
    background: UI_CONFIG.colors.accent,
    border: `2px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '12px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
  },
  frequencyCardActive: {
    background: `${UI_CONFIG.colors.success}20`,
    borderColor: UI_CONFIG.colors.success,
  },
  frequencyCardDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  frequencyIcon: {
    fontSize: '2rem',
    marginBottom: '0.5rem',
  },
  frequencyLabel: {
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.text,
    marginBottom: '0.25rem',
  },
  frequencyInterval: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: '0.25rem',
  },
  frequencyMin: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  selectedBadge: {
    position: 'absolute',
    top: '0.5rem',
    right: '0.5rem',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: UI_CONFIG.colors.success,
    color: UI_CONFIG.colors.background,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.875rem',
    fontWeight: 'bold',
  },
  quickActions: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1rem',
    flexWrap: 'wrap',
  },
  quickButton: {
    padding: '0.5rem 1rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '6px',
    color: UI_CONFIG.colors.text,
    fontSize: '0.875rem',
    fontFamily: UI_CONFIG.fonts.secondary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.fast,
  },
  inputGroup: {
    marginBottom: '1rem',
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
  inputHint: {
    marginTop: '0.5rem',
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  previewBox: {
    padding: '1.5rem',
    background: UI_CONFIG.colors.accent,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '12px',
    marginTop: '2rem',
  },
  previewTitle: {
    margin: 0,
    marginBottom: '1rem',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '1rem',
    color: UI_CONFIG.colors.text,
  },
  previewList: {
    marginBottom: '1rem',
  },
  previewItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.75rem',
    background: UI_CONFIG.colors.secondary,
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    marginBottom: '0.5rem',
  },
  previewNumber: {
    width: '40px',
    fontFamily: UI_CONFIG.fonts.primary,
    fontSize: '0.875rem',
    fontWeight: 'bold',
    color: UI_CONFIG.colors.success,
  },
  previewDate: {
    flex: 1,
    fontSize: '0.875rem',
    color: UI_CONFIG.colors.text,
  },
  previewMore: {
    padding: '0.5rem',
    textAlign: 'center',
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.6)',
    fontStyle: 'italic',
  },
  previewSummary: {
    paddingTop: '1rem',
    borderTop: `1px solid ${UI_CONFIG.colors.border}`,
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
  },
  summaryLabel: {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  summaryValue: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: UI_CONFIG.colors.text,
  },
  advancedToggle: {
    marginTop: '2rem',
    paddingTop: '1rem',
    borderTop: `1px solid ${UI_CONFIG.colors.border}`,
  },
  toggleButton: {
    padding: '0.75rem 1.5rem',
    background: 'transparent',
    border: `1px solid ${UI_CONFIG.colors.border}`,
    borderRadius: '8px',
    color: UI_CONFIG.colors.text,
    fontSize: '0.875rem',
    fontFamily: UI_CONFIG.fonts.primary,
    cursor: 'pointer',
    transition: UI_CONFIG.transitions.default,
  },
  advancedSection: {
    marginTop: '1rem',
    overflow: 'hidden',
  },
  infoBox: {
    padding: '1rem',
    background: `${UI_CONFIG.colors.info}20`,
    border: `1px solid ${UI_CONFIG.colors.info}`,
    borderRadius: '8px',
    marginBottom: '1rem',
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: '1.6',
  },
  infoList: {
    margin: '0.5rem 0 0 0',
    paddingLeft: '1.5rem',
  },
};

export default ScheduleSelector;