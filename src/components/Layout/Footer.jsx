import { MONAD_CONFIG } from '../../utils/constants';

/**
 * Footer Component (Minimal, Purple Theme)
 * 
 * Simplified footer with essential links only.
 * Small footprint, clean design.
 */
function Footer() {
  

  return (
    <footer className="footer">
      <div className="footer-container">
        

        {/* Center: Links */}
        <div className="footer-links">
          <a 
            href="https://docs.monad.xyz" 
            target="_blank" 
            rel="noopener noreferrer"
            className="footer-link"
          >
            Docs
          </a>
          <a 
            href={MONAD_CONFIG.explorer} 
            target="_blank" 
            rel="noopener noreferrer"
            className="footer-link"
          >
            Explorer
          </a>
          <a 
            href="https://faucet.monad.xyz" 
            target="_blank" 
            rel="noopener noreferrer"
            className="footer-link"
          >
            Faucet
          </a>
          <a 
            href="https://github.com/monad-developers" 
            target="_blank" 
            rel="noopener noreferrer"
            className="footer-link"
          >
            GitHub
          </a>
        </div>

        
      </div>

      {/* Testnet Warning */}
      <div className="footer-warning">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L1 21h22L12 2zm0 3.83L19.53 19H4.47L12 5.83zM11 16h2v2h-2v-2zm0-6h2v4h-2v-4z"/>
        </svg>
        <span>Testnet Only - Do not use real funds</span>
      </div>

      <style jsx>{`
        .footer {
          margin-top: auto;
          border-top: 1px solid var(--border);
          background: var(--bg-primary);
          padding: 0.5rem 0;
        }

        .footer-container {
          max-width: 1600px;
          margin: 0 auto;
          padding: 0 2rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 2rem;
        }

        .footer-text {
          font-size: 12px;
          color: var(--text-secondary);
          font-family: 'Inter', sans-serif;
          font-weight: 500;
        }

        .footer-links {
          display: flex;
          align-items: center;
          gap: 2rem;
        }

        .footer-link {
          font-size: 12px;
          color: var(--text-secondary);
          text-decoration: none;
          font-weight: 500;
          transition: color 200ms ease;
          font-family: 'Inter', sans-serif;
        }

        .footer-link:hover {
          color: var(--primary);
        }

        .footer-highlight {
          color: var(--primary);
          text-decoration: none;
          font-weight: 600;
          transition: color 200ms ease;
        }

        .footer-highlight:hover {
          color: var(--primary-hover);
        }

        .footer-warning {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 0.5rem;
          margin-top: 0.3rem;
          padding: 0.2rem 6rem 0.2rem 0;
          font-size: 11px;
          color: white;
          font-weight: 600;
          font-family: 'Inter', sans-serif;
        }

        @media (max-width: 768px) {
          .footer-container {
            flex-direction: column;
            text-align: center;
            gap: 1rem;
            padding: 0 1rem;
          }

          .footer-links {
            flex-wrap: wrap;
            justify-content: center;
            gap: 1rem;
          }

          .footer-left,
          .footer-right {
            width: 100%;
          }
        }
      `}</style>
    </footer>
  );
}

export default Footer;