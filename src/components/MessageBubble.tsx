'use client';

import { useRef, useEffect, useState } from 'react';
import { useMIRA } from '@/context/MIRAContext';

interface MessageBubbleProps {
  role: 'user' | 'mira' | 'system';
  content: string;
  emotion?: string;
  timestamp: Date;
}

// Parse content to separate code blocks from regular text
function parseContent(content: string): Array<{ type: 'text' | 'code'; content: string; language?: string }> {
  const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) {
        parts.push({ type: 'text', content: textBefore });
      }
    }
    
    // Add code block
    parts.push({
      type: 'code',
      content: match[2].trim(),
      language: match[1] || 'plaintext',
    });
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < content.length) {
    const remainingText = content.slice(lastIndex).trim();
    if (remainingText) {
      parts.push({ type: 'text', content: remainingText });
    }
  }
  
  // If no code blocks found, return original content as text
  if (parts.length === 0) {
    parts.push({ type: 'text', content });
  }
  
  return parts;
}

// Code block component with copy button and scroll
function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);
  
  // Scroll code block into view when it updates
  useEffect(() => {
    if (codeRef.current) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [code]);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  return (
    <div className="relative my-2 rounded-lg overflow-hidden bg-black/40 border border-white/10">
      {/* Header with language and copy button */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/10">
        <span className="text-xs text-white/50 font-mono">{language}</span>
        <button
          onClick={handleCopy}
          className="text-xs px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      {/* Code content with scroll */}
      <pre
        ref={codeRef}
        className="p-3 overflow-x-auto overflow-y-auto max-h-96 text-sm font-mono text-green-400/90 whitespace-pre"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function MessageBubble({
  role,
  content,
  emotion,
  timestamp,
}: MessageBubbleProps) {
  const getAgentColor = () => {
    switch (role) {
      case 'mira':
        return 'bg-white/10 border-white/30';
      case 'user':
        return 'bg-white/10 border-white/20';
      default:
        return 'bg-gray-500/20 border-gray-500/50';
    }
  };

  const getAgentName = () => {
    switch (role) {
      case 'mira':
        return 'MIRA';
      case 'user':
        return 'You';
      default:
        return 'System';
    }
  };

  const getAgentIcon = () => {
    switch (role) {
      case 'mira':
        return '✨';
      case 'user':
        return '👤';
      default:
        return 'ℹ️';
    }
  };

  return (
    <div
      className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 border ${getAgentColor()} ${
          role === 'user' ? 'rounded-br-none' : 'rounded-bl-none'
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm">{getAgentIcon()}</span>
          <span className="text-xs font-semibold text-white/70">
            {getAgentName()}
          </span>
          {emotion && (
            <span className="text-xs text-white/50 italic">• {emotion}</span>
          )}
        </div>
        
        {/* Render content with code block support */}
        <div className="text-white/90 text-sm leading-relaxed">
          {parseContent(content).map((part, index) => (
            part.type === 'code' ? (
              <CodeBlock key={index} code={part.content} language={part.language || 'plaintext'} />
            ) : (
              <p key={index} className="whitespace-pre-wrap">{part.content}</p>
            )
          ))}
        </div>
        
        <div className="text-right mt-1">
          <span className="text-xs text-white/30">
            {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
}
