'use client';

import { useState, useCallback, useRef } from 'react';

type AgentType = 'mi' | 'ra' | 'mira';

interface UseAudioPlayerOptions {
  onSpeakingStart?: (agent: AgentType) => void;
  onSpeakingEnd?: (agent: AgentType) => void;
}

export function useAudioPlayer(options: UseAudioPlayerOptions = {}) {
  const { onSpeakingStart, onSpeakingEnd } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<AgentType | null>(null);
  const [queue, setQueue] = useState<{ text: string; agent: AgentType }[]>([]);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const currentAudioUrlRef = useRef<string | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);

  // Cleanup function for audio resources
  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.src = '';
      audioRef.current.load(); // Reset the audio element
      audioRef.current = null;
    }
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }
    playPromiseRef.current = null;
  }, []);

  const playAudio = useCallback(async (text: string, agent: AgentType) => {
    if (!text) return;

    // Add to queue if already playing
    if (isPlayingRef.current) {
      setQueue(prev => [...prev, { text, agent }]);
      return;
    }

    // For MIRA responses, use MI's voice (no overlapping voices)
    const voiceToUse = agent === 'mira' ? 'mi' : agent;

    isPlayingRef.current = true;
    setIsPlaying(true);
    setCurrentAgent(agent);
    onSpeakingStart?.(agent);

    try {
      // Stop any previous audio first to prevent AbortError
      cleanupAudio();

      const token = localStorage.getItem('mira_token');

      // Use streaming endpoint for faster playback
      const response = await fetch('/api/tts/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text, voice: voiceToUse }),
      });

      if (!response.ok) throw new Error('TTS failed');

      // Create a MediaSource for streaming playback
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      currentAudioUrlRef.current = audioUrl;

      const audio = new Audio();
      audioRef.current = audio;

      // Set up event handlers before setting src
      audio.onended = () => {
        cleanupAudio();
        isPlayingRef.current = false;
        setIsPlaying(false);
        onSpeakingEnd?.(agent);
        setCurrentAgent(null);

        // Play next in queue
        setQueue(prev => {
          if (prev.length > 0) {
            const [next, ...rest] = prev;
            setTimeout(() => playAudio(next.text, next.agent), 50);
            return rest;
          }
          return prev;
        });
      };

      audio.onerror = () => {
        // Silently handle errors - AbortError is expected when stopping audio
        cleanupAudio();
        isPlayingRef.current = false;
        setIsPlaying(false);
        onSpeakingEnd?.(agent);
        setCurrentAgent(null);
      };

      // Set src and preload
      audio.preload = 'auto';
      audio.src = audioUrl;

      // Wait for audio to be ready before playing
      await new Promise<void>((resolve, reject) => {
        audio.oncanplaythrough = () => resolve();
        audio.onerror = () => reject(new Error('Audio load error'));
        // Timeout after 10 seconds
        setTimeout(() => resolve(), 10000);
      });

      // Check if audio element is still valid (not cleaned up)
      if (audioRef.current !== audio) {
        return;
      }

      // Start playing and store the promise
      playPromiseRef.current = audio.play();
      await playPromiseRef.current;
    } catch (error) {
      // Ignore AbortError - it's expected when audio is interrupted
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      // Ignore other expected errors silently
      if (error instanceof Error && (error.message === 'Audio load error' || error.name === 'NotAllowedError')) {
        return;
      }
      console.error('Error playing audio:', error);
      cleanupAudio();
      isPlayingRef.current = false;
      setIsPlaying(false);
      onSpeakingEnd?.(agent);
      setCurrentAgent(null);
    }
  }, [onSpeakingStart, onSpeakingEnd, cleanupAudio]);

  const stopAudio = useCallback(async () => {
    // Wait for any pending play() promise before stopping
    if (playPromiseRef.current) {
      try {
        await playPromiseRef.current;
      } catch {
        // Ignore any errors from the pending play
      }
    }
    cleanupAudio();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentAgent(null);
    setQueue([]);
  }, [cleanupAudio]);

  // Play audio and wait for it to complete (useful for sequential playback like debates)
  const playAudioAndWait = useCallback(async (text: string, agent: AgentType): Promise<void> => {
    if (!text) return;

    // Wait for any currently playing audio to finish first
    while (isPlayingRef.current) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Now play our audio
    await playAudio(text, agent);

    // Wait for this audio to complete
    while (isPlayingRef.current) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }, [playAudio]);

  const playDebateSequence = useCallback(async (
    messages: { agent: AgentType; content: string }[]
  ) => {
    for (const msg of messages) {
      await new Promise<void>((resolve) => {
        const checkQueue = setInterval(() => {
          if (!isPlayingRef.current) {
            clearInterval(checkQueue);
            resolve();
          }
        }, 100);
      });
      await playAudio(msg.content, msg.agent);
    }
  }, [playAudio]);

  return {
    isPlaying,
    currentAgent,
    queue,
    playAudio,
    playAudioAndWait,
    stopAudio,
    playDebateSequence,
  };
}

export default useAudioPlayer;
