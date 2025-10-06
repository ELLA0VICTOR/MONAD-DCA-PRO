import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { useSmartAccount } from '../../hooks/useSmartAccount';
import { UI_CONFIG, SMART_ACCOUNT_CONFIG } from '../../utils/constants';
import { formatAddress } from '../../utils/formatters';
import { validatePrivateKey, validateAddress } from '../../utils/validators';


/**
 * AccountCreator Component
 * 
 * Purpose:
 * Professional account creation interface for MetaMask Smart Accounts on Monad.
 * Supports two flows: Create New Account or Import Existing Account.
 * Features glassmorphism design, smooth animations, and clear visual feedback.
 * 
 * Features:
 * - Dual-mode creation (new/import)
 * - Password-protected key encryption
 * - Real-time validation feedback
 * - Gas estimation display
 * - Deployment status tracking
 * - Responsive glassmorphic design
 * 
 * Dependencies:
 * - useSmartAccount hook (account lifecycle)
 * - framer-motion (animations)
 * - react-hot-toast (notifications)
 */

const AccountCreator = ({ onAccountCreated, onCancel }) => {
  // Mode selection
  const [mode, setMode] = useState('create'); // 'create' | 'import'
  
  // Form state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [importAddress, setImportAddress] = useState('');
  const [importPrivateKey, setImportPrivateKey] = useState('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  
  // UI state
  const [isCreating, setIsCreating] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [deploymentGasEstimate, setDeploymentGasEstimate] = useState(null);
  
  // Smart account hook
  const {
    createSmartAccount,
    importSmartAccount,
    deploySmartAccount,
    estimateDeploymentGas,
    smartAccount,
    accountAddress,
    isDeployed,
    balance,
    error: accountError,
    isLoading: accountLoading
  } = useSmartAccount();

  // Load gas estimate on mount
  useEffect(() => {
    loadGasEstimate();
  }, []);

  // Auto-notify on account errors
  useEffect(() => {
    if (accountError) {
      toast.error(accountError);
    }
  }, [accountError]);

  const loadGasEstimate = async () => {
    try {
      const estimate = await estimateDeploymentGas();
      setDeploymentGasEstimate(estimate);
    } catch (err) {
      console.error('Gas estimation failed:', err);
    }
  };

  // Validation logic
  const validateForm = () => {
    const errors = {};

    // Password validation
    if (!password) {
      errors.password = 'Password is required';
    } else if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters';
    }

    if (mode === 'create') {
      if (password !== confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
      }
    }

    if (mode === 'import') {
      // Address validation
      if (!importAddress) {
        errors.importAddress = 'Account address is required';
      } else {
        const validation = validateAddress(importAddress);
        if (!validation.isValid) {
          errors.importAddress = validation.error
        }
      }

      // Private key validation
      if (!importPrivateKey) {
        errors.importPrivateKey = 'Private key is required';
      } else {
        try {
          validatePrivateKey(importPrivateKey);
        } catch (err) {
          errors.importPrivateKey = err.message;
        }
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle account creation
  const handleCreateAccount = async () => {
    if (!validateForm()) return;

    setIsCreating(true);
    try {
      // Create smart account with encryption
      const account = await createSmartAccount({
        implementation: SMART_ACCOUNT_CONFIG.implementation,
        encryptPrivateKey: true,
        password,
        deploySalt: SMART_ACCOUNT_CONFIG.deploySalt
      });

      toast.success('Smart Account created successfully!');
      
      // Optionally auto-deploy
      if (onAccountCreated) {
        onAccountCreated(account);
      }
    } catch (err) {
      console.error('Account creation failed:', err);
      toast.error(err?.message || String(err) || 'Unexpected error');
    } finally {
      setIsCreating(false);
    }
  };

  // Handle account import
  const handleImportAccount = async () => {
    if (!validateForm()) return;

    setIsCreating(true);
    try {
      const account = await importSmartAccount(
        importAddress,
        importPrivateKey,
        password
      );

      toast.success('Account imported successfully!');
      
      if (onAccountCreated) {
        onAccountCreated(account);
      }
    } catch (err) {
      console.error('Account import failed:', err);
      toast.error(err.message || String(err) || 'Unexpected error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'create') {
      handleCreateAccount();
    } else {
      handleImportAccount();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4 }}
      className="account-creator glass-card"
    >
      {/* Header */}
      <div className="account-creator-header">
        <h2 className="account-creator-title">Create Smart Account</h2>
        <p className="account-creator-subtitle">
          Deploy a MetaMask Smart Account with delegation capabilities on Monad testnet
        </p>
      </div>

      {/* Mode Selector */}
      <div className="mode-selector">
        <button
          type="button"
          onClick={() => setMode('create')}
          className={`mode-button ${mode === 'create' ? 'mode-button-active' : ''}`}
        >
          Create New
        </button>
        <button
          type="button"
          onClick={() => setMode('import')}
          className={`mode-button ${mode === 'import' ? 'mode-button-active' : ''}`}
        >
          Import Existing
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="account-creator-form">
        <AnimatePresence mode="wait">
          {mode === 'create' ? (
            <motion.div
              key="create-mode"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Password */}
              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter a secure password (min 8 characters)"
                  className={`form-input ${validationErrors.password ? 'form-input-error' : ''}`}
                  disabled={isCreating || accountLoading}
                />
                {validationErrors.password && (
                  <span className="form-error-text">{validationErrors.password}</span>
                )}
              </div>

              {/* Confirm Password */}
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className={`form-input ${validationErrors.confirmPassword ? 'form-input-error' : ''}`}
                  disabled={isCreating || accountLoading}
                />
                {validationErrors.confirmPassword && (
                  <span className="form-error-text">{validationErrors.confirmPassword}</span>
                )}
              </div>

              {/* Info Box */}
              <div className="info-box">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="info-icon">
                  <path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm1 12H7V7h2v5zm0-6H7V4h2v2z" fill="#00ff88"/>
                </svg>
                <div className="info-content">
                  <p className="info-title">Secure Account Creation</p>
                  <ul className="info-list">
                    <li>Private key encrypted with your password</li>
                    <li>Deterministic deployment on Monad testnet</li>
                    <li>Supports delegations and passkeys</li>
                    <li>Est. deployment: {deploymentGasEstimate?.formatted || '~0.015 MON'}</li>
                  </ul>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="import-mode"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Account Address */}
              <div className="form-group">
                <label className="form-label">Account Address</label>
                <input
                  type="text"
                  value={importAddress}
                  onChange={(e) => setImportAddress(e.target.value.trim())}
                  placeholder="0x..."
                  className={`form-input ${validationErrors.importAddress ? 'form-input-error' : ''}`}
                  disabled={isCreating || accountLoading}
                />
                {validationErrors.importAddress && (
                  <span className="form-error-text">{validationErrors.importAddress}</span>
                )}
              </div>

              {/* Private Key */}
              <div className="form-group">
                <label className="form-label">Private Key</label>
                <div className="input-with-button">
                  <input
                    type={showPrivateKey ? 'text' : 'password'}
                    value={importPrivateKey}
                    onChange={(e) => setImportPrivateKey(e.target.value.trim())}
                    placeholder="0x... or 64 hex characters"
                    className={`form-input form-input-with-icon ${validationErrors.importPrivateKey ? 'form-input-error' : ''}`}
                    disabled={isCreating || accountLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                    className="eye-button"
                    disabled={isCreating || accountLoading}
                  >
                    {showPrivateKey ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
                {validationErrors.importPrivateKey && (
                  <span className="form-error-text">{validationErrors.importPrivateKey}</span>
                )}
              </div>

              {/* Password */}
              <div className="form-group">
                <label className="form-label">Encryption Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password to encrypt your private key"
                  className={`form-input ${validationErrors.password ? 'form-input-error' : ''}`}
                  disabled={isCreating || accountLoading}
                />
                {validationErrors.password && (
                  <span className="form-error-text">{validationErrors.password}</span>
                )}
              </div>

              {/* Warning Box */}
              <div className="warning-box">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="warning-icon">
                  <path d="M8 0L0 14h16L8 0zm1 12H7v-2h2v2zm0-3H7V5h2v4z" fill="#ffaa00"/>
                </svg>
                <div className="warning-content">
                  <p className="warning-title">Security Notice</p>
                  <p className="warning-text">
                    Never share your private key. It will be encrypted and stored securely.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action Buttons */}
        <div className="form-actions">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-secondary"
              disabled={isCreating || accountLoading}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isCreating || accountLoading}
          >
            {isCreating || accountLoading ? (
              <span className="btn-loading">
                <span className="spinner" />
                {mode === 'create' ? 'Creating...' : 'Importing...'}
              </span>
            ) : (
              mode === 'create' ? 'Create Account' : 'Import Account'
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );
};

export default AccountCreator;