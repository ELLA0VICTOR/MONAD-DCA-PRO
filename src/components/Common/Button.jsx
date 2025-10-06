// src/components/Common/Button.jsx

import { motion } from 'framer-motion';
import { UI_CONFIG } from '../../utils/constants';

const Button = ({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  icon = null,
  iconPosition = 'left',
  className = '',
  type = 'button',
  ...props
}) => {
  // Size classes
  const sizeStyles = {
    sm: { padding: '0.5rem 1rem', fontSize: '0.875rem' },
    md: { padding: '0.75rem 1.5rem', fontSize: '1rem' },
    lg: { padding: '1rem 2rem', fontSize: '1.125rem' }
  };

  // Get base button class based on variant
  const getButtonClass = () => {
    switch (variant) {
      case 'primary':
        return 'btn-primary';
      case 'secondary':
        return 'btn-secondary';
      case 'ghost':
        return 'btn-ghost';
      case 'danger':
        return 'btn-danger';
      default:
        return 'btn';
    }
  };

  const buttonClass = `${getButtonClass()} ${className}`;
  const sizeStyle = sizeStyles[size];

  return (
    <motion.button
      type={type}
      className={buttonClass}
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        ...sizeStyle,
        width: fullWidth ? '100%' : 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        opacity: disabled && !loading ? 0.5 : 1,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        position: 'relative'
      }}
      whileHover={!disabled && !loading ? { scale: 1.02 } : {}}
      whileTap={!disabled && !loading ? { scale: 0.98 } : {}}
      transition={{ duration: 0.2 }}
      {...props}
    >
      {loading && (
        <div className="spinner" style={{ 
          width: '16px', 
          height: '16px',
          borderWidth: '2px'
        }} />
      )}
      
      {!loading && icon && iconPosition === 'left' && (
        <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>
      )}
      
      {!loading && <span>{children}</span>}
      
      {!loading && icon && iconPosition === 'right' && (
        <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>
      )}
    </motion.button>
  );
};

export default Button;