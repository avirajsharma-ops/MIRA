'use client';

import { useEffect, useRef } from 'react';
import { useMIRA } from '@/context/MIRAContext';

export default function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { cameraStream } = useMIRA();

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play().catch(console.error);
    }
  }, [cameraStream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className="w-full h-full object-cover"
    />
  );
}
