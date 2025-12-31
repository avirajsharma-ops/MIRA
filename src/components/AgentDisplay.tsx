'use client';

import { useMIRA } from '@/context/MIRAContext';
import FullScreenSpheres from './FullScreenSpheres';
import CameraPreview from './CameraPreview';

export default function AgentDisplay() {
  const {
    speakingAgent,
    isSpeaking,
    isRecording,
    isListening,
    audioLevel,
    isCameraActive,
    isScreenActive,
    startCamera,
    stopCamera,
    startScreenCapture,
    stopScreenCapture,
    isDebating,
  } = useMIRA();

  // Determine display mode - combined by default, separate only during active debate
  // Spheres stay merged normally, only split when MI and RA are actively debating
  const mode = isDebating ? 'separate' : 'combined';
  
  // Get audio level for sphere animation
  const effectiveAudioLevel = isRecording || isSpeaking ? audioLevel : 0;

  return (
    <div className="relative w-full h-full">
      {/* Full-screen particle spheres */}
      <FullScreenSpheres
        mode={mode}
        speakingAgent={speakingAgent}
        isSpeaking={isSpeaking}
        audioLevel={effectiveAudioLevel}
      />

      {/* Status overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-24 sm:pb-32 pointer-events-none z-10 status-overlay-mobile">
        {isSpeaking && speakingAgent && (
          <p className="text-white/70 text-sm sm:text-lg mb-4 px-4 text-center">
            {speakingAgent === 'mira'
              ? 'MIRA is speaking...'
              : speakingAgent === 'mi'
              ? 'MI is speaking...'
              : 'RA is speaking...'}
          </p>
        )}
        {isRecording && !isSpeaking && (
          <p className="text-red-400/80 text-xs sm:text-sm animate-pulse">
            Recording speech...
          </p>
        )}
        {isListening && !isRecording && !isSpeaking && (
          <p className="text-green-400/50 text-xs sm:text-sm">
            Listening...
          </p>
        )}
      </div>

      {/* Camera preview */}
      {isCameraActive && (
        <div className="absolute bottom-20 sm:bottom-24 right-2 sm:right-4 w-28 sm:w-48 h-20 sm:h-36 rounded-lg overflow-hidden border border-white/20 bg-black z-20 camera-preview-mobile">
          <CameraPreview />
          <div className="absolute top-1 sm:top-2 left-1 sm:left-2 text-[10px] sm:text-xs text-white/70 bg-black/50 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded">
            Camera
          </div>
        </div>
      )}

      {/* Media controls */}
      <div className="absolute bottom-2 sm:bottom-4 left-2 sm:left-4 flex gap-1.5 sm:gap-2 z-20 media-controls-mobile safe-area-bottom safe-area-left">
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
