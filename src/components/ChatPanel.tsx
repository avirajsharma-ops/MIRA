'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useMIRA } from '@/context/MIRAContext';
import MessageBubble from './MessageBubble';

export default function ChatPanel() {
  const { messages, isLoading } = useMIRA();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  const lastContentLengthRef = useRef(0);

  // Smart auto-scroll: scroll when new messages arrive or content updates
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
    }
  }, []);

  // Auto-scroll on new messages or content updates
  useEffect(() => {
    const currentMessageCount = messages.length;
    const currentContentLength = messages.reduce((sum, m) => sum + m.content.length, 0);
    
    // Scroll if:
    // 1. New message added
    // 2. Content length increased (streaming/updating response)
    if (currentMessageCount > lastMessageCountRef.current || 
        currentContentLength > lastContentLengthRef.current) {
      
      // Use instant scroll for large content updates (like code blocks)
      const contentDiff = currentContentLength - lastContentLengthRef.current;
      const behavior = contentDiff > 200 ? 'instant' : 'smooth';
      
      scrollToBottom(behavior as ScrollBehavior);
    }
    
    lastMessageCountRef.current = currentMessageCount;
    lastContentLengthRef.current = currentContentLength;
  }, [messages, scrollToBottom]);

  // Also scroll when loading state changes (response complete)
  useEffect(() => {
    if (!isLoading) {
      // Small delay to ensure content is rendered
      setTimeout(() => scrollToBottom('smooth'), 100);
    }
  }, [isLoading, scrollToBottom]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-white/90">Conversation</h2>
        <p className="text-xs text-white/50">
          {messages.length} messages
        </p>
      </div>

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-white/40">
              <p className="text-lg mb-2">No messages yet</p>
              <p className="text-sm">Start talking or type a message</p>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            role={message.role}
            content={message.content}
            emotion={message.emotion}
            timestamp={message.timestamp}
          />
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white/10 rounded-2xl px-4 py-3 rounded-bl-none">
              <div className="flex items-center gap-2">
                <span className="text-sm">🤔</span>
                <span className="text-xs text-white/70">Thinking...</span>
              </div>
              <div className="flex gap-1 mt-2">
                <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
