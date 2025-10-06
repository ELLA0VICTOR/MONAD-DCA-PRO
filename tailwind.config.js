/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#000000',
        text: '#FFFFFF',
        accent: '#1a1a1a',
        secondary: '#2a2a2a',
        border: 'rgba(255, 255, 255, 0.1)',
        success: '#00ff88',
        warning: '#ffaa00',
        error: '#ff4444',
        info: '#00aaff',
      },
      fontFamily: {
        primary: ['Orbitron', 'monospace'],
        secondary: ['Inter', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
        sm: '4px',
        DEFAULT: '10px',
        md: '12px',
        lg: '16px',
        xl: '24px',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-in-up': 'slideInUp 0.4s ease-out',
        'slide-in-down': 'slideInDown 0.4s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'spin': 'spin 1s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideInUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideInDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
      },
      boxShadow: {
        'glow-sm': '0 0 10px rgba(0, 255, 136, 0.3)',
        'glow': '0 0 20px rgba(0, 255, 136, 0.4)',
        'glow-lg': '0 0 30px rgba(0, 255, 136, 0.5)',
      },
      transitionDuration: {
        '400': '400ms',
      },
    },
  },
  plugins: [],
}