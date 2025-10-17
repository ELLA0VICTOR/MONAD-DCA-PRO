import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMonoAI } from '../../hooks/useMonoAI';
import { UI_CONFIG } from '../../utils/constants';

const MonoAI = ({ isOpen, onClose, context }) => {
  const {
    messages,
    isLoading,
    isInitialized,
    error,
    pendingAction,
    isExecuting,
    sendMessage,
    executeAction,
    cancelAction,
    clearConversation,
    quickAction
  } = useMonoAI(context);

  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && isInitialized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isInitialized]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const message = inputValue.trim();
    setInputValue('');
    await sendMessage(message);
  };

  const handleQuickAction = async (actionType) => {
    await quickAction(actionType);
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const getMessageIcon = (type, role) => {
    if (role === 'user') return '👤';
    
    switch (type) {
      case 'greeting':
      case 'help':
        return '👋';
      case 'quote':
      case 'info':
        return '💡';
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'clarification':
        return '❓';
      case 'status':
        return '📊';
      case 'dca_setup':
        return '📅';
      default:
        return '🤖';
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={styles.backdrop}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            style={styles.modal}
          >
            {/* Header */}
            <div style={styles.header}>
              <div style={styles.headerLeft}>
                <div style={styles.aiAvatar}>🤖</div>
                <div>
                  <h2 style={styles.title}>Mono AI</h2>
                  <p style={styles.subtitle}>
                    {isInitialized ? 'Your DCA Assistant' : 'Initializing...'}
                  </p>
                </div>
              </div>
              <div style={styles.headerActions}>
                <button 
                  onClick={() => handleQuickAction('help')}
                  style={styles.iconButton}
                  title="Help"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </button>
                <button 
                  onClick={clearConversation}
                  style={styles.iconButton}
                  title="Clear conversation"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="1 4 1 10 7 10"/>
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                  </svg>
                </button>
                <button 
                  onClick={onClose}
                  style={styles.closeButton}
                  title="Close"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Quick Actions */}
            <div style={styles.quickActions}>
              <button 
                onClick={() => handleQuickAction('status')}
                style={styles.quickActionBtn}
                disabled={isLoading}
              >
                📊 Status
              </button>
              <button 
                onClick={() => handleQuickAction('list')}
                style={styles.quickActionBtn}
                disabled={isLoading}
              >
                📋 List Strategies
              </button>
              <button 
                onClick={() => handleQuickAction('quote')}
                style={styles.quickActionBtn}
                disabled={isLoading}
              >
                💰 Get Quote
              </button>
            </div>

            {/* Messages */}
            <div style={styles.messagesContainer}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    ...styles.messageWrapper,
                    justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start'
                  }}
                >
                  {message.role === 'assistant' && (
                    <div style={styles.messageIcon}>
                      {getMessageIcon(message.type, message.role)}
                    </div>
                  )}
                  
                  <div style={{
                    ...styles.messageBubble,
                    ...(message.role === 'user' ? styles.userBubble : styles.aiBubble),
                    ...(message.type === 'error' ? styles.errorBubble : {}),
                    ...(message.type === 'success' ? styles.successBubble : {})
                  }}>
                    <div style={styles.messageContent}>
                      {message.content}
                    </div>
                    <div style={styles.messageTime}>
                      {formatTimestamp(message.timestamp)}
                    </div>
                  </div>

                  {message.role === 'user' && (
                    <div style={styles.messageIcon}>
                      {getMessageIcon(message.type, message.role)}
                    </div>
                  )}
                </motion.div>
              ))}

              {/* Loading indicator */}
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={styles.messageWrapper}
                >
                  <div style={styles.messageIcon}>🤖</div>
                  <div style={{ ...styles.messageBubble, ...styles.aiBubble }}>
                    <div style={styles.typingIndicator}>
                      <span style={styles.typingDot}></span>
                      <span style={styles.typingDot}></span>
                      <span style={styles.typingDot}></span>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Pending action confirmation */}
              {pendingAction && !isExecuting && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={styles.actionConfirmation}
                >
                  <div style={styles.actionHeader}>
                    <span style={styles.actionLabel}>⚡ Action Required</span>
                  </div>
                  <div style={styles.actionButtons}>
                    <button 
                      onClick={executeAction}
                      style={styles.confirmButton}
                      disabled={isExecuting}
                    >
                      {isExecuting ? (
                        <>
                          <div className="spinner" style={{width: '14px', height: '14px', borderWidth: '2px'}} />
                          Executing...
                        </>
                      ) : (
                        '✓ Confirm'
                      )}
                    </button>
                    <button 
                      onClick={cancelAction}
                      style={styles.cancelButton}
                      disabled={isExecuting}
                    >
                      ✕ Cancel
                    </button>
                  </div>
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} style={styles.inputContainer}>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={isInitialized ? "Ask me anything..." : "Initializing AI..."}
                style={styles.input}
                disabled={!isInitialized || isLoading}
              />
              <button
                type="submit"
                style={{
                  ...styles.sendButton,
                  ...((!inputValue.trim() || isLoading) ? styles.sendButtonDisabled : {})
                }}
                disabled={!inputValue.trim() || isLoading || !isInitialized}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </form>

            {/* Error display */}
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={styles.errorBanner}
              >
                ⚠️ {error}
              </motion.div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

const styles = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(4px)',
    zIndex: 1000
  },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '90%',
    maxWidth: '600px',
    maxHeight: '80vh',
    background: 'rgba(20, 20, 20, 0.98)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '16px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
    zIndex: 1001,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.25rem',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem'
  },
  aiAvatar: {
    width: '40px',
    height: '40px',
    background: 'rgba(167, 139, 250, 0.1)',
    border: '1px solid rgba(167, 139, 250, 0.3)',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.25rem'
  },
  title: {
    margin: 0,
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#ffffff'
  },
  subtitle: {
    margin: '0.125rem 0 0',
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.4)'
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  iconButton: {
    width: '32px',
    height: '32px',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: 'rgba(255, 255, 255, 0.6)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s'
  },
  closeButton: {
    width: '32px',
    height: '32px',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: 'rgba(255, 255, 255, 0.6)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s'
  },
  quickActions: {
    display: 'flex',
    gap: '0.5rem',
    padding: '0.75rem 1.25rem',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
    overflowX: 'auto'
  },
  quickActionBtn: {
    padding: '0.5rem 0.875rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: '0.8125rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap'
  },
  messagesContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  messageWrapper: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '0.5rem'
  },
  messageIcon: {
    width: '28px',
    height: '28px',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.875rem',
    flexShrink: 0
  },
  messageBubble: {
    maxWidth: '75%',
    padding: '0.875rem',
    borderRadius: '12px',
    wordWrap: 'break-word'
  },
  userBubble: {
    background: 'rgba(167, 139, 250, 0.2)',
    border: '1px solid rgba(167, 139, 250, 0.3)',
    color: '#ffffff'
  },
  aiBubble: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#ffffff'
  },
  errorBubble: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)'
  },
  successBubble: {
    background: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid rgba(34, 197, 94, 0.3)'
  },
  messageContent: {
    fontSize: '0.875rem',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap'
  },
  messageTime: {
    fontSize: '0.6875rem',
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: '0.375rem'
  },
  typingIndicator: {
    display: 'flex',
    gap: '0.25rem',
    alignItems: 'center'
  },
  typingDot: {
    width: '6px',
    height: '6px',
    background: 'rgba(255, 255, 255, 0.4)',
    borderRadius: '50%',
    animation: 'typing 1.4s infinite'
  },
  actionConfirmation: {
    padding: '1rem',
    background: 'rgba(167, 139, 250, 0.1)',
    border: '1px solid rgba(167, 139, 250, 0.3)',
    borderRadius: '12px',
    marginTop: '0.5rem'
  },
  actionHeader: {
    marginBottom: '0.75rem'
  },
  actionLabel: {
    fontSize: '0.8125rem',
    fontWeight: '600',
    color: '#a78bfa'
  },
  actionButtons: {
    display: 'flex',
    gap: '0.5rem'
  },
  confirmButton: {
    flex: 1,
    padding: '0.625rem',
    background: '#a78bfa',
    border: 'none',
    borderRadius: '8px',
    color: '#000000',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.375rem'
  },
  cancelButton: {
    flex: 1,
    padding: '0.625rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  inputContainer: {
    display: 'flex',
    gap: '0.75rem',
    padding: '1.25rem',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    background: 'rgba(0, 0, 0, 0.2)'
  },
  input: {
    flex: 1,
    padding: '0.875rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '0.875rem',
    outline: 'none'
  },
  sendButton: {
    width: '44px',
    height: '44px',
    background: '#a78bfa',
    border: 'none',
    borderRadius: '10px',
    color: '#000000',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    flexShrink: 0
  },
  sendButtonDisabled: {
    background: 'rgba(255, 255, 255, 0.1)',
    color: 'rgba(255, 255, 255, 0.3)',
    cursor: 'not-allowed'
  },
  errorBanner: {
    padding: '0.75rem 1.25rem',
    background: 'rgba(239, 68, 68, 0.1)',
    borderTop: '1px solid rgba(239, 68, 68, 0.3)',
    color: '#ef4444',
    fontSize: '0.8125rem',
    textAlign: 'center'
  }
};

// Add typing animation CSS
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes typing {
      0%, 60%, 100% { opacity: 0.3; }
      30% { opacity: 1; }
    }
    
    .typing-indicator span:nth-child(2) {
      animation-delay: 0.2s;
    }
    
    .typing-indicator span:nth-child(3) {
      animation-delay: 0.4s;
    }
  `;
  document.head.appendChild(style);
}

export default MonoAI;