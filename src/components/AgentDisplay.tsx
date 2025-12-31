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
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-32 pointer-events-none z-10">
        {isSpeaking && speakingAgent && (
          <p className="text-white/70 text-lg mb-4">
            {speakingAgent === 'mira'
              ? 'MIRA is speaking...'
              : speakingAgent === 'mi'
              ? 'MI is speaking...'
              : 'RA is speaking...'}
          </p>
        )}
        {isRecording && !isSpeaking && (
          <p className="text-red-400/80 text-sm animate-pulse">
            Recording speech...
          </p>
        )}
        {isListening && !isRecording && !isSpeaking && (
          <p className="text-green-400/50 text-sm">
            Listening...
          </p>
        )}
      </div>

      {/* Camera preview */}
      {isCameraActive && (
        <div className="absolute bottom-24 right-4 w-48 h-36 rounded-lg overflow-hidden border border-white/20 bg-black z-20">
          <CameraPreview />
          <div className="absolute top-2 left-2 text-xs text-white/70 bg-black/50 px-2 py-1 rounded">
            Camera
          </div>
        </div>
      )}

      {/* Media controls */}
      <div className="absolute bottom-4 left-4 flex gap-2 z-20">
        <button
          onClick={() => (isCameraActive ? stopCamera() : startCamera())}
          className={`px-4 py-2 rounded-lg text-sm transition-all ${
            isCameraActive
              ? 'bg-green-500/20 text-green-400 border border-green-500/50'
              : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
          }`}
        >
          {isCameraActive ? '📹 On' : '📹 Off'}
        </button>
        <button
          onClick={() => (isScreenActive ? stopScreenCapture() : startScreenCapture())}
          className={`px-4 py-2 rounded-lg text-sm transition-all ${
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
