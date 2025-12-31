'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

// Face-api types (imported dynamically to avoid SSR issues)
type FaceApiModule = typeof import('@vladmandic/face-api');
let faceapi: FaceApiModule | null = null;

// Face detection result interfaces
export interface DetectedFace {
  id: string;
  embedding: Float32Array | number[];
  expression: {
    dominant: string;
    scores: { [key: string]: number };
  };
  landmarks: any; // FaceLandmarks68 type from face-api
  box: { x: number; y: number; width: number; height: number };
  isLookingAtCamera: boolean;
}

export interface RecognizedFace extends DetectedFace {
  personId: string;
  personName: string;
  relationship: string;
  confidence: number;
}

export interface FaceDetectionResult {
  detectedFaces: DetectedFace[];
  recognizedFaces: RecognizedFace[];
  unknownFaces: DetectedFace[];
  frameTimestamp: number;
}

export interface KnownFace {
  personId: string;
  personName: string;
  relationship: string;
  embedding: number[];
  isOwner: boolean;
}

interface UseFaceDetectionOptions {
  modelPath?: string;
  minConfidence?: number;
  recognitionThreshold?: number;
  onFaceDetected?: (result: FaceDetectionResult) => void;
}

// Calculate Euclidean distance between two embeddings
function euclideanDistance(embedding1: number[] | Float32Array, embedding2: number[] | Float32Array): number {
  if (embedding1.length !== embedding2.length) return Infinity;
  
  let sum = 0;
  for (let i = 0; i < embedding1.length; i++) {
    sum += Math.pow(embedding1[i] - embedding2[i], 2);
  }
  return Math.sqrt(sum);
}

// Point type for facial landmarks
interface LandmarkPoint {
  x: number;
  y: number;
}

// Determine if person is looking at camera based on landmark positions
function isLookingAtCamera(landmarks: any): boolean {
  const positions = landmarks.positions;
  
  // Get key facial points
  const leftEye: LandmarkPoint[] = landmarks.getLeftEye();
  const rightEye: LandmarkPoint[] = landmarks.getRightEye();
  const nose: LandmarkPoint[] = landmarks.getNose();
  
  if (leftEye.length < 2 || rightEye.length < 2 || nose.length < 1) {
    return false;
  }
  
  // Calculate eye center points
  const leftEyeCenter = {
    x: leftEye.reduce((s: number, p: LandmarkPoint) => s + p.x, 0) / leftEye.length,
    y: leftEye.reduce((s: number, p: LandmarkPoint) => s + p.y, 0) / leftEye.length,
  };
  const rightEyeCenter = {
    x: rightEye.reduce((s: number, p: LandmarkPoint) => s + p.x, 0) / rightEye.length,
    y: rightEye.reduce((s: number, p: LandmarkPoint) => s + p.y, 0) / rightEye.length,
  };
  
  // Nose tip (index 30 in 68-point landmarks)
  const noseTip = positions[30];
  
  // Calculate face center (midpoint between eyes)
  const faceCenterX = (leftEyeCenter.x + rightEyeCenter.x) / 2;
  
  // Check if nose is roughly centered between eyes (indicates facing camera)
  const noseOffset = Math.abs(noseTip.x - faceCenterX);
  const eyeDistance = Math.abs(rightEyeCenter.x - leftEyeCenter.x);
  
  // If nose offset is less than 20% of eye distance, likely looking at camera
  return noseOffset < eyeDistance * 0.2;
}

