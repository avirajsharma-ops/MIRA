'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { 
  recognizeGesture, 
  GestureType, 
  DetectedGesture,
  isGestureOnCooldown,
  markGestureUsed 
} from './gestureService';

export interface UseGestureDetectionOptions {
  onGestureDetected?: (gesture: DetectedGesture) => void;
  minConfidence?: number;
  enabled?: boolean;
}

export function useGestureDetection(options: UseGestureDetectionOptions = {}) {
  const { 
    onGestureDetected, 
    minConfidence = 0.7,
    enabled = true 
  } = options;

  const [currentGesture, setCurrentGesture] = useState<DetectedGesture | null>(null);
  const [isHandsLoaded, setIsHandsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handsRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastGestureRef = useRef<GestureType>('none');
  const stableGestureCountRef = useRef(0);
  const STABLE_FRAMES_REQUIRED = 5; // Require gesture to be stable for 5 frames

  const initializeHands = useCallback(async () => {
    if (typeof window === 'undefined') return;

    try {
      // Dynamic import for client-side only
      const { Hands } = await import('@mediapipe/hands');
      
      const hands = new Hands({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5
      });

      hands.onResults((results: any) => {
        if (!enabled) return;

        // Draw results on canvas if available
        if (canvasRef.current && results.image) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            ctx.save();
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            ctx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
            
            // Draw hand landmarks
            if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
              for (const landmarks of results.multiHandLandmarks) {
                // Draw connections
                drawConnectors(ctx, landmarks, canvasRef.current.width, canvasRef.current.height);
                // Draw landmarks
                for (const landmark of landmarks) {
                  ctx.fillStyle = '#00FF00';
                  ctx.beginPath();
                  ctx.arc(
                    landmark.x * canvasRef.current.width,
                    landmark.y * canvasRef.current.height,
                    5,
                    0,
                    2 * Math.PI
                  );
                  ctx.fill();
                }
              }
            }
            ctx.restore();
          }
        }

        // Process detected hands
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          const landmarks = results.multiHandLandmarks[0];
          const handedness = results.multiHandedness?.[0]?.label || 'Right';
          
          const { gesture, confidence } = recognizeGesture(landmarks, handedness as 'Left' | 'Right');
          
          // Require stable gesture detection
          if (gesture === lastGestureRef.current && gesture !== 'none') {
            stableGestureCountRef.current++;
          } else {
            stableGestureCountRef.current = 0;
            lastGestureRef.current = gesture;
          }

          if (
            gesture !== 'none' && 
            confidence >= minConfidence &&
            stableGestureCountRef.current >= STABLE_FRAMES_REQUIRED &&
            !isGestureOnCooldown(gesture)
          ) {
            const detectedGesture: DetectedGesture = {
              gesture,
              confidence,
              handedness: handedness as 'Left' | 'Right',
              landmarks,
            };

            setCurrentGesture(detectedGesture);
            markGestureUsed(gesture);
            stableGestureCountRef.current = 0;
            
            if (onGestureDetected) {
              onGestureDetected(detectedGesture);
            }
          }
        } else {
          // No hands detected
          if (currentGesture) {
            setCurrentGesture(null);
          }
          lastGestureRef.current = 'none';
          stableGestureCountRef.current = 0;
        }
      });

      handsRef.current = hands;
      setIsHandsLoaded(true);
      console.log('MediaPipe Hands initialized successfully');
    } catch (err) {
      console.error('Failed to initialize MediaPipe Hands:', err);
      setError('Failed to load gesture detection');
    }
  }, [enabled, minConfidence, onGestureDetected, currentGesture]);

  // Draw hand skeleton connections
  const drawConnectors = (
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    width: number,
    height: number
  ) => {
    const connections = [
      // Thumb
      [0, 1], [1, 2], [2, 3], [3, 4],
      // Index
      [0, 5], [5, 6], [6, 7], [7, 8],
      // Middle
      [0, 9], [9, 10], [10, 11], [11, 12],
      // Ring
      [0, 13], [13, 14], [14, 15], [15, 16],
      // Pinky
      [0, 17], [17, 18], [18, 19], [19, 20],
      // Palm
      [5, 9], [9, 13], [13, 17],
    ];

    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2;

    for (const [start, end] of connections) {
      ctx.beginPath();
      ctx.moveTo(landmarks[start].x * width, landmarks[start].y * height);
      ctx.lineTo(landmarks[end].x * width, landmarks[end].y * height);
      ctx.stroke();
    }
  };

  const processFrame = useCallback(async (video: HTMLVideoElement) => {
    if (handsRef.current && video.readyState >= 2) {
      await handsRef.current.send({ image: video });
    }
  }, []);

  const startDetection = useCallback(async (video: HTMLVideoElement, canvas?: HTMLCanvasElement) => {
    videoRef.current = video;
    if (canvas) {
      canvasRef.current = canvas;
    }

    if (!handsRef.current) {
      await initializeHands();
    }

    // Start processing frames
    const processLoop = async () => {
      if (videoRef.current && enabled) {
        await processFrame(videoRef.current);
      }
      requestAnimationFrame(processLoop);
    };

    processLoop();
  }, [initializeHands, processFrame, enabled]);

  const stopDetection = useCallback(() => {
    if (cameraRef.current) {
      cameraRef.current.stop();
      cameraRef.current = null;
    }
    videoRef.current = null;
    canvasRef.current = null;
    setCurrentGesture(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopDetection();
    };
  }, [stopDetection]);

  return {
    currentGesture,
    isHandsLoaded,
    error,
    startDetection,
    stopDetection,
    processFrame,
    initializeHands,
  };
}
