'use client';

import { useMIRA } from '@/context/MIRAContext';
import FullScreenSpheres from './FullScreenSpheres';

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
    isCameraActive,
    isScreenActive,
    startCamera,
    stopCamera,
    startScreenCapture,
    stopScreenCapture,
  } = useMIRA();

  // Display mode - always combined now (unified agent, no more debate separation)
  const mode = 'combined';
  
  // Get audio level for sphere animation
  // Use outputAudioLevel when MIRA is speaking, inputAudioLevel when user is speaking
  const effectiveAudioLevel = isSpeaking 
    ? outputAudioLevel  // MIRA's voice should make sphere react
    : (isRecording || isListening) 
      ? audioLevel  // User's voice
      : 0;

  // AI is "thinking" when loading but not yet speaking
  const isThinking = isLoading && !isSpeaking;

  return (
    <div className="relative w-full h-full">
      {/* Full-screen particle spheres */}
      <FullScreenSpheres
        mode={mode}
        speakingAgent={speakingAgent}
        isSpeaking={isSpeaking}
        audioLevel={effectiveAudioLevel}
        isThinking={isThinking}
      />

      {/* Status overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-24 sm:pb-32 pointer-events-none z-10 status-overlay-mobile">
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
        {isListening && !isRecording && !isSpeaking && !isThinking && (
          <p className="text-green-400/50 text-xs sm:text-sm">
            Listening...
          </p>
        )}
      </div>

      {/* Camera preview - HIDDEN but camera still runs for face detection */}
      {/* The camera stream is active for face-api.js processing but not shown to user */}

      {/* Media controls - hidden on mobile and when showControls is false */}
      <div className={`absolute bottom-2 sm:bottom-4 left-2 sm:left-4 gap-1.5 sm:gap-2 z-20 media-controls-mobile safe-area-bottom safe-area-left ui-collapsible ${showControls ? 'sm:flex ui-visible' : 'ui-hidden hidden'}`}>
        <button
          onClick={() => (isCameraActive ? stopCamera() : startCamera())}
          className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm transition-all min-h-[36px] ${
            isCameraActive
              ? 'bg-green-500/20 text-green-400 border border-green-500/50'
              : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
          }`}
        >
          {isCameraActive ? '📹 On' : '📹 Off'}
        </button>
        <button
          onClick={() => (isScreenActive ? stopScreenCapture() : startScreenCapture())}
          className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm transition-all min-h-[36px] ${
            isScreenActive
              ? 'bg-green-500/20 text-green-400 border border-green-500/50'
              : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
          }`}
        >
          {isScreenActive ? '🖥️ On' : '🖥️ Off'}
        </button>
      </div>
    </div>
  );
}
