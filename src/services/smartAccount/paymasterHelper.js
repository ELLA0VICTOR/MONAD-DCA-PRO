// src/services/smartAccount/paymasterHelper.js
import { 
    keccak256, 
    encodeAbiParameters,
    parseAbiParameters,
    createWalletClient,
    http
  } from 'viem';
  import { privateKeyToAccount } from 'viem/accounts';
  import { monadTestnet } from '../monad/monadClient.js';
  import { FASTLANE_CONFIG } from '../../utils/constants.js';
  
  /**
   * Fastlane Paymaster Helper
   * Implements the official Fastlane sponsorship signing pattern
   */
  
  /**
   * Get the hash of the user operation (Fastlane format)
   * This matches the exact hash structure from the official Fastlane demo
   * @param {object} userOp - The packed user operation
   * @param {bigint} validUntil - End timestamp
   * @param {bigint} validAfter - Start timestamp  
   * @param {string} paymasterAddress - Paymaster contract address
   * @param {bigint} chainId - Chain ID
   * @returns {string} The keccak256 hash
   */
  export function getHash(userOp, validUntil, validAfter, paymasterAddress, chainId) {
    try {
      console.log('🔐 Computing Fastlane hash with params:', {
        sender: userOp.sender,
        nonce: userOp.nonce?.toString(),
        hasInitCode: !!userOp.initCode,
        hasCallData: !!userOp.callData,
        gasFees: userOp.gasFees?.toString(),
        chainId: chainId.toString(),
        paymasterAddress,
        validUntil: validUntil.toString(),
        validAfter: validAfter.toString()
      });
  
      // ✅ CRITICAL: Match exact ABI from official Fastlane demo
      const hash = keccak256(
        encodeAbiParameters(
          parseAbiParameters('address, uint256, bytes32, bytes32, bytes32, uint256, address, uint48, uint48'),
          [
            userOp.sender,
            userOp.nonce,
            keccak256(userOp.initCode || '0x'),
            keccak256(userOp.callData),
            userOp.gasFees,
            chainId,
            paymasterAddress,
            Number(validUntil),
            Number(validAfter)
          ]
        )
      );
  
      console.log('✅ Fastlane hash computed:', hash);
      return hash;
  
    } catch (error) {
      console.error('❌ Failed to compute Fastlane hash:', error);
      throw new Error(`Hash computation failed: ${error.message}`);
    }
  }
  
  /**
   * Fetch signature from sponsor wallet for a user operation
   * This is the backend service function from official Fastlane demo
   * @param {object} userOp - The packed user operation
   * @param {bigint} validUntil - End timestamp
   * @param {bigint} validAfter - Start timestamp
   * @param {string} paymasterAddress - Paymaster contract address
   * @param {bigint} chainId - Chain ID
   * @returns {Promise<string>} The sponsor's signature
   */
  export async function fetchSignature(userOp, validUntil, validAfter, paymasterAddress, chainId) {
    try {
      // ✅ Get sponsor private key from env
      const sponsorPrivateKey = import.meta.env.VITE_SPONSOR_PRIVATE_KEY;
      
      if (!sponsorPrivateKey) {
        throw new Error('VITE_SPONSOR_PRIVATE_KEY not found in environment variables');
      }
  
      if (!sponsorPrivateKey.startsWith('0x')) {
        throw new Error('VITE_SPONSOR_PRIVATE_KEY must start with 0x');
      }
  
      console.log('🔑 Creating sponsor account from private key...');
      
      // Create sponsor account from private key
      const sponsorAccount = privateKeyToAccount(sponsorPrivateKey);
      
      console.log('✅ Sponsor account created:', sponsorAccount.address);
      
      // Verify sponsor address matches config
      if (sponsorAccount.address.toLowerCase() !== FASTLANE_CONFIG.SPONSOR_EOA.toLowerCase()) {
        console.warn('⚠️ Sponsor address mismatch:', {
          fromPrivateKey: sponsorAccount.address,
          fromConfig: FASTLANE_CONFIG.SPONSOR_EOA
        });
      }
  
      // Create wallet client for signing
      const sponsorWalletClient = createWalletClient({
        account: sponsorAccount,
        chain: monadTestnet,
        transport: http(monadTestnet.rpcUrls.default.http[0])
      });
  
      // ✅ Step 1: Compute the special Fastlane hash
      const hash = getHash(userOp, validUntil, validAfter, paymasterAddress, chainId);
  
      console.log('📝 Signing hash with sponsor wallet...');
  
      // ✅ Step 2: Sign the hash with sponsor wallet
      const sponsorSignature = await sponsorWalletClient.signMessage({
        account: sponsorAccount,
        message: { raw: hash }
      });
  
      console.log('✅ Sponsor signature obtained:', sponsorSignature);
  
      return sponsorSignature;
  
    } catch (error) {
      console.error('❌ Failed to fetch sponsor signature:', error);
      throw new Error(`Signature fetch failed: ${error.message}`);
    }
  }
  
  /**
   * Prepare paymaster context with sponsor signature
   * @param {object} userOp - The prepared user operation
   * @param {string} paymasterAddress - Paymaster contract address
   * @param {bigint} chainId - Chain ID
   * @returns {Promise<object>} Paymaster context with signature
   */
  export async function preparePaymasterContext(userOp, paymasterAddress, chainId) {
    try {
      // ✅ Set validity timestamps
      const currentTime = BigInt(Math.floor(Date.now() / 1000));
      const validUntil = currentTime + BigInt(3600); // 1 hour from now
      const validAfter = BigInt(0); // Valid immediately
  
      console.log('⏰ Validity window:', {
        validAfter: validAfter.toString(),
        validUntil: validUntil.toString(),
        durationMinutes: '60'
      });
  
      // ✅ Get sponsor signature
      const sponsorSignature = await fetchSignature(
        userOp,
        validUntil,
        validAfter,
        paymasterAddress,
        chainId
      );
  
      // ✅ CRITICAL: Construct paymaster context exactly as Fastlane expects
      const paymasterContext = {
        mode: 'sponsor',
        sponsor: FASTLANE_CONFIG.SPONSOR_EOA,
        sponsorSignature: sponsorSignature,
        validUntil: validUntil,
        validAfter: validAfter
      };
  
      console.log('✅ Paymaster context prepared:', {
        mode: paymasterContext.mode,
        sponsor: paymasterContext.sponsor,
        hasSignature: !!paymasterContext.sponsorSignature,
        validUntil: paymasterContext.validUntil.toString(),
        validAfter: paymasterContext.validAfter.toString()
      });
  
      return paymasterContext;
  
    } catch (error) {
      console.error('❌ Failed to prepare paymaster context:', error);
      throw new Error(`Paymaster context preparation failed: ${error.message}`);
    }
  }
  
  export default {
    getHash,
    fetchSignature,
    preparePaymasterContext
  };