import { motion } from 'framer-motion';
import { UI_CONFIG } from '../../utils/constants';

const Card = ({
  children,
  title = null,
  subtitle = null,
  footer = null,
  variant = 'default',
  padding = 'md',
  hover = false,
  onClick = null,
  className = '',
  style = {},
  ...props
}) => {
  // Padding sizes
  const paddingSizes = {
    sm: '1rem',
    md: '1.5rem',
    lg: '2rem',
    none: '0'
  };

  // Variant styles
  const variantStyles = {
    default: {
      background: UI_CONFIG.glass.backdrop,
      backdropFilter: UI_CONFIG.glass.blur,
      border: UI_CONFIG.glass.border
    },
    solid: {
      background: 'rgba(26, 26, 26, 0.95)',
      border: `1px solid ${UI_CONFIG.colors.border}`
    },
    outlined: {
      background: 'transparent',
      border: `1px solid ${UI_CONFIG.colors.border}`
    },
    gradient: {
      background: 'linear-gradient(135deg, rgba(0,255,136,0.1), rgba(26,26,26,0.8))',
      backdropFilter: UI_CONFIG.glass.blur,
      border: `1px solid ${UI_CONFIG.colors.success}`
    }
  };

  const cardStyle = {
    ...variantStyles[variant],
    padding: paddingSizes[padding],
    borderRadius: '12px',
    transition: UI_CONFIG.transitions.default,
    cursor: onClick ? 'pointer' : 'default',
    ...style
  };

  const CardWrapper = onClick || hover ? motion.div : 'div';

  const motionProps = (onClick || hover) ? {
    whileHover: { scale: 1.02, y: -2 },
    whileTap: onClick ? { scale: 0.98 } : {},
    transition: { duration: 0.2 }
  } : {};

  return (
    <CardWrapper
      className={`glass-card ${className}`}
      style={cardStyle}
      onClick={onClick}
      {...motionProps}
      {...props}
    >
      {/* Header */}
      {(title || subtitle) && (
        <div style={{ 
          marginBottom: padding !== 'none' ? '1rem' : '0.5rem',
          borderBottom: `1px solid ${UI_CONFIG.colors.border}`,
          paddingBottom: '0.75rem'
        }}>
          {title && (
            <h3 style={{
              margin: 0,
              fontSize: '1.25rem',
              fontWeight: 'bold',
              fontFamily: UI_CONFIG.fonts.primary,
              color: UI_CONFIG.colors.text,
              marginBottom: subtitle ? '0.25rem' : 0
            }}>
              {title}
            </h3>
          )}
          {subtitle && (
            <p style={{
              margin: 0,
              fontSize: '0.875rem',
              color: 'rgba(255,255,255,0.6)'
            }}>
              {subtitle}
            </p>
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1 }}>
        {children}
      </div>

      {/* Footer */}
      {footer && (
        <div style={{
          marginTop: padding !== 'none' ? '1rem' : '0.5rem',
          paddingTop: '0.75rem',
          borderTop: `1px solid ${UI_CONFIG.colors.border}`
        }}>
          {footer}
        </div>
      )}
    </CardWrapper>
  );
};

export default Card;