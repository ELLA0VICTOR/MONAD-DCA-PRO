import { motion } from 'framer-motion';
import { MONAD_CONFIG, UI_CONFIG } from '../../utils/constants';

const Footer = () => {
  const currentYear = new Date().getFullYear();

  const footerLinks = {
    product: [
      { label: 'Features', href: '#features' },
      { label: 'Documentation', href: 'https://docs.monad.xyz', external: true },
      { label: 'Roadmap', href: '#roadmap' }
    ],
    resources: [
      { label: 'Monad Explorer', href: MONAD_CONFIG.explorer, external: true },
      { label: 'Faucet', href: 'https://faucet.monad.xyz', external: true },
      { label: 'GitHub', href: 'https://github.com/monad-developers', external: true }
    ],
    community: [
      { label: 'Discord', href: 'https://discord.gg/monad', external: true },
      { label: 'Twitter', href: 'https://twitter.com/monad_xyz', external: true },
      { label: 'Telegram', href: 'https://t.me/monad', external: true }
    ],
    legal: [
      { label: 'Terms of Service', href: '#terms' },
      { label: 'Privacy Policy', href: '#privacy' },
      { label: 'Risk Disclaimer', href: '#disclaimer' }
    ]
  };

  const socialIcons = [
    {
      name: 'Discord',
      href: 'https://discord.gg/monad',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
        </svg>
      )
    },
    {
      name: 'Twitter',
      href: 'https://twitter.com/monad_xyz',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26l8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      )
    },
    {
      name: 'GitHub',
      href: 'https://github.com/monad-developers',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
        </svg>
      )
    }
  ];

  const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.4,
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 }
  };

  return (
    <motion.footer
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      style={{
        marginTop: 'auto',
        borderTop: `1px solid ${UI_CONFIG.colors.border}`,
        background: 'linear-gradient(180deg, transparent 0%, rgba(26, 26, 26, 0.3) 100%)',
        padding: '3rem 0 1.5rem'
      }}
    >
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: '0 2rem'
      }}>
        {/* Main Footer Content */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '3rem',
          marginBottom: '3rem'
        }}>
          {/* Brand Section */}
          <motion.div variants={itemVariants}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem'
            }}>
              <div style={{
                width: '32px',
                height: '32px',
                background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: UI_CONFIG.fonts.primary,
                fontWeight: 'bold',
                fontSize: '1.25rem',
                color: '#000'
              }}>
                M
              </div>
              <span style={{
                fontFamily: UI_CONFIG.fonts.primary,
                fontSize: '1.125rem',
                fontWeight: '600',
                color: UI_CONFIG.colors.text
              }}>
                MONAD DCA PRO
              </span>
            </div>
            <p style={{
              fontSize: '0.875rem',
              color: 'rgba(255, 255, 255, 0.6)',
              lineHeight: '1.6',
              marginBottom: '1.5rem'
            }}>
              Automated dollar-cost averaging powered by MetaMask Smart Accounts on Monad testnet.
            </p>
            {/* Social Icons */}
            <div style={{
              display: 'flex',
              gap: '1rem'
            }}>
              {socialIcons.map((social) => (
                <motion.a
                  key={social.name}
                  href={social.external ? social.href : `#${social.name.toLowerCase()}`}
                  target={social.external ? '_blank' : undefined}
                  rel={social.external ? 'noopener noreferrer' : undefined}
                  whileHover={{ scale: 1.1, color: UI_CONFIG.colors.success }}
                  whileTap={{ scale: 0.95 }}
                  style={{
                    width: '40px',
                    height: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${UI_CONFIG.colors.border}`,
                    color: 'rgba(255, 255, 255, 0.7)',
                    transition: UI_CONFIG.transitions.default,
                    cursor: 'pointer'
                  }}
                  title={social.name}
                >
                  {social.icon}
                </motion.a>
              ))}
            </div>
          </motion.div>

          {/* Link Sections */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <motion.div key={category} variants={itemVariants}>
              <h3 style={{
                fontFamily: UI_CONFIG.fonts.primary,
                fontSize: '0.875rem',
                fontWeight: '600',
                color: UI_CONFIG.colors.text,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '1rem'
              }}>
                {category}
              </h3>
              <ul style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
              }}>
                {links.map((link) => (
                  <li key={link.label}>
                    <motion.a
                      href={link.href}
                      target={link.external ? '_blank' : undefined}
                      rel={link.external ? 'noopener noreferrer' : undefined}
                      whileHover={{ x: 4, color: UI_CONFIG.colors.success }}
                      style={{
                        fontSize: '0.875rem',
                        color: 'rgba(255, 255, 255, 0.6)',
                        textDecoration: 'none',
                        transition: UI_CONFIG.transitions.default,
                        display: 'inline-block',
                        cursor: 'pointer'
                      }}
                    >
                      {link.label}
                    </motion.a>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* Divider */}
        <div style={{
          height: '1px',
          background: UI_CONFIG.colors.border,
          margin: '2rem 0'
        }} />

        {/* Bottom Bar */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '2rem',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.875rem',
            color: 'rgba(255, 255, 255, 0.5)'
          }}>
            <span>
              © {currentYear} Monad DCA Pro. All rights reserved.
            </span>
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              Built on
              <motion.a
                href={MONAD_CONFIG.explorer}
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ color: UI_CONFIG.colors.success }}
                style={{
                  color: UI_CONFIG.colors.success,
                  textDecoration: 'none',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: UI_CONFIG.transitions.default
                }}
              >
                Monad Testnet
              </motion.a>
            </span>
          </div>

          {/* Testnet Warning */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              background: 'rgba(255, 170, 0, 0.1)',
              border: '1px solid rgba(255, 170, 0, 0.3)',
              fontSize: '0.75rem',
              color: UI_CONFIG.colors.warning
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L1 21h22L12 2zm0 3.83L19.53 19H4.47L12 5.83zM11 16h2v2h-2v-2zm0-6h2v4h-2v-4z"/>
            </svg>
            <span>
              Testnet Only - Do not use real funds
            </span>
          </motion.div>
        </div>
      </div>

      {/* Responsive Styles */}
      <style>{`
        @media (max-width: 768px) {
          footer > div {
            padding: 0 1.5rem !important;
          }
          footer > div > div:first-child {
            grid-template-columns: 1fr !important;
            gap: 2rem !important;
          }
          footer > div > div:last-child {
            flex-direction: column !important;
            text-align: center;
          }
        }
      `}</style>
    </motion.footer>
  );
};

export default Footer;