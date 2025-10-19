import { createBundlerClient, createPaymasterClient } from 'viem/account-abstraction';
import { createPublicClient, http } from 'viem';
import { ALCHEMY_CONFIG } from '../../utils/constants.js';
import { monadTestnet } from '../monad/monadClient.js';

/**
 * ✅ SIMPLIFIED Alchemy Bundler Client
 * Following the guide - let Alchemy handle gas estimation automatically!
 */
export class AlchemyBundlerClient {
  constructor() {
    this.bundlerUrl = `https://monad-testnet.g.alchemy.com/v2/${ALCHEMY_CONFIG.API_KEY}`;
    this.publicClient = null;
    this.bundlerClient = null;
    this.paymasterClient = null; 

    this.initializeClients();
  }

  initializeClients() {
    try {
      // ✅ Step 1: Create public client
      this.publicClient = createPublicClient({
        chain: monadTestnet,
        transport: http(monadTestnet.rpcUrls.default.http[0])
      });

      // ✅ Step 2: Create bundler client (just like the guide)
      this.bundlerClient = createBundlerClient({
        client: this.publicClient,
        transport: http(this.bundlerUrl),
      });

      // ✅ Step 3: Create paymaster client (THIS WAS MISSING!)
      this.paymasterClient = createPaymasterClient({
        transport: http(this.bundlerUrl),
      });

      console.log('✅ Alchemy Bundler + Paymaster initialized');
      console.log('✅ Gas Manager Policy:', ALCHEMY_CONFIG.POLICY_ID);
    } catch (error) {
      console.error('❌ Failed to initialize Alchemy clients:', error);
      throw new Error(`Alchemy client initialization failed: ${error.message}`);
    }
  }

  /**
   * Get bundler client for sending operations
   */
  getBundlerClient() {
    return this.bundlerClient;
  }

  /**
   * Get paymaster client for gas sponsorship
   */
  getPaymasterClient() {
    return this.paymasterClient;
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const blockNumber = await this.publicClient.getBlockNumber();
      console.log('✅ Alchemy Bundler healthy - Block:', blockNumber);
      return true;
    } catch (error) {
      console.error('❌ Health check failed:', error);
      return false;
    }
  }
}

// ✅ Create singleton
export const bundlerClient = new AlchemyBundlerClient();

export default {
  AlchemyBundlerClient,
  bundlerClient
};