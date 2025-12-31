'use client';

import { useState } from 'react';
import { useMIRA } from '@/context/MIRAContext';

export default function InputBar() {
  const [text, setText] = useState('');
  const {
    sendMessage,
    isLoading,
    isRecording,
    isListening,
    isProcessing,
    audioLevel,
    startRecording,
    stopRecording,
    isSpeaking,
  } = useMIRA();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim() && !isLoading) {
      await sendMessage(text);
      setText('');
    }
  };

  const handleMicClick = () => {
    if (isListening) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="p-4 border-t border-white/10">
      <form onSubmit={handleSubmit} className="flex items-center gap-3">
        {/* Mic button */}
        <button
          type="button"
          onClick={handleMicClick}
          disabled={isSpeaking || isProcessing}
          className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all ${
            isRecording
              ? 'bg-red-500 animate-pulse'
              : isListening
              ? 'bg-green-500'
              : isSpeaking
              ? 'bg-yellow-500/50 cursor-not-allowed'
              : 'bg-white/10 hover:bg-white/20'
          }`}
        >
          {isProcessing ? (
            <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg
              className="w-6 h-6"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.85-7-7.93h2c0 2.76 2.24 5 5 5s5-2.24 5-5h2c0 4.08-3.06 7.44-7 7.93V19h4v2H8v-2h4v-3.07z" />
            </svg>
          )}
          
          {/* Audio level indicator */}
          {(isRecording || isListening) && (
            <div
              className="absolute inset-0 rounded-full border-2 border-green-400"
              style={{
                transform: `scale(${1 + audioLevel * 0.5})`,
                opacity: 0.5 + audioLevel * 0.5,
              }}
            />
          )}
        </button>

        {/* Text input */}
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            isRecording
              ? 'Capturing voice...'
              : isListening
              ? 'Listening for speech...'
              : isSpeaking
              ? 'AI is speaking...'
              : 'Type a message or click mic to speak...'
          }
          disabled={isRecording || isLoading}
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30 disabled:opacity-50"
        />

        {/* Send button */}
        <button
          type="submit"
          disabled={!text.trim() || isLoading || isRecording}
          className="w-12 h-12 rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-30"
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>

      {/* Status indicators */}
      <div className="flex items-center justify-center gap-4 mt-2 text-xs text-white/40">
        {isListening && !isRecording && (
          <span className="flex items-center gap-1 text-green-400">
            <span className="w-2 h-2 bg-green-400 rounded-full" />
            Listening
          </span>
        )}
        {isRecording && (
          <span className="flex items-center gap-1 text-red-400">
            <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
            Recording
          </span>
        )}
        {isSpeaking && (
          <span className="flex items-center gap-1 text-yellow-400">
            <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
            AI Speaking
          </span>
        )}
        {isLoading && (
          <span className="flex items-center gap-1 text-blue-400">
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
            Processing
          </span>
        )}
      </div>
    </div>
  );
}
