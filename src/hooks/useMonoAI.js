// src/hooks/useMonoAI.js

import { useState, useEffect, useCallback, useRef } from 'react';
import { monoAIService } from '../services/ai/monoAIService';
import toast from 'react-hot-toast';

/**
 * Custom hook for managing Mono AI conversational state
 * Handles message sending, receiving, action execution, and status updates
 */

export const useMonoAI = (context = {}) => {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const initRef = useRef(false);

  // Initialize Mono AI service
  useEffect(() => {
    const initializeService = async () => {
      if (initRef.current) return;
      initRef.current = true;

      try {
        await monoAIService.initialize();
        setIsInitialized(true);

        // Add welcome message
        setMessages([{
          id: Date.now(),
          role: 'assistant',
          content: "👋 Hi! I'm Mono AI, your DCA assistant. I can help you swap tokens, create automated DCA strategies, check prices, and manage your positions. What would you like to do?",
          timestamp: Date.now(),
          type: 'greeting'
        }]);

      } catch (err) {
        console.error('[useMonoAI] Initialization failed:', err);
        setError('Failed to initialize AI assistant');
        toast.error('Failed to initialize AI assistant');
      }
    };

    initializeService();
  }, []);

  /**
   * Send user message to Mono AI
   */
  const sendMessage = useCallback(async (userMessage) => {
    if (!userMessage.trim()) return;
    if (!isInitialized) {
      toast.error('AI assistant is not ready yet');
      return;
    }

    // Add user message to chat
    const userMessageObj = {
      id: Date.now(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMessageObj]);

    setIsLoading(true);
    setError(null);

    try {
      // Process message through AI service
      const response = await monoAIService.processMessage(userMessage, context);

      // Add AI response to chat
      const aiMessageObj = {
        id: Date.now() + 1,
        role: 'assistant',
        content: response.message,
        timestamp: Date.now(),
        type: response.type,
        data: response.data
      };
      setMessages(prev => [...prev, aiMessageObj]);

      // Handle actions that require confirmation
      if (response.data?.requiresConfirmation) {
        setPendingAction({
          action: response.action,
          data: response.data
        });
      }

    } catch (err) {
      console.error('[useMonoAI] Error sending message:', err);
      setError(err.message);
      
      const errorMessageObj = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `I encountered an error: ${err.message}. Please try again.`,
        timestamp: Date.now(),
        type: 'error'
      };
      setMessages(prev => [...prev, errorMessageObj]);
      
      toast.error('Failed to process message');
    } finally {
      setIsLoading(false);
    }
  }, [isInitialized, context]);

  /**
   * Execute pending action after user confirmation
   */
  const executeAction = useCallback(async () => {
    if (!pendingAction) {
      toast.error('No action to execute');
      return;
    }

    setIsExecuting(true);
    setError(null);

    try {
      // Execute action through AI service
      const result = await monoAIService.executeAction(
        pendingAction.action,
        pendingAction.data,
        context
      );

      // Add result message to chat
      const resultMessageObj = {
        id: Date.now(),
        role: 'assistant',
        content: result.message,
        timestamp: Date.now(),
        type: result.success ? 'success' : 'error',
        data: result.data
      };
      setMessages(prev => [...prev, resultMessageObj]);

      if (result.success) {
        toast.success('Action completed successfully!');
        setPendingAction(null);
      } else {
        toast.error(result.message);
      }

      return result;

    } catch (err) {
      console.error('[useMonoAI] Error executing action:', err);
      setError(err.message);
      
      const errorMessageObj = {
        id: Date.now(),
        role: 'assistant',
        content: `Failed to execute action: ${err.message}`,
        timestamp: Date.now(),
        type: 'error'
      };
      setMessages(prev => [...prev, errorMessageObj]);
      
      toast.error('Action execution failed');
      return { success: false, error: err.message };

    } finally {
      setIsExecuting(false);
    }
  }, [pendingAction, context]);

  /**
   * Cancel pending action
   */
  const cancelAction = useCallback(() => {
    if (!pendingAction) return;

    setPendingAction(null);
    
    const cancelMessageObj = {
      id: Date.now(),
      role: 'assistant',
      content: "Action cancelled. Is there anything else I can help you with?",
      timestamp: Date.now(),
      type: 'info'
    };
    setMessages(prev => [...prev, cancelMessageObj]);
    
    toast('Action cancelled', { icon: 'ℹ️' });
  }, [pendingAction]);

  /**
   * Clear conversation history
   */
  const clearConversation = useCallback(() => {
    setMessages([{
      id: Date.now(),
      role: 'assistant',
      content: "👋 Hi! I'm Mono AI, your DCA assistant. What would you like to do?",
      timestamp: Date.now(),
      type: 'greeting'
    }]);
    setPendingAction(null);
    setError(null);
    monoAIService.clearHistory();
    toast.success('Conversation cleared');
  }, []);

  /**
   * Send quick action command
   */
  const quickAction = useCallback(async (actionType, params = {}) => {
    let message = '';

    switch (actionType) {
      case 'help':
        message = 'help';
        break;
      case 'status':
        message = 'show status';
        break;
      case 'list':
        message = 'list my strategies';
        break;
      case 'quote':
        message = params.fromToken && params.toToken 
          ? `What's the price of ${params.fromToken} to ${params.toToken}?`
          : 'get quote';
        break;
      default:
        return;
    }

    if (message) {
      await sendMessage(message);
    }
  }, [sendMessage]);

  /**
   * Get service health status
   */
  const getHealth = useCallback(() => {
    return monoAIService.getHealth();
  }, []);

  return {
    // State
    messages,
    isLoading,
    isInitialized,
    error,
    pendingAction,
    isExecuting,

    // Actions
    sendMessage,
    executeAction,
    cancelAction,
    clearConversation,
    quickAction,

    // Utility
    getHealth,
    hasMessages: messages.length > 1 // Exclude welcome message
  };
};

export default useMonoAI;