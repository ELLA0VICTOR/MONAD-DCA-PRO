import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UI_CONFIG } from '../../utils/constants';

const Modal = ({
  isOpen,
  onClose,
  title = null,
  children,
  footer = null,
  size = 'md',
  closeOnBackdropClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  className = '',
  ...props
}) => {
  // Size presets
  const sizeStyles = {
    sm: { maxWidth: '400px' },
    md: { maxWidth: '600px' },
    lg: { maxWidth: '800px' },
    xl: { maxWidth: '1000px' },
    full: { maxWidth: '95vw' }
  };

  // Handle escape key
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, closeOnEscape, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Handle backdrop click
  const handleBackdropClick = useCallback((e) => {
    if (closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  }, [closeOnBackdropClick, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem'
          }}
          onClick={handleBackdropClick}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className={`modal ${className}`}
            style={{
              ...sizeStyles[size],
              width: '100%',
              maxHeight: '90vh',
              background: UI_CONFIG.glass.backdrop,
              backdropFilter: UI_CONFIG.glass.blur,
              border: UI_CONFIG.glass.border,
              borderRadius: '12px',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            {...props}
          >
            {/* Header */}
            {(title || showCloseButton) && (
              <div style={{
                padding: '1.5rem',
                borderBottom: `1px solid ${UI_CONFIG.colors.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem'
              }}>
                {title && (
                  <h2 className="modal-title" style={{
                    margin: 0,
                    fontSize: '1.5rem',
                    fontWeight: 'bold',
                    fontFamily: UI_CONFIG.fonts.primary,
                    color: UI_CONFIG.colors.text
                  }}>
                    {title}
                  </h2>
                )}
                {showCloseButton && (
                  <button
                    onClick={onClose}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'rgba(255, 255, 255, 0.6)',
                      fontSize: '1.5rem',
                      cursor: 'pointer',
                      padding: '0.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: UI_CONFIG.transitions.fast,
                      marginLeft: 'auto'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = UI_CONFIG.colors.text}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)'}
                    aria-label="Close modal"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            {/* Content */}
            <div 
              className="modal-content"
              style={{
                padding: '1.5rem',
                overflowY: 'auto',
                flex: 1,
                color: UI_CONFIG.colors.text
              }}
            >
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div 
                className="modal-footer"
                style={{
                  padding: '1.5rem',
                  borderTop: `1px solid ${UI_CONFIG.colors.border}`,
                  display: 'flex',
                  gap: '1rem',
                  justifyContent: 'flex-end'
                }}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default Modal;