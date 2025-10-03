import { motion } from 'framer-motion';
import { UI_CONFIG } from '../../utils/constants';
import { useEffect } from 'react';

const Container = ({ 
  children, 
  maxWidth = '1400px',
  padding = '2rem',
  center = false,
  animate = true,
  className = '',
  style = {}
}) => {
  const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.4,
        ease: 'easeOut'
      }
    }
  };

  const containerStyles = {
    maxWidth,
    margin: center ? '0 auto' : '0',
    padding,
    width: '100%',
    ...style
  };

  if (animate) {
    return (
      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className={className}
        style={containerStyles}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <div className={className} style={containerStyles}>
      {children}
    </div>
  );
};

export default Container;
// Export named variants for specific use cases
export const PageContainer = ({ children, ...props }) => (
    <Container
      maxWidth="1400px"
      padding="2rem"
      center={true}
      animate={true}
      {...props}
    >
      {children}
    </Container>
  );
  
  export const SectionContainer = ({ children, ...props }) => (
    <Container
      maxWidth="100%"
      padding="3rem 2rem"
      center={false}
      animate={false}
      {...props}
    >
      {children}
    </Container>
  );
  
  export const CardContainer = ({ children, glass = true, ...props }) => (
    <Container
      maxWidth="100%"
      padding="1.5rem"
      center={false}
      animate={false}
      style={{
        borderRadius: '12px',
        background: glass 
          ? UI_CONFIG.glass.backdrop 
          : 'rgba(26, 26, 26, 0.6)',
        backdropFilter: glass ? UI_CONFIG.glass.blur : 'none',
        border: UI_CONFIG.glass.border,
        ...props.style
      }}
      {...props}
    >
      {children}
    </Container>
  );
  
  export const FormContainer = ({ children, ...props }) => (
    <Container
      maxWidth="600px"
      padding="2rem"
      center={true}
      animate={true}
      style={{
        borderRadius: '16px',
        background: UI_CONFIG.glass.backdrop,
        backdropFilter: UI_CONFIG.glass.blur,
        border: UI_CONFIG.glass.border,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        ...props.style
      }}
      {...props}
    >
      {children}
    </Container>
  );
  
  export const DashboardContainer = ({ children, ...props }) => (
    <Container
      maxWidth="1600px"
      padding="2rem"
      center={true}
      animate={false}
      style={{
        display: 'grid',
        gap: '2rem',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        ...props.style
      }}
      {...props}
    >
      {children}
    </Container>
  );
  
  export const ModalContainer = ({ children, onClose, ...props }) => {
    useEffect(() => {
        const handleKeyDown = (e) => {
          if (e.key === 'Escape') {
            onClose?.(); // close modal on ESC
          }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
      }, [onClose])
      return (
        <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role='dialog'
        aria-modal='true'
        aria-label='Modal'
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
        padding: '2rem',
        zIndex: UI_CONFIG.zIndex.modal
        }}
        onClick={onClose}
    >
        <motion.div
        role='document'
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: UI_CONFIG.glass.backdrop,
          backdropFilter: UI_CONFIG.glass.blur,
          border: UI_CONFIG.glass.border,
          borderRadius: '16px',
          padding: '2rem',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)'
        }}
        {...props}
      >
        {children}
      </motion.div>
    </motion.div>
    );
}
    
  // Responsive container with breakpoint-aware padding
export const ResponsiveContainer = ({ children, ...props }) => {
    return (
      <>
        <Container
          className="responsive-container"
          {...props}
        >
          {children}
        </Container>
        <style>{`
          .responsive-container {
            padding: 2rem;
          }
          
          @media (max-width: 768px) {
            .responsive-container {
              padding: 1.5rem !important;
            }
          }
          
          @media (max-width: 480px) {
            .responsive-container {
              padding: 1rem !important;
            }
          }
        `}</style>
      </>
    );
  };
  
  // Grid container with responsive columns
  export const GridContainer = ({ 
    children, 
    columns = 3, 
    gap = '2rem',
    minColumnWidth = '300px',
    ...props 
  }) => (
    <Container
      maxWidth="1400px"
      center={true}
      animate={false}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${minColumnWidth}, 1fr))`,
        gap,
        ...props.style
      }}
      {...props}
    >
      {children}
    </Container>
  );
  
  // Flex container with common flex patterns
  export const FlexContainer = ({ 
    children, 
    direction = 'row',
    justify = 'flex-start',
    align = 'stretch',
    gap = '1rem',
    wrap = 'nowrap',
    ...props 
  }) => (
    <Container
      animate={false}
      style={{
        display: 'flex',
        flexDirection: direction,
        justifyContent: justify,
        alignItems: align,
        gap,
        flexWrap: wrap,
        ...props.style
      }}
      {...props}
    >
      {children}
    </Container>
  );
  
  // Scrollable container with custom scrollbar
  export const ScrollContainer = ({ 
    children, 
    maxHeight = '600px',
    ...props 
  }) => (
    <>
      <Container
        className="scroll-container"
        animate={false}
        style={{
          maxHeight,
          overflowY: 'auto',
          overflowX: 'hidden',
          ...props.style
        }}
        {...props}
      >
        {children}
      </Container>
      <style>{`
        .scroll-container::-webkit-scrollbar {
          width: 8px;
        }
        
        .scroll-container::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        }
        
        .scroll-container::-webkit-scrollbar-thumb {
          background: rgba(0, 255, 136, 0.3);
          border-radius: 4px;
        }
        
        .scroll-container::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 255, 136, 0.5);
        }
      `}</style>
    </>
  );