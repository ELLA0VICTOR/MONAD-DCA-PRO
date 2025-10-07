import { privateKeyToAccount } from "viem/accounts";
import { signMessage } from "viem/accounts";

// ===== ENCRYPTION CONSTANTS =====

const ENCRYPTION_CONFIG = {
  algorithm: 'AES-GCM',
  keyLength: 256,
  ivLength: 12,
  tagLength: 128,
  iterations: 100000,
  salt: 'monad-dca-pro-salt-v1',
  keyUsages: ['encrypt', 'decrypt']
};

const SUPPORTED_DATA_TYPES = {
  DELEGATION_SIGNATURE: 'delegation_signature',
  USER_PREFERENCES: 'user_preferences',
  STRATEGY_CONFIG: 'strategy_config'
};

// ===== UTILITY FUNCTIONS =====

const stringToArrayBuffer = (str) => {
  return new TextEncoder().encode(str);
};

const arrayBufferToString = (buffer) => {
  return new TextDecoder().decode(buffer);
};

const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToArrayBuffer = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

const generateRandomBytes = (length) => {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return array.buffer;
};

// ===== KEY DERIVATION =====

/**
 * Derive encryption key from password using PBKDF2
 */
export const deriveKeyFromPassword = async (password, salt = ENCRYPTION_CONFIG.salt) => {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  
  try {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      stringToArrayBuffer(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: stringToArrayBuffer(salt),
        iterations: ENCRYPTION_CONFIG.iterations,
        hash: 'SHA-256'
      },
      keyMaterial,
      {
        name: ENCRYPTION_CONFIG.algorithm,
        length: ENCRYPTION_CONFIG.keyLength
      },
      false,
      ENCRYPTION_CONFIG.keyUsages
    );
    
    return key;
    
  } catch (error) {
    throw new Error(`Key derivation failed: ${error.message}`);
  }
};

/**
 * Generate random encryption key
 */
export const generateRandomKey = async () => {
  try {
    const key = await crypto.subtle.generateKey(
      {
        name: ENCRYPTION_CONFIG.algorithm,
        length: ENCRYPTION_CONFIG.keyLength
      },
      false,
      ENCRYPTION_CONFIG.keyUsages
    );
    
    return key;
    
  } catch (error) {
    throw new Error(`Random key generation failed: ${error.message}`);
  }
};

// ===== ENCRYPTION/DECRYPTION =====

/**
 * Encrypt data using AES-GCM
 */
export const encryptData = async (data, key, dataType = SUPPORTED_DATA_TYPES.USER_PREFERENCES) => {
  if (!data) {
    throw new Error('Data to encrypt is required');
  }
  
  if (!key || key.constructor.name !== 'CryptoKey') {
    throw new Error('Valid CryptoKey is required');
  }
  
  if (!Object.values(SUPPORTED_DATA_TYPES).includes(dataType)) {
    throw new Error(`Unsupported data type: ${dataType}`);
  }
  
  try {
    const dataString = typeof data === 'string' 
      ? data
      : JSON.stringify(data, (key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        );
    const dataBuffer = stringToArrayBuffer(dataString);
    
    const iv = generateRandomBytes(ENCRYPTION_CONFIG.ivLength);
    
    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: ENCRYPTION_CONFIG.algorithm,
        iv: iv
      },
      key,
      dataBuffer
    );
    
    return {
      data: arrayBufferToBase64(encryptedBuffer),
      iv: arrayBufferToBase64(iv),
      dataType,
      algorithm: ENCRYPTION_CONFIG.algorithm,
      timestamp: Date.now(),
      version: '1.0'
    };
    
  } catch (error) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
};

/**
 * Decrypt data using AES-GCM
 */
