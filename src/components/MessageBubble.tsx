'use client';

import { useMIRA } from '@/context/MIRAContext';

interface MessageBubbleProps {
  role: 'user' | 'mira' | 'system';
  content: string;
  emotion?: string;
  timestamp: Date;
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
        <p className="text-white/90 text-sm leading-relaxed whitespace-pre-wrap">
          {content}
        </p>
        <div className="text-right mt-1">
          <span className="text-xs text-white/30">
            {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
}
