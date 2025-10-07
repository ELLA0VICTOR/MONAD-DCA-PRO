import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

// 🧩 Wagmi (v2+)
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config as wagmiConfig } from './config/wagmiConfig';

// React Query client for wagmi
const queryClient = new QueryClient();

// Toast config (unchanged)
const toastOptions = {
  duration: 4000,
  position: 'top-right',
  style: {
    background: '#1a1a1a',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    padding: '16px',
    fontFamily: 'Inter, sans-serif',
    fontSize: '14px',
    backdropFilter: 'blur(10px)',
  },
  success: {
    iconTheme: {
      primary: '#00ff88',
      secondary: '#000000',
    },
  },
  error: {
    iconTheme: {
      primary: '#ff4444',
      secondary: '#000000',
    },
  },
  loading: {
    iconTheme: {
      primary: '#00aaff',
      secondary: '#000000',
    },
  },
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* ✅ Modern Wagmi + React Query setup */}
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster toastOptions={toastOptions} />
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
