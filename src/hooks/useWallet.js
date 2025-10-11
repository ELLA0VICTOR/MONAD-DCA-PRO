import { useAccount, useConnect, useDisconnect, useWalletClient, useSignMessage } from 'wagmi';
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
  const { data: walletClient } = useWalletClient();
  const { signMessageAsync, isPending: isSigningMessage } = useSignMessage();

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

  /**
   * Sign a message to prove wallet ownership
   */
  const signMessage = async (message) => {
    if (!address || !isConnected) {
      throw new Error('Wallet not connected');
    }
    
    try {
      console.log('📝 Requesting signature for message:', message);
      const signature = await signMessageAsync({ message });
      console.log('✅ Signature received:', signature);
      return signature;
    } catch (err) {
      console.error('❌ Failed to sign message:', err);
      
      // More specific error messages
      if (err.message?.includes('User rejected')) {
        throw new Error('Signature request rejected by user');
      } else if (err.message?.includes('User denied')) {
        throw new Error('Signature request denied by user');
      }
      
      throw new Error('Failed to sign message: ' + err.message);
    }
  };

  return {
    // State
    address,
    isConnected,
    isConnecting,
    chain,
    error,
    walletClient, // Expose wallet client for signing
    isSigningMessage,

    // Formatted address
    shortAddress: address ? formatAddress(address, 6, 4) : null,
    fullAddress: address || null,

    // Methods
    connect: connectWallet,
    disconnect: disconnectWallet,
    signMessage,

    // Chain info
    chainId: chain?.id,
    chainName: chain?.name,
    isCorrectChain: chain?.id === 10143, // Monad testnet
  };
}

export default useWallet;