export const decryptData = async (encryptedData, key) => {
  if (!encryptedData || typeof encryptedData !== 'object') {
    throw new Error('Valid encrypted data object is required');
  }
  
  if (!key || key.constructor.name !== 'CryptoKey') {
    throw new Error('Valid CryptoKey is required');
  }
  
  if (!encryptedData.data || !encryptedData.iv) {
    throw new Error('Invalid encrypted data structure');
  }
  
  try {
    const encryptedBuffer = base64ToArrayBuffer(encryptedData.data);
    const iv = base64ToArrayBuffer(encryptedData.iv);
    
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: ENCRYPTION_CONFIG.algorithm,
        iv: iv
      },
      key,
      encryptedBuffer
    );
    
    const decryptedString = arrayBufferToString(decryptedBuffer);
    
    if (decryptedString.startsWith('{') || decryptedString.startsWith('[')) {
      try {
        return JSON.parse(decryptedString, (key, value) => {
          if (typeof value === 'string' && /^\d+$/.test(value)) {
            try {
              return BigInt(value);
            } catch {
              return value;
            }
          }
          return value;   
        });
      } catch {
        return decryptedString;
      }
    }
    
    return decryptedString;
    
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
};

// ===== SECURE STORAGE HELPERS =====

/**
 * Securely store encrypted data in memory
 */
class SecureMemoryStorage {
  constructor() {
    this.storage = new Map();
    this.expiration = new Map();
  }
  
  store(key, encryptedData, ttlMs = 3600000) {
    if (!key || !encryptedData) {
      throw new Error('Key and encrypted data are required');
    }
    
    const expirationTime = Date.now() + ttlMs;
    this.storage.set(key, encryptedData);
    this.expiration.set(key, expirationTime);
    
    setTimeout(() => {
      this.remove(key);
    }, ttlMs);
  }
  
  retrieve(key) {
    if (!this.storage.has(key)) {
      return null;
    }
    
    const expirationTime = this.expiration.get(key);
    if (Date.now() > expirationTime) {
      this.remove(key);
      return null;
    }
    
    return this.storage.get(key);
  }
  
  remove(key) {
    this.storage.delete(key);
    this.expiration.delete(key);
  }
  
  clear() {
    this.storage.clear();
    this.expiration.clear();
  }
  
  getKeys() {
    const now = Date.now();
    const validKeys = [];
    
    for (const [key, expirationTime] of this.expiration.entries()) {
      if (now <= expirationTime) {
        validKeys.push(key);
      } else {
        this.remove(key);
      }
    }
    
    return validKeys;
  }
}

export const secureStorage = new SecureMemoryStorage();

// ===== HIGH-LEVEL ENCRYPTION FUNCTIONS =====

/**
 * Encrypt and store sensitive data
 */
export const encryptAndStore = async (storageKey, data, password, dataType, ttlMs = 3600000) => {
  try {
    const key = await deriveKeyFromPassword(password);
    const encryptedData = await encryptData(data, key, dataType);
    secureStorage.store(storageKey, encryptedData, ttlMs);
    return true;
  } catch (error) {
    console.error('Encrypt and store failed:', error);
    return false;
  }
};

/**
 * Retrieve and decrypt stored data
 */
export const retrieveAndDecrypt = async (storageKey, password) => {
  try {
    const encryptedData = secureStorage.retrieve(storageKey);
    if (!encryptedData) {
      return null;
    }
    
    const key = await deriveKeyFromPassword(password);
    const decryptedData = await decryptData(encryptedData, key);
    
    return decryptedData;
    
  } catch (error) {
    console.error('Retrieve and decrypt failed:', error);
    return null;
  }
};

// ===== SIGNATURE VERIFICATION (FOR DELEGATIONS) =====

/**
 * Create encrypted signature for delegation
 */
export const createEncryptedSignature = async (message, privateKey, password) => {
  if (!message || !privateKey || !password) {
    throw new Error('Message, private key, and password are required');
  }
  
  try {
    const account = privateKeyToAccount(privateKey);
    const signature = await signMessage({
      account,
      message
    });
    
    const signatureData = {
      message,
      timestamp: Date.now(),
      signer: account.address,
      signature
    };
    
    const key = await deriveKeyFromPassword(password);
    const encryptedSignature = await encryptData(
      signatureData, 
      key, 
      SUPPORTED_DATA_TYPES.DELEGATION_SIGNATURE
    );
    
    return encryptedSignature;
    
  } catch (error) {
    throw new Error(`Encrypted signature creation failed: ${error.message}`);
  }
};

// ===== EXPORTS =====
export default {
  deriveKeyFromPassword,
  generateRandomKey,
  encryptData,
  decryptData,
  secureStorage,
  encryptAndStore,
  retrieveAndDecrypt,
  createEncryptedSignature,
  SUPPORTED_DATA_TYPES
};