export function useFaceDetection(options: UseFaceDetectionOptions = {}) {
  const {
    modelPath = '/models/face-api',
    minConfidence = 0.5,
    recognitionThreshold = 1.0, // Euclidean distance threshold - FaceNet typically <0.8 for same person
    onFaceDetected,
  } = options;

  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [knownFaces, setKnownFaces] = useState<KnownFace[]>([]);
  const [lastResult, setLastResult] = useState<FaceDetectionResult | null>(null);
  
  const isLoadingRef = useRef(false);
  const detectionIdCounter = useRef(0);

  // Load face-api.js models (dynamically import to avoid SSR issues)
  const loadModels = useCallback(async () => {
    if (isModelLoaded || isLoadingRef.current) return;
    
    // Only run in browser
    if (typeof window === 'undefined') return;
    
    isLoadingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      console.log('[FaceDetection] Loading face-api models...');
      
      // Dynamically import face-api to avoid SSR issues
      if (!faceapi) {
        faceapi = await import('@vladmandic/face-api');
      }
      
      // Load all required models
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath),
        faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelPath),
        faceapi.nets.faceExpressionNet.loadFromUri(modelPath),
      ]);
      
      console.log('[FaceDetection] All models loaded successfully');
      setIsModelLoaded(true);
    } catch (err) {
      console.error('[FaceDetection] Error loading models:', err);
      setError(err instanceof Error ? err.message : 'Failed to load face detection models');
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, [modelPath, isModelLoaded]);

  // Update known faces from database
  const updateKnownFaces = useCallback((faces: KnownFace[]) => {
    console.log(`[FaceDetection] Updated known faces: ${faces.length} people`);
    setKnownFaces(faces);
  }, []);

  // Find best match among known faces
  const findBestMatch = useCallback((embedding: Float32Array | number[]): { match: KnownFace | null; confidence: number } => {
    console.log(`[FaceMatch] Comparing against ${knownFaces.length} known faces`);
    
    let bestMatch: KnownFace | null = null;
    let bestDistance = Infinity;

    for (const knownFace of knownFaces) {
      if (!knownFace.embedding || knownFace.embedding.length === 0) {
        console.log(`[FaceMatch] Skipping ${knownFace.personName} - no embedding`);
        continue;
      }
      
      const distance = euclideanDistance(embedding, knownFace.embedding);
      console.log(`[FaceMatch] Distance to ${knownFace.personName}: ${distance.toFixed(4)}`);
      
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = knownFace;
      }
    }

    // Convert distance to confidence (closer = higher confidence)
    // Distance of 0 = 100% confidence, threshold distance = 0% confidence  
    const confidence = Math.max(0, 1 - (bestDistance / recognitionThreshold));
    
    console.log(`[FaceMatch] Best match: ${bestMatch?.personName || 'none'}, distance: ${bestDistance.toFixed(4)}, threshold: ${recognitionThreshold}`);
    
    // Only return match if under threshold
    if (bestDistance < recognitionThreshold && bestMatch) {
      return { match: bestMatch, confidence };
    }

    return { match: null, confidence: 0 };
  }, [knownFaces, recognitionThreshold]);

  // Detect faces in an image (with yielding to prevent UI blocking)
  const detectFaces = useCallback(async (
    imageSource: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | string
  ): Promise<FaceDetectionResult | null> => {
    if (!isModelLoaded || !faceapi) {
      console.warn('[FaceDetection] Models not loaded yet');
      return null;
    }

    try {
      let input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
      
      // Handle base64 string input
      if (typeof imageSource === 'string') {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = imageSource.startsWith('data:') ? imageSource : `data:image/jpeg;base64,${imageSource}`;
        });
        input = img;
      } else {
        input = imageSource;
      }

      // Yield to allow UI to remain responsive
      await new Promise(resolve => setTimeout(resolve, 0));

      // Detect faces with all descriptors
      console.log('[FaceDetection] Starting face detection...');
      const detections = await faceapi
        .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence }))
        .withFaceLandmarks()
        .withFaceDescriptors()
        .withFaceExpressions();
        
      console.log(`[FaceDetection] Found ${detections.length} faces`);
      
      // Yield again after heavy computation
      await new Promise(resolve => setTimeout(resolve, 0));

      const timestamp = Date.now();
      const detectedFaces: DetectedFace[] = [];
      const recognizedFaces: RecognizedFace[] = [];
      const unknownFaces: DetectedFace[] = [];

      for (const detection of detections) {
        const id = `face_${++detectionIdCounter.current}`;
        const box = detection.detection.box;
        const landmarks = detection.landmarks;
        const descriptor = detection.descriptor;
        const expressions = detection.expressions;

        // Find dominant expression
        let dominantExpression = 'neutral';
        let maxScore = 0;
        const expressionScores: { [key: string]: number } = {};
        
        for (const [expression, score] of Object.entries(expressions)) {
          expressionScores[expression] = score;
          if (score > maxScore) {
            maxScore = score;
            dominantExpression = expression;
          }
        }

        const detectedFace: DetectedFace = {
          id,
          embedding: Array.from(descriptor),
          expression: {
            dominant: dominantExpression,
            scores: expressionScores,
          },
          landmarks,
          box: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          },
          isLookingAtCamera: isLookingAtCamera(landmarks),
        };

        detectedFaces.push(detectedFace);

        // Try to match with known faces
        const { match, confidence } = findBestMatch(descriptor);

        if (match) {
          const recognizedFace: RecognizedFace = {
            ...detectedFace,
            personId: match.personId,
            personName: match.personName,
            relationship: match.relationship,
            confidence,
          };
          recognizedFaces.push(recognizedFace);
          console.log(`[FaceDetection] Recognized: ${match.personName} (confidence: ${(confidence * 100).toFixed(1)}%)`);
        } else {
          unknownFaces.push(detectedFace);
          console.log(`[FaceDetection] Unknown face detected`);
        }
      }

      const result: FaceDetectionResult = {
        detectedFaces,
        recognizedFaces,
        unknownFaces,
        frameTimestamp: timestamp,
      };

      setLastResult(result);
      onFaceDetected?.(result);

      return result;
    } catch (err) {
      console.error('[FaceDetection] Detection error:', err);
      return null;
    }
  }, [isModelLoaded, minConfidence, findBestMatch, onFaceDetected]);

  // Get face embedding from image (for registering new faces)
  const getFaceEmbedding = useCallback(async (
    imageSource: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | string
  ): Promise<{ embedding: number[]; expression: string } | null> => {
    if (!isModelLoaded || !faceapi) {
      console.warn('[FaceDetection] Models not loaded yet');
      return null;
    }

    try {
      let input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
      
      if (typeof imageSource === 'string') {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = imageSource.startsWith('data:') ? imageSource : `data:image/jpeg;base64,${imageSource}`;
        });
        input = img;
      } else {
        input = imageSource;
      }

      // Yield to prevent UI blocking
      await new Promise(resolve => setTimeout(resolve, 0));

      console.log('[FaceDetection] Extracting face embedding...');
      
      // Detect single face
      const detection = await faceapi
        .detectSingleFace(input, new faceapi.SsdMobilenetv1Options({ minConfidence }))
        .withFaceLandmarks()
        .withFaceDescriptor()
        .withFaceExpressions();

      // Yield again after computation
      await new Promise(resolve => setTimeout(resolve, 0));

      if (!detection) {
        console.warn('[FaceDetection] No face detected in image');
        return null;
      }

      console.log('[FaceDetection] Face embedding extracted successfully');

      // Get dominant expression
      let dominantExpression = 'neutral';
      let maxScore = 0;
      for (const [expression, score] of Object.entries(detection.expressions)) {
        if (score > maxScore) {
          maxScore = score;
          dominantExpression = expression;
        }
      }

      return {
        embedding: Array.from(detection.descriptor),
        expression: dominantExpression,
      };
    } catch (err) {
      console.error('[FaceDetection] Error getting face embedding:', err);
      return null;
    }
  }, [isModelLoaded, minConfidence]);

  // Auto-load models on mount
  useEffect(() => {
    loadModels();
  }, [loadModels]);

  return {
    // State
    isModelLoaded,
    isLoading,
    error,
    knownFaces,
    lastResult,
    
    // Actions
    loadModels,
    detectFaces,
    getFaceEmbedding,
    updateKnownFaces,
  };
}

export default useFaceDetection;
