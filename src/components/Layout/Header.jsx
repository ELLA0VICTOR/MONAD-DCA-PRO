import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import useSmartAccount from '../../hooks/useSmartAccount';
import { formatAddress, formatTokenAmount } from '../../utils/formatters';
import { MONAD_CONFIG } from '../../utils/constants';

function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { 
    accountAddress, 
    balance, 
    isDeployed, 
    status,
    disconnect 
  } = useSmartAccount();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Track scroll for backdrop effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  const isActive = (path) => location.pathname === path;

  const handleDisconnect = () => {
    disconnect();
    navigate('/account/create');
  };

  const navLinks = [
    { path: '/account/create', label: 'Account', show: true },
    { path: '/account/delegations', label: 'Delegations', show: accountAddress },
    // TODO: Uncomment when DCA components are generated
    // { path: '/dca/create', label: 'Create Strategy', show: accountAddress && isDeployed },
    // { path: '/dca/strategies', label: 'Strategies', show: accountAddress && isDeployed },
    // { path: '/dashboard', label: 'Dashboard', show: accountAddress && isDeployed },
  ].filter(link => link.show);

  return (
    <header 
      className={`header ${scrolled ? 'header-scrolled' : ''}`}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        backdropFilter: scrolled ? 'blur(10px)' : 'none',
        background: scrolled 
          ? 'rgba(0, 0, 0, 0.9)' 
          : 'linear-gradient(180deg, rgba(0, 0, 0, 0.95) 0%, rgba(0, 0, 0, 0.85) 100%)',
        transition: 'all 400ms ease',
      }}
    >
      <div 
        className="container"
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '1rem 2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Logo / Brand */}
        <Link 
          to="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            textDecoration: 'none',
            color: '#ffffff',
            fontFamily: 'Orbitron, monospace',
            fontWeight: 700,
            fontSize: '1.25rem',
            letterSpacing: '0.5px',
            transition: 'opacity 200ms ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              background: 'linear-gradient(135deg, #00ff88 0%, #00aa55 100%)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              fontWeight: 900,
              boxShadow: '0 0 20px rgba(0, 255, 136, 0.3)',
            }}
          >
            M
          </div>
          <span>MONAD DCA PRO</span>
        </Link>

        {/* Desktop Navigation */}
        <nav 
          className="nav-desktop"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2rem',
          }}
        >
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={isActive(link.path) ? 'nav-link-active' : ''}
              style={{
                color: isActive(link.path) ? '#00ff88' : 'rgba(255, 255, 255, 0.8)',
                textDecoration: 'none',
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.9rem',
                fontWeight: 600,
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                transition: 'all 200ms ease',
                border: isActive(link.path) 
                  ? '1px solid rgba(0, 255, 136, 0.3)' 
                  : '1px solid transparent',
                background: isActive(link.path) 
                  ? 'rgba(0, 255, 136, 0.1)' 
                  : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!isActive(link.path)) {
                  e.currentTarget.style.color = '#ffffff';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive(link.path)) {
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Account Status & Actions */}
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          {accountAddress ? (
            <>
              {/* Network Badge */}
              <div
                className="network-badge"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 1rem',
                  background: 'rgba(0, 255, 136, 0.1)',
                  border: '1px solid rgba(0, 255, 136, 0.3)',
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#00ff88',
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#00ff88',
                    boxShadow: '0 0 8px rgba(0, 255, 136, 0.6)',
                    animation: 'pulse 2s ease-in-out infinite',
                  }}
                />
                {MONAD_CONFIG.name}
              </div>

              {/* Balance Display */}
              {balance && (
                <div
                  style={{
                    padding: '0.5rem 1rem',
                    background: 'rgba(26, 26, 26, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: '#ffffff',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {formatTokenAmount(balance.mon, 18, 4)} MON
                </div>
              )}

              {/* Account Address */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 1rem',
                  background: 'rgba(26, 26, 26, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  color: 'rgba(255, 255, 255, 0.9)',
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: isDeployed ? '#00ff88' : '#ffaa00',
                  }}
                />
                {formatAddress(accountAddress)}
              </div>

              {/* Disconnect Button */}
              <button
                onClick={handleDisconnect}
                className="btn-ghost"
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.85rem',
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <Link
              to="/account/create"
              className="btn-primary"
              style={{
                padding: '0.5rem 1.5rem',
                fontSize: '0.9rem',
              }}
            >
              Connect Account
            </Link>
          )}

          {/* Mobile Menu Toggle */}
          <button
            className="mobile-menu-toggle"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            style={{
              display: 'none',
              background: 'transparent',
              border: 'none',
              color: '#ffffff',
              fontSize: '1.5rem',
              cursor: 'pointer',
              padding: '0.5rem',
            }}
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="mobile-menu"
            style={{
              overflow: 'hidden',
              background: 'rgba(0, 0, 0, 0.95)',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            <div
              style={{
                padding: '1rem 2rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  style={{
                    color: isActive(link.path) ? '#00ff88' : '#ffffff',
                    textDecoration: 'none',
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    background: isActive(link.path) 
                      ? 'rgba(0, 255, 136, 0.1)' 
                      : 'transparent',
                    border: isActive(link.path)
                      ? '1px solid rgba(0, 255, 136, 0.3)'
                      : '1px solid transparent',
                    fontWeight: 600,
                    transition: 'all 200ms ease',
                  }}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      {/* Responsive CSS */}
      <style>{`
        @media (max-width: 768px) {
          .nav-desktop {
            display: none !important;
          }
          .mobile-menu-toggle {
            display: block !important;
          }
          .network-badge,
          .header [style*="monospace"] {
            display: none !important;
          }
        }
      `}</style>
    </header>
  );
}

export default Header;