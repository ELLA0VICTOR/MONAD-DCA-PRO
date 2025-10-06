// src/components/Common/LoadingState.jsx

import { motion } from 'framer-motion';
import { UI_CONFIG } from '../../utils/constants';

const LoadingState = ({
  type = 'spinner',
  size = 'md',
  text = null,
  fullScreen = false,
  overlay = false,
  className = '',
  ...props
}) => {
  // Size configurations
  const sizes = {
    sm: { spinner: '20px', skeleton: '40px', text: '0.875rem' },
    md: { spinner: '40px', skeleton: '60px', text: '1rem' },
    lg: { spinner: '60px', skeleton: '80px', text: '1.125rem' }
  };

  const currentSize = sizes[size];

  // Spinner loader
  const SpinnerLoader = () => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
      <div 
        className="spinner"
        style={{
          width: currentSize.spinner,
          height: currentSize.spinner,
          borderWidth: size === 'sm' ? '2px' : size === 'md' ? '3px' : '4px'
        }}
      />
      {text && (
        <p style={{ 
          margin: 0, 
          fontSize: currentSize.text, 
          color: 'rgba(255,255,255,0.7)' 
        }}>
          {text}
        </p>
      )}
    </div>
  );

  // Pulse loader (three dots)
  const PulseLoader = () => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {[0, 1, 2].map((index) => (
          <motion.div
            key={index}
            style={{
              width: size === 'sm' ? '8px' : size === 'md' ? '12px' : '16px',
              height: size === 'sm' ? '8px' : size === 'md' ? '12px' : '16px',
              borderRadius: '50%',
              background: UI_CONFIG.colors.success
            }}
            animate={{
              scale: [1, 1.5, 1],
              opacity: [1, 0.5, 1]
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              delay: index * 0.2
            }}
          />
        ))}
      </div>
      {text && (
        <p style={{ 
          margin: 0, 
          fontSize: currentSize.text, 
          color: 'rgba(255,255,255,0.7)' 
        }}>
          {text}
        </p>
      )}
    </div>
  );

  // Skeleton loader (shimmer effect)
  const SkeletonLoader = () => (
    <div style={{ width: '100%' }}>
      <div 
        className="skeleton"
        style={{
          height: currentSize.skeleton,
          borderRadius: '8px',
          marginBottom: '0.75rem'
        }}
      />
      <div 
        className="skeleton"
        style={{
          height: currentSize.skeleton,
          width: '75%',
          borderRadius: '8px',
          marginBottom: '0.75rem'
        }}
      />
      <div 
        className="skeleton"
        style={{
          height: currentSize.skeleton,
          width: '50%',
          borderRadius: '8px'
        }}
      />
    </div>
  );

  // Bar loader (progress bar animation)
  const BarLoader = () => (
    <div style={{ width: '100%', maxWidth: '300px' }}>
      <div style={{
        width: '100%',
        height: size === 'sm' ? '4px' : size === 'md' ? '6px' : '8px',
        background: 'rgba(255,255,255,0.1)',
        borderRadius: '10px',
        overflow: 'hidden',
        position: 'relative'
      }}>
        <motion.div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: '40%',
            background: `linear-gradient(90deg, ${UI_CONFIG.colors.success}, rgba(0,255,136,0.5))`,
            borderRadius: '10px'
          }}
          animate={{
            x: ['-100%', '250%']
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
        />
      </div>
      {text && (
        <p style={{ 
          margin: '0.75rem 0 0 0', 
          fontSize: currentSize.text, 
          color: 'rgba(255,255,255,0.7)',
          textAlign: 'center'
        }}>
          {text}
        </p>
      )}
    </div>
  );

  // Select loader type
  const renderLoader = () => {
    switch (type) {
      case 'spinner':
        return <SpinnerLoader />;
      case 'pulse':
        return <PulseLoader />;
      case 'skeleton':
        return <SkeletonLoader />;
      case 'bar':
        return <BarLoader />;
      default:
        return <SpinnerLoader />;
    }
  };

  // Wrapper styles
  const wrapperStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...(fullScreen && {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9998
    }),
    ...(overlay && {
      background: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(4px)'
    })
  };

  return (
    <motion.div
      className={`loading-container ${className}`}
      style={wrapperStyle}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      {...props}
    >
      {renderLoader()}
    </motion.div>
  );
};

export default LoadingState;