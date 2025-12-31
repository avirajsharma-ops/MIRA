'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseMediaCaptureOptions {
  enableCamera?: boolean;
  enableScreen?: boolean;
  captureInterval?: number;
  onCameraFrame?: (imageBase64: string) => void;
  onScreenFrame?: (imageBase64: string) => void;
}

export function useMediaCapture(options: UseMediaCaptureOptions = {}) {
  const {
    enableCamera = true,
    enableScreen = true,
    captureInterval = 5000, // Capture every 5 seconds for better face recognition
    onCameraFrame,
    onScreenFrame,
  } = options;

  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isScreenActive, setIsScreenActive] = useState(false);
  const [lastCameraFrame, setLastCameraFrame] = useState<string | null>(null);
  const [lastScreenFrame, setLastScreenFrame] = useState<string | null>(null);

  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const captureFrame = useCallback((video: HTMLVideoElement): string | null => {
    if (!video || video.readyState < 2) {
      return null;
    }

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    
    if (width === 0 || height === 0) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Get base64 without the data URL prefix
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    const base64 = dataUrl.split(',')[1];
    
    return base64;
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'user', 
          width: { ideal: 640 }, 
          height: { ideal: 480 } 
        },
        audio: false,
      });

      setCameraStream(stream);
      setIsCameraActive(true);

      // Create video element for capturing frames
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      
      // Wait for video to be ready
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          resolve();
        };
      });
      
      await video.play();
      cameraVideoRef.current = video;

      // Capture first frame immediately
      setTimeout(() => {
        if (cameraVideoRef.current && onCameraFrame) {
          const frame = captureFrame(cameraVideoRef.current);
          if (frame) {
            onCameraFrame(frame);
          }
        }
      }, 500);

      return stream;
    } catch (error) {
      console.error('Error starting camera:', error);
      return null;
    }
  }, [captureFrame, onCameraFrame]);

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
      setIsCameraActive(false);
    }
  }, [cameraStream]);

  const startScreenCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: false,
      });

      setScreenStream(stream);
      setIsScreenActive(true);

      // Handle stream ending (user clicks stop sharing)
      stream.getVideoTracks()[0].onended = () => {
        setScreenStream(null);
        setIsScreenActive(false);
      };

      // Create video element for capturing frames
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.muted = true;
      await video.play();
      screenVideoRef.current = video;

      return stream;
    } catch (error) {
      console.error('Error starting screen capture:', error);
      return null;
    }
  }, []);

  const stopScreenCapture = useCallback(() => {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
      setIsScreenActive(false);
    }
  }, [screenStream]);

  const captureCurrentFrames = useCallback(() => {
    if (cameraVideoRef.current && isCameraActive) {
      const frame = captureFrame(cameraVideoRef.current);
      if (frame) {
        setLastCameraFrame(frame);
        onCameraFrame?.(frame);
      }
    }

    if (screenVideoRef.current && isScreenActive) {
      const frame = captureFrame(screenVideoRef.current);
      if (frame) {
        setLastScreenFrame(frame);
        onScreenFrame?.(frame);
      }
    }
  }, [isCameraActive, isScreenActive, captureFrame, onCameraFrame, onScreenFrame]);

  // Start periodic capture
  useEffect(() => {
    if (isCameraActive || isScreenActive) {
      captureIntervalRef.current = setInterval(captureCurrentFrames, captureInterval);
    }

    return () => {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
      }
    };
  }, [isCameraActive, isScreenActive, captureInterval, captureCurrentFrames]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      stopScreenCapture();
    };
  }, []);

  return {
    cameraStream,
    screenStream,
    isCameraActive,
    isScreenActive,
    lastCameraFrame,
    lastScreenFrame,
    startCamera,
    stopCamera,
    startScreenCapture,
    stopScreenCapture,
    captureCurrentFrames,
    cameraVideoRef,
  };
}

export default useMediaCapture;
