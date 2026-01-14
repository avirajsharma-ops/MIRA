// VoiceEnrollmentModal - UI for enrolling owner voice
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Modal from './Modal';
import { useVoiceIdentification } from '@/hooks/useVoiceIdentification';

interface VoiceEnrollmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  userName?: string;
}

export default function VoiceEnrollmentModal({
  isOpen,
  onClose,
  onComplete,
  userName = 'Owner',
}: VoiceEnrollmentModalProps) {
  const {
    state,
    startOwnerEnrollment,
    addEnrollmentSample,
    completeOwnerEnrollment,
    cancelEnrollment,
  } = useVoiceIdentification();

  const [isRecording, setIsRecording] = useState(false);
  const [recordingStep, setRecordingStep] = useState(0);
  const [ownerName, setOwnerName] = useState(userName);
  const [feedback, setFeedback] = useState<string>('');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const prompts = [
    'Say: "Hey MIRA, how are you today?"',
    'Say: "Tell me about the weather"',
    'Say: "What\'s on my schedule?"',
    'Say: "Can you help me with something?"',
    'Say: "Thank you MIRA, that\'s all"',
  ];

  const cleanup = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    mediaRecorderRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
  }, []);

  useEffect(() => {
    if (isOpen) {
      setRecordingStep(0);
      setFeedback('');
      startOwnerEnrollment();
    } else {
      cleanup();
    }
    return cleanup;
  }, [isOpen, cleanup, startOwnerEnrollment]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        } 
      });
      
      streamRef.current = stream;
      audioContextRef.current = new AudioContext({ sampleRate: 48000 });
      chunksRef.current = [];
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          await processAudioBlob(blob);
        }
        
        // Stop stream tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setFeedback('Recording... speak clearly');
      
      // Auto-stop after 4 seconds
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, 4000);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      setFeedback('Error accessing microphone');
    }
  };

  const processAudioBlob = async (blob: Blob) => {
    try {
      setFeedback('Processing...');
      
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 48000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Get audio data as Float32Array
      const audioData = audioBuffer.getChannelData(0);
      
      // Check if sample has enough content
      const isComplete = await addEnrollmentSample(audioData, audioBuffer.sampleRate);
      
      await audioContext.close();
      
      if (state.enrollmentProgress === 100 || isComplete) {
        setFeedback('✓ All samples collected! Completing enrollment...');
        const success = await completeOwnerEnrollment(ownerName);
        
        if (success) {
          setFeedback('✓ Voice enrolled successfully!');
          setTimeout(() => {
            onComplete();
            onClose();
          }, 1500);
        } else {
          setFeedback('Error saving voice profile. Please try again.');
        }
      } else {
        setRecordingStep(prev => prev + 1);
        setFeedback(`✓ Sample ${recordingStep + 1} recorded! ${5 - recordingStep - 1} more to go.`);
      }
    } catch (error) {
      console.error('Error processing audio:', error);
      setFeedback('Error processing audio. Try again.');
    }
  };

  const handleCancel = () => {
    cleanup();
    cancelEnrollment();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title="Voice Enrollment">
      <div className="p-4 space-y-4">
        {/* Name Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Your Name
          </label>
          <input
            type="text"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            placeholder="Enter your name"
            disabled={state.isEnrolling && recordingStep > 0}
          />
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-gray-400">
            <span>Enrollment Progress</span>
            <span>{Math.round(state.enrollmentProgress)}%</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
              style={{ width: `${state.enrollmentProgress}%` }}
            />
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-gray-800/50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-cyan-400 mb-2">
            Step {recordingStep + 1} of 5
          </h3>
          <p className="text-white text-lg mb-1">
            {prompts[recordingStep] || 'Complete!'}
          </p>
          <p className="text-gray-400 text-sm">
            Speak naturally and clearly. This helps MIRA recognize your voice.
          </p>
        </div>

        {/* Feedback */}
        {feedback && (
          <div className={`text-center py-2 px-3 rounded-lg ${
            feedback.includes('Error') || feedback.includes('error')
              ? 'bg-red-500/20 text-red-400'
              : feedback.includes('✓')
              ? 'bg-green-500/20 text-green-400'
              : 'bg-cyan-500/20 text-cyan-400'
          }`}>
            {feedback}
          </div>
        )}

        {/* Recording Indicator */}
        {isRecording && (
          <div className="flex items-center justify-center space-x-2 py-3">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="text-red-400 text-sm">Recording...</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex space-x-3">
          <button
            onClick={handleCancel}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={startRecording}
            disabled={isRecording || state.enrollmentProgress >= 100}
            className={`flex-1 px-4 py-2 rounded-lg transition-colors ${
              isRecording || state.enrollmentProgress >= 100
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white'
            }`}
          >
            {isRecording ? 'Recording...' : recordingStep >= 5 ? 'Complete' : 'Record Sample'}
          </button>
        </div>

        {/* Error Display */}
        {state.error && (
          <div className="text-center text-red-400 text-sm">
            {state.error}
          </div>
        )}
      </div>
    </Modal>
  );
}
