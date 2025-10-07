import { createConfig, http } from 'wagmi';
import { monadTestnet } from '../services/monad/monadClient';
import { injected } from 'wagmi/connectors';

// - Uses the Monad testnet chain object you already defined in monadClient.js
// - Enables injected connectors (MetaMask, Rabby, etc.)
// - Sets up transport using your monad RPC URL

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    [monadTestnet.id]: http(monadTestnet.rpcUrls.default.http[0]),
  },
  ssr: false, // disable server-side rendering for safety in browser-only context
});
