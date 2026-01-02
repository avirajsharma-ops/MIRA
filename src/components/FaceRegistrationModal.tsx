'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import Modal from './Modal';

interface FaceRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userName: string;
  isNewAccount?: boolean;
}

export default function FaceRegistrationModal({
  isOpen,
  onClose,
  onSuccess,
  userName,
  isNewAccount = false,
}: FaceRegistrationModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Start camera when modal opens
  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
      setCapturedImage(null);
      setError(null);
      setCountdown(null);
    }
    
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        }
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setIsCameraReady(true);
        };
      }
    } catch (err) {
      console.error('Camera error:', err);
      setError('Unable to access camera. Please allow camera permissions.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraReady(false);
  };

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;
    
    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw video frame to canvas (mirror for selfie view)
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    
    // Get base64 image
    const imageData = canvas.toDataURL('image/jpeg', 0.9);
    setCapturedImage(imageData);
  }, []);

  const startCountdown = useCallback(() => {
    setCountdown(3);
    
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          capturePhoto();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [capturePhoto]);

  const retakePhoto = () => {
    setCapturedImage(null);
    setError(null);
  };

  const submitPhoto = async () => {
    if (!capturedImage) return;
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      const token = localStorage.getItem('mira_token');
      
      // Extract base64 data (remove data URL prefix)
      const base64Data = capturedImage.replace(/^data:image\/\w+;base64,/, '');
      
      const response = await fetch('/api/faces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'register',
          imageBase64: base64Data,
          personName: userName,
          relationship: 'Account Owner',
          isOwner: true,
        }),
      });
      
      if (response.ok) {
        onSuccess();
        onClose();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to register face');
      }
    } catch (err) {
      console.error('Submit error:', err);
      setError('Failed to register face. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    if (isNewAccount) {
      // For new accounts, still close but don't mark as success
      onClose();
    }
  };

  // Handle close - for new accounts, closing without capture just skips
  const handleClose = () => {
    onClose();
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={handleClose} 
      title={isNewAccount ? `Welcome, ${userName}!` : 'Photo Registration'} 
      size="sm"
    >
      <div className="-mt-2">
        {/* Subtitle */}
        <p className="text-white/50 text-xs text-center mb-3">
          {isNewAccount 
            ? 'Take a profile photo'
            : 'Register your photo for MIRA'
          }
        </p>

        {/* Camera / Preview - Compact */}
        <div className="relative aspect-[4/3] max-h-[40vh] bg-black/50 rounded-xl overflow-hidden mb-3 mx-auto">
          {!capturedImage ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
              
              {/* Face guide overlay - smaller */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-32 h-40 sm:w-40 sm:h-52 border-2 border-dashed border-white/30 rounded-full" />
              </div>
              
              {/* Countdown overlay */}
              {countdown !== null && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <span className="text-5xl font-bold text-white animate-pulse">
                    {countdown}
                  </span>
                </div>
              )}
              
              {/* Camera loading state */}
              {!isCameraReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                  <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </>
          ) : (
            <img
              src={capturedImage}
              alt="Captured"
              className="w-full h-full object-cover"
            />
          )}
        </div>

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Error message */}
        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs text-center bg-red-500/20 text-red-400">
            {error}
          </div>
        )}

        {/* Instruction - only when camera ready and no error */}
        {!capturedImage && isCameraReady && !error && (
          <p className="text-white/40 text-xs text-center mb-3">
            Position face in oval, then capture
          </p>
        )}

        {/* Actions - compact buttons */}
        <div className="flex gap-2">
          {!capturedImage ? (
            <>
              {!isNewAccount && (
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 px-3 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg transition-colors"
                >
                  Later
                </button>
              )}
              <button
                onClick={startCountdown}
                disabled={!isCameraReady || countdown !== null}
                className="flex-1 py-2.5 px-3 bg-white text-black text-sm rounded-lg font-medium hover:bg-white/90 transition-opacity disabled:opacity-50"
              >
                {countdown !== null ? `${countdown}...` : '📸 Capture'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={retakePhoto}
                disabled={isSubmitting}
                className="flex-1 py-2.5 px-3 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                Retake
              </button>
              <button
                onClick={submitPhoto}
                disabled={isSubmitting}
                className="flex-1 py-2.5 px-3 bg-white text-black text-sm rounded-lg font-medium hover:bg-white/90 transition-opacity disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : '✓ Confirm'}
              </button>
            </>
          )}
        </div>

        {/* Skip option for new accounts - minimal */}
        {isNewAccount && !capturedImage && (
          <button
            onClick={handleSkip}
            className="w-full mt-2 py-1.5 text-white/30 hover:text-white/50 text-xs transition-colors"
          >
            Skip for now
          </button>
        )}
      </div>
    </Modal>
  );
}
