// src/services/ai/monoAIService.js

import { swapExecutor } from '../dca/swapExecutor';
import { dcaEngine } from '../dca/dcaEngine';
import { SUPPORTED_TOKENS, SWAP_INTERVALS, DCA_CONFIG, ERROR_CODES } from '../../utils/constants';
import { validateTokenAmount, validateAddress } from '../../utils/validators';
import { formatTokenAmount } from '../../utils/formatters';

/**
 * Mono AI Service
 * Conversational AI assistant for swap and DCA management
 * Interprets natural language commands and provides real-time feedback
 */

class MonoAIService {
  constructor() {
    this.initialized = false;
    this.conversationHistory = [];
    this.activeContext = null;
    this.statusCallbacks = new Map();
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Initialize dependencies
      await swapExecutor.initialize();
      await dcaEngine.initialize();

      this.initialized = true;
      console.log('[MonoAI] Service initialized successfully');
    } catch (error) {
      console.error('[MonoAI] Initialization failed:', error);
      throw new Error('Failed to initialize Mono AI service');
    }
  }

  /**
   * Process user message and return AI response
   */
  async processMessage(message, context = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Parse user intent
      const intent = this.parseIntent(message);
      
      // Store conversation
      this.conversationHistory.push({
        role: 'user',
        content: message,
        timestamp: Date.now(),
        context
      });

      // Generate response based on intent
      const response = await this.generateResponse(intent, context);

      // Store AI response
      this.conversationHistory.push({
        role: 'assistant',
        content: response.message,
        timestamp: Date.now(),
        data: response.data
      });

      return response;
    } catch (error) {
      console.error('[MonoAI] Error processing message:', error);
      return {
        message: "I encountered an error processing your request. Please try again or rephrase your command.",
        type: 'error',
        error: error.message
      };
    }
  }

  /**
   * Parse user intent from natural language
   */
  parseIntent(message) {
    const lowerMessage = message.toLowerCase().trim();

    // Intent patterns
    const patterns = {
      swap: /swap|exchange|trade|convert/i,
      dca: /dca|dollar cost averag|recurring|automat|schedul/i,
      quote: /quote|price|rate|how much/i,
      status: /status|progress|check|show/i,
      pause: /pause|stop|halt/i,
      resume: /resume|restart|continue/i,
      cancel: /cancel|end|terminate/i,
      help: /help|what can|commands/i,
      list: /list|show all|display/i
    };

    // Extract token symbols
    const tokens = this.extractTokens(message);
    const amount = this.extractAmount(message);
    const interval = this.extractInterval(message);

    // Determine primary intent
    let primaryIntent = 'unknown';
    for (const [intent, pattern] of Object.entries(patterns)) {
      if (pattern.test(lowerMessage)) {
        primaryIntent = intent;
        break;
      }
    }

    return {
      type: primaryIntent,
      tokens,
      amount,
      interval,
      rawMessage: message
    };
  }

  /**
   * Extract token symbols from message
   */
  extractTokens(message) {
    const tokens = [];
    const upperMessage = message.toUpperCase();

    for (const token of SUPPORTED_TOKENS) {
      if (upperMessage.includes(token.symbol)) {
        tokens.push(token.symbol);
      }
    }

    return tokens;
  }

  /**
   * Extract amount from message
   */
  extractAmount(message) {
    // Match patterns like "10 MON", "0.5 ETH", "100"
    const amountPattern = /(\d+\.?\d*)\s*(?:MON|USDC|WBTC|WETH|USDT|WSOL)?/i;
    const match = message.match(amountPattern);
    return match ? parseFloat(match[1]) : null;
  }

  /**
   * Extract interval from message
   */
  extractInterval(message) {
    const lowerMessage = message.toLowerCase();

    if (/per minute|every minute|minutely/i.test(lowerMessage)) {
      return 'PER_MINUTE';
    }
    if (/hourly|every hour|per hour/i.test(lowerMessage)) {
      return 'HOURLY';
    }
    if (/daily|every day|per day/i.test(lowerMessage)) {
      return 'DAILY';
    }
    if (/weekly|every week|per week/i.test(lowerMessage)) {
      return 'WEEKLY';
    }
    if (/monthly|every month|per month/i.test(lowerMessage)) {
      return 'MONTHLY';
    }

    return null;
  }

  /**
   * Generate response based on intent
   */
  async generateResponse(intent, context) {
    switch (intent.type) {
      case 'swap':
        return await this.handleSwapIntent(intent, context);
      
      case 'dca':
        return await this.handleDCAIntent(intent, context);
      
      case 'quote':
        return await this.handleQuoteIntent(intent, context);
      
      case 'status':
        return await this.handleStatusIntent(intent, context);
      
      case 'pause':
        return await this.handlePauseIntent(intent, context);
      
      case 'resume':
        return await this.handleResumeIntent(intent, context);
      
      case 'cancel':
        return await this.handleCancelIntent(intent, context);
      
      case 'list':
        return await this.handleListIntent(intent, context);
      
      case 'help':
        return this.handleHelpIntent();
      
      default:
        return this.handleUnknownIntent(intent);
    }
  }

  /**
   * Handle immediate swap intent
   */
  async handleSwapIntent(intent, context) {
    const { tokens, amount } = intent;
    const { smartAccount } = context;

    // Validate input
    if (!tokens || tokens.length < 2) {
      return {
        message: "I need to know which tokens to swap. For example: 'Swap 10 MON to USDC'",
        type: 'clarification',
        needsInput: ['fromToken', 'toToken']
      };
    }

    if (!amount) {
      return {
        message: "How much would you like to swap? For example: 'Swap 10 MON to USDC'",
        type: 'clarification',
        needsInput: ['amount']
      };
    }

    if (!smartAccount?.address) {
      return {
        message: "Please select a smart account first before swapping.",
        type: 'error'
      };
    }

    const [fromToken, toToken] = tokens;

    try {
      // Get quote first
      const quote = await swapExecutor.getSwapQuote(
        fromToken,
        toToken,
        amount.toString()
      );

      if (!quote.success) {
        return {
          message: `I couldn't get a quote for this swap. ${quote.error || 'Please try again.'}`,
          type: 'error'
        };
      }

      return {
        message: `I can swap ${amount} ${fromToken} for approximately ${formatTokenAmount(quote.amountOut, 6)} ${toToken}. Would you like me to execute this swap?`,
        type: 'quote',
        action: 'swap',
        data: {
          fromToken,
          toToken,
          amount,
          quote,
          requiresConfirmation: true
        }
      };

    } catch (error) {
      return {
        message: `I encountered an error: ${error.message}. Please try again.`,
        type: 'error'
      };
    }
  }

  /**
   * Handle DCA strategy creation intent
   */
  async handleDCAIntent(intent, context) {
    const { tokens, amount, interval } = intent;
    const { smartAccount } = context;

    if (!tokens || tokens.length < 2) {
      return {
        message: "Which tokens would you like to DCA? For example: 'Start a daily DCA from MON to USDC'",
        type: 'clarification',
        needsInput: ['fromToken', 'toToken']
      };
    }

    if (!amount) {
      return {
        message: "How much do you want to invest each time? For example: 'DCA 10 MON to USDC daily'",
        type: 'clarification',
        needsInput: ['amount']
      };
    }

    if (!interval) {
      return {
        message: "How often should I execute this DCA? (per minute, hourly, daily, weekly, or monthly)",
        type: 'clarification',
        needsInput: ['interval']
      };
    }

    if (!smartAccount?.address) {
      return {
        message: "Please select a smart account first.",
        type: 'error'
      };
    }

    const [fromToken, toToken] = tokens;
    const intervalConfig = SWAP_INTERVALS[interval];

    return {
      message: `I'll create a ${intervalConfig.label.toLowerCase()} DCA strategy to swap ${amount} ${fromToken} to ${toToken}. The strategy will execute automatically based on your schedule. Shall I proceed?`,
      type: 'dca_setup',
      action: 'create_dca',
      data: {
        fromToken,
        toToken,
        amount,
        interval,
        requiresConfirmation: true
      }
    };
  }

  /**
   * Handle quote request
   */
  async handleQuoteIntent(intent, context) {
    const { tokens, amount } = intent;

    if (!tokens || tokens.length < 2) {
      return {
        message: "Which tokens would you like a quote for? Example: 'What's the price of MON to USDC?'",
        type: 'clarification'
      };
    }

    const [fromToken, toToken] = tokens;
    const quoteAmount = amount || 1;

    try {
      const quote = await swapExecutor.getSwapQuote(
        fromToken,
        toToken,
        quoteAmount.toString()
      );

      if (!quote.success) {
        return {
          message: `I couldn't get a price quote at the moment. ${quote.error || ''}`,
          type: 'error'
        };
      }

      const rate = parseFloat(quote.amountOut) / quoteAmount;

      return {
        message: `Current rate: 1 ${fromToken} = ${rate.toFixed(6)} ${toToken}. For ${quoteAmount} ${fromToken}, you would receive approximately ${formatTokenAmount(quote.amountOut, 6)} ${toToken}.`,
        type: 'info',
        data: { quote, rate }
      };

    } catch (error) {
      return {
        message: `Error fetching quote: ${error.message}`,
        type: 'error'
      };
    }
  }

  /**
   * Handle status check intent
   */
  async handleStatusIntent(intent, context) {
    try {
      const stats = dcaEngine.getEngineStats();
      const activeSwaps = swapExecutor.getActiveSwaps();

      let message = `📊 **Status Update**\n\n`;
      message += `• Active DCA Strategies: ${stats.activeStrategies}\n`;
      message += `• Paused Strategies: ${stats.pausedStrategies}\n`;
      message += `• Total Invested: ${formatTokenAmount(stats.totalInvested.toString(), 18)} MON\n`;
      message += `• Active Swaps: ${activeSwaps.length}\n`;

      return {
        message,
        type: 'status',
        data: { stats, activeSwaps }
      };

    } catch (error) {
      return {
        message: "I couldn't retrieve the status at this time.",
        type: 'error'
      };
    }
  }

  /**
   * Handle pause intent
   */
  async handlePauseIntent(intent, context) {
    return {
      message: "Which strategy would you like to pause? Please select it from the Tasks tab or provide the strategy ID.",
      type: 'clarification',
      needsInput: ['strategyId']
    };
  }

  /**
   * Handle resume intent
   */
  async handleResumeIntent(intent, context) {
    return {
      message: "Which strategy would you like to resume? Please select it from the Tasks tab or provide the strategy ID.",
      type: 'clarification',
      needsInput: ['strategyId']
    };
  }

  /**
   * Handle cancel intent
   */
  async handleCancelIntent(intent, context) {
    return {
      message: "Which strategy would you like to cancel? Please note that this action cannot be undone.",
      type: 'clarification',
      needsInput: ['strategyId']
    };
  }

  /**
   * Handle list strategies intent
   */
  async handleListIntent(intent, context) {
    try {
      const strategies = dcaEngine.listStrategies();

      if (strategies.length === 0) {
        return {
          message: "You don't have any DCA strategies yet. Would you like me to help you create one?",
          type: 'info'
        };
      }

      let message = `You have ${strategies.length} DCA ${strategies.length === 1 ? 'strategy' : 'strategies'}:\n\n`;
      
      strategies.slice(0, 5).forEach((strategy, index) => {
        message += `${index + 1}. ${strategy.config.fromToken} → ${strategy.config.toToken} (${strategy.status})\n`;
      });

      if (strategies.length > 5) {
        message += `\n...and ${strategies.length - 5} more. Check the Tasks tab for full details.`;
      }

      return {
        message,
        type: 'info',
        data: { strategies }
      };

    } catch (error) {
      return {
        message: "I couldn't retrieve your strategies at this time.",
        type: 'error'
      };
    }
  }

  /**
   * Handle help intent
   */
  handleHelpIntent() {
    const helpMessage = `I can help you with:\n\n` +
      `💱 **Swaps** - "Swap 10 MON to USDC"\n` +
      `📅 **DCA Strategies** - "Start a daily DCA from MON to USDC"\n` +
      `💰 **Price Quotes** - "What's the price of MON?"\n` +
      `📊 **Status** - "Show my DCA status"\n` +
      `📋 **List** - "List my strategies"\n\n` +
      `Just tell me what you'd like to do in plain English!`;

    return {
      message: helpMessage,
      type: 'help'
    };
  }

  /**
   * Handle unknown intent
   */
  handleUnknownIntent(intent) {
    return {
      message: "I'm not sure what you'd like me to do. Try asking me to 'swap tokens', 'create a DCA strategy', or type 'help' to see what I can do.",
      type: 'unknown',
      suggestion: 'help'
    };
  }

  /**
   * Execute confirmed action
   */
  async executeAction(action, data, context) {
    const { smartAccount } = context;

    try {
      switch (action) {
        case 'swap':
          return await this.executeSwap(data, smartAccount);
        
        case 'create_dca':
          return await this.createDCAStrategy(data, smartAccount);
        
        default:
          throw new Error('Unknown action');
      }
    } catch (error) {
      console.error('[MonoAI] Action execution failed:', error);
      throw error;
    }
  }

  /**
   * Execute immediate swap
   */
  async executeSwap(data, smartAccount) {
    const { fromToken, toToken, amount } = data;

    try {
      const result = await swapExecutor.executeSwap(
        smartAccount.address,
        fromToken,
        toToken,
        amount.toString(),
        { slippage: DCA_CONFIG.defaultSlippage }
      );

      if (!result.success) {
        throw new Error(result.error || 'Swap execution failed');
      }

      return {
        success: true,
        message: `✅ Swap successful! Exchanged ${amount} ${fromToken} for ${formatTokenAmount(result.amountOut, 6)} ${toToken}.`,
        data: result
      };

    } catch (error) {
      return {
        success: false,
        message: `❌ Swap failed: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Create DCA strategy
   */
  async createDCAStrategy(data, smartAccount) {
    const { fromToken, toToken, amount, interval } = data;

    try {
      const config = {
        smartAccountAddress: smartAccount.address,
        fromToken,
        toToken,
        amountPerSwap: amount.toString(),
        interval,
        slippage: DCA_CONFIG.defaultSlippage
      };

      const strategy = await dcaEngine.createStrategy(config, {
        encrypted: true,
        autoStart: true
      });

      return {
        success: true,
        message: `✅ DCA strategy created! Your ${SWAP_INTERVALS[interval].label.toLowerCase()} swaps from ${fromToken} to ${toToken} will start automatically.`,
        data: strategy
      };

    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to create DCA strategy: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Register callback for status updates
   */
  onStatusUpdate(eventType, callback) {
    if (!this.statusCallbacks.has(eventType)) {
      this.statusCallbacks.set(eventType, []);
    }
    this.statusCallbacks.get(eventType).push(callback);
  }

  /**
   * Emit status update
   */
  emitStatusUpdate(eventType, data) {
    const callbacks = this.statusCallbacks.get(eventType) || [];
    callbacks.forEach(callback => callback(data));
  }

  /**
   * Get conversation history
   */
  getConversationHistory(limit = 10) {
    return this.conversationHistory.slice(-limit);
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Get service health
   */
  getHealth() {
    return {
      initialized: this.initialized,
      conversationCount: this.conversationHistory.length,
      dependencies: {
        swapExecutor: swapExecutor.initialized,
        dcaEngine: dcaEngine.initialized
      }
    };
  }
}

// Export singleton instance
export const monoAIService = new MonoAIService();

// Export utility functions
export const processAIMessage = (message, context) => monoAIService.processMessage(message, context);
export const executeAIAction = (action, data, context) => monoAIService.executeAction(action, data, context);
export const getAIHistory = (limit) => monoAIService.getConversationHistory(limit);
export const clearAIHistory = () => monoAIService.clearHistory();

export default monoAIService;