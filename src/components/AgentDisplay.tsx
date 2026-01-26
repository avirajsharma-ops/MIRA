'use client';

import { useMIRA } from '@/context/MIRAContext';
import FaceMorph from './FaceMorph';
import { useEffect, useRef } from 'react';

interface AgentDisplayProps {
  showControls?: boolean;
}

export default function AgentDisplay({ showControls = true }: AgentDisplayProps) {
  const {
    speakingAgent,
    isSpeaking,
    isRecording,
    isListening,
    isLoading,
    audioLevel,
    outputAudioLevel, // MIRA's voice level
    miraState, // MIRA's current state
  } = useMIRA();

  // Debug logging for audio levels
  const debugCounterRef = useRef(0);
  useEffect(() => {
    if (audioLevel > 0.02 || outputAudioLevel > 0.02) {
      debugCounterRef.current++;
      if (debugCounterRef.current % 60 === 0) {
        console.log('[AgentDisplay] Audio levels - User:', audioLevel.toFixed(3), 'MIRA:', outputAudioLevel.toFixed(3));
      }
    }
  }, [audioLevel, outputAudioLevel]);

  // AI is "thinking" when loading but not yet speaking
  const isThinking = isLoading && !isSpeaking;

  return (
    <div className="relative w-full h-full">
      {/* Face Morph Particle Effect - Globe morphs to face when detected */}
      <FaceMorph
        miraAudioLevel={outputAudioLevel}
        userAudioLevel={audioLevel}
        miraState={miraState}
        isSpeaking={isSpeaking}
      />

      {/* Status overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-24 sm:pb-32 pointer-events-none z-10 status-overlay-mobile">
        {miraState === 'resting' && (
          <p className="text-amber-400/60 text-sm sm:text-lg mb-4 px-4 text-center">
            Say &quot;Hey Mira&quot; to wake me up
          </p>
        )}
        {isSpeaking && (
          <p className="text-white/70 text-sm sm:text-lg mb-4 px-4 text-center">
            MIRA is speaking...
          </p>
        )}
        {isThinking && (
          <p className="text-purple-400/80 text-sm sm:text-lg mb-4 px-4 text-center animate-pulse">
            Thinking...
          </p>
        )}
        {isRecording && !isSpeaking && !isThinking && (
          <p className="text-red-400/80 text-xs sm:text-sm animate-pulse">
            Recording speech...
          </p>
        )}
        {isListening && !isRecording && !isSpeaking && !isThinking && miraState !== 'resting' && (
          <p className="text-green-400/50 text-xs sm:text-sm">
            Listening...
          </p>
        )}
      </div>
    </div>
  );
}
