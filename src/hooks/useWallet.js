import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useEffect, useState } from 'react';
import { formatAddress } from '../utils/formatters';

/**
 * useWallet Hook
 * 
 * Manages EOA wallet connection using wagmi.
 * Handles MetaMask/injected wallet connection and disconnection.
 * Provides formatted address and connection state.
 */
export function useWallet() {
  const { address, isConnected, chain } = useAccount();
  const { connect, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();

  const [error, setError] = useState(null);

  // Clear error when connection state changes
  useEffect(() => {
    if (isConnected) {
      setError(null);
    }
  }, [isConnected]);

  // Handle connection errors
  useEffect(() => {
    if (connectError) {
      setError(connectError.message || 'Failed to connect wallet');
    }
  }, [connectError]);

  /**
   * Connect to MetaMask/injected wallet
   */
  const connectWallet = () => {
    try {
      setError(null);
      connect({ connector: injected() });
    } catch (err) {
      setError(err.message || 'Failed to connect wallet');
      console.error('Wallet connection error:', err);
    }
  };

  /**
   * Disconnect wallet
   */
  const disconnectWallet = () => {
    try {
      disconnect();
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to disconnect wallet');
      console.error('Wallet disconnection error:', err);
    }
  };

  return {
    // State
    address,
    isConnected,
    isConnecting,
    chain,
    error,

    // Formatted address
    shortAddress: address ? formatAddress(address, 6, 4) : null,
    fullAddress: address || null,

    // Methods
    connect: connectWallet,
    disconnect: disconnectWallet,

    // Chain info
    chainId: chain?.id,
    chainName: chain?.name,
    isCorrectChain: chain?.id === 10143, // Monad testnet
  };
}

export default useWallet;