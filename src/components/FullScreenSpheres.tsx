'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export type MIRAState = 'resting' | 'active' | 'listening' | 'speaking' | 'thinking';

interface FullScreenSpheresProps {
  mode: 'separate' | 'combined';
  speakingAgent: 'mira' | null; // MIRA is a single unified entity
  isSpeaking: boolean;
  miraAudioLevel: number;  // MIRA's voice level - for distortion effect
  userAudioLevel: number;  // User's voice level - for spin effect
  isThinking?: boolean;
  miraState?: MIRAState;   // MIRA's current state for visual feedback
}

interface Particle {
  // Base position (where it should be in current mode)
  targetX: number;
  targetY: number;
  targetZ: number;
  // Current position
  x: number;
  y: number;
  z: number;
  // Velocity
  vx: number;
  vy: number;
  vz: number;
  // Properties
  size: number;
  alpha: number;
  colorType: 'mi' | 'ra';
  // Original sphere position (for separation animation)
  sphereBaseX: number;
  sphereBaseY: number;
  sphereBaseZ: number;
  // Organic animation - unique per particle
  noiseOffsetX: number;
  noiseOffsetY: number;
  noiseOffsetZ: number;
  noiseSpeed: number;
}

export default function FullScreenSpheres({
  mode,
  speakingAgent,
  isSpeaking,
  miraAudioLevel,
  userAudioLevel,
  isThinking = false,
  miraState = 'active',
}: FullScreenSpheresProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const miraAudioLevelRef = useRef(0);
  const userAudioLevelRef = useRef(0);
  const modeRef = useRef(mode);
  const transitionProgressRef = useRef(mode === 'combined' ? 1 : 0);
  const mouseRef = useRef({ x: 0, y: 0, isActive: false });
  const isSpeakingRef = useRef(isSpeaking);
  const isThinkingRef = useRef(isThinking);
  const miraStateRef = useRef<MIRAState>(miraState);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const initializedRef = useRef(false);
  const debugCounterRef = useRef(0);
  
  // Smooth audio level transitions - update refs immediately
  useEffect(() => {
    miraAudioLevelRef.current = miraAudioLevel;
    // Debug log when audio level changes significantly
    if (miraAudioLevel > 0.02) {
      debugCounterRef.current++;
      if (debugCounterRef.current % 30 === 0) {
        console.log('[Sphere] MIRA audio level:', miraAudioLevel.toFixed(3));
      }
    }
  }, [miraAudioLevel]);

  useEffect(() => {
    userAudioLevelRef.current = userAudioLevel;
    // Debug log when audio level changes significantly
    if (userAudioLevel > 0.02) {
      debugCounterRef.current++;
      if (debugCounterRef.current % 30 === 0) {
        console.log('[Sphere] User audio level:', userAudioLevel.toFixed(3));
      }
    }
  }, [userAudioLevel]);

  // Update mode ref for animation
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Update speaking state refs
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  // Update thinking state ref
  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  // Update MIRA state ref
  useEffect(() => {
    miraStateRef.current = miraState;
  }, [miraState]);

  // Handle window resize
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Sphere radius based on screen size
  const getSphereRadius = useCallback(() => {
    const minDim = Math.min(dimensions.width, dimensions.height);
    return minDim * 0.22; // 22% of smaller dimension
  }, [dimensions]);

  // Get sphere centers
  const getSphereCenters = useCallback(() => {
    const cx = dimensions.width / 2;
    const cy = dimensions.height / 2;
    const spacing = dimensions.width * 0.2; // 20% of width apart

    return {
      mi: { x: cx - spacing, y: cy },
      ra: { x: cx + spacing, y: cy },
      combined: { x: cx, y: cy },
    };
  }, [dimensions]);

  // Initialize particles
  const initParticles = useCallback(() => {
    if (dimensions.width === 0) return;

    const particles: Particle[] = [];
    // Reduced particle count for better performance and stability
    const particleCount = 2000;
    const radius = getSphereRadius();
    const centers = getSphereCenters();
    // Use lower DPR for better performance (cap at 1.5)
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;

    for (let i = 0; i < particleCount; i++) {
      // Fibonacci sphere distribution
      const phi = Math.acos(1 - 2 * (i + 0.5) / particleCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;

      const sphereX = radius * Math.sin(phi) * Math.cos(theta);
      const sphereY = radius * Math.sin(phi) * Math.sin(theta);
      const sphereZ = radius * Math.cos(phi);

      // Assign to MI or RA based on index
      const colorType: 'mi' | 'ra' = i % 2 === 0 ? 'mi' : 'ra';
      
      // Start position based on current mode - scale for dpr to match animation loop
      const center = mode === 'combined' ? centers.combined : centers[colorType];
      const cx = dimensions.width / 2;
      const cy = dimensions.height / 2;
      
      // Calculate initial position matching what animation loop expects
      const scaledBaseX = sphereX * dpr;
      const scaledBaseY = sphereY * dpr;
      const scaledBaseZ = sphereZ * dpr;
      const targetCenterX = center.x * dpr;
      const targetCenterY = center.y * dpr;
      
      particles.push({
        targetX: sphereX,
        targetY: sphereY,
        targetZ: sphereZ,
        // Initialize at exact target position (scaled) to prevent zoom effect
        x: scaledBaseX + targetCenterX - cx * dpr,
        y: scaledBaseY + targetCenterY - cy * dpr,
        z: scaledBaseZ,
        vx: 0,
        vy: 0,
        vz: 0,
        // Slightly smaller particles for performance
        size: Math.random() * 1.5 + 0.8,
        alpha: Math.random() * 0.5 + 0.3,
        colorType,
        sphereBaseX: sphereX,
        sphereBaseY: sphereY,
        sphereBaseZ: sphereZ,
        // Unique noise offsets for organic movement
        noiseOffsetX: Math.random() * 1000,
        noiseOffsetY: Math.random() * 1000,
        noiseOffsetZ: Math.random() * 1000,
        noiseSpeed: 0.3 + Math.random() * 0.4, // Varying speeds for more organic feel
      });
    }

    particlesRef.current = particles;
  }, [dimensions, mode, getSphereRadius, getSphereCenters]);

  // Animation loop
  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) {
      animationRef.current = requestAnimationFrame(animate);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Cap DPR for better performance on high-density displays
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = dimensions.width * dpr;
    const height = dimensions.height * dpr;
    const cx = width / 2;
    const cy = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    const time = Date.now() * 0.001;
    const currentMiraAudioLevel = miraAudioLevelRef.current;
    const currentUserAudioLevel = userAudioLevelRef.current;
    
    // Debug logging every 2 seconds when there's audio activity
    debugCounterRef.current++;
    if (debugCounterRef.current % 120 === 0) {
      const state = miraStateRef.current;
      if (currentMiraAudioLevel > 0.01 || currentUserAudioLevel > 0.01) {
        console.log(`[Sphere Animation] State: ${state}, MIRA: ${currentMiraAudioLevel.toFixed(3)}, User: ${currentUserAudioLevel.toFixed(3)}`);
      }
    }
    
    // Audio threshold for detecting voice activity - lower threshold for better sensitivity
    const AUDIO_THRESHOLD = 0.02;
    const miraSpeaking = currentMiraAudioLevel > AUDIO_THRESHOLD;
    const userSpeaking = currentUserAudioLevel > AUDIO_THRESHOLD;
    const aiThinking = isThinkingRef.current;
    const currentMode = modeRef.current;
    const centers = getSphereCenters();
    const radius = getSphereRadius();

    // Thinking animation - subtle pulsing glow effect
    const thinkingPulse = aiThinking ? Math.sin(time * 3) * 0.3 + 0.7 : 0;

    // Smooth transition between modes
    const targetProgress = currentMode === 'combined' ? 1 : 0;
    const transitionSpeed = 0.03;
    if (transitionProgressRef.current < targetProgress) {
      transitionProgressRef.current = Math.min(1, transitionProgressRef.current + transitionSpeed);
    } else if (transitionProgressRef.current > targetProgress) {
      transitionProgressRef.current = Math.max(0, transitionProgressRef.current - transitionSpeed);
    }
    const progress = transitionProgressRef.current;

    // === USER VOICE: Intense oscillation/vibration effect ===
    // Oscillation frequency increases with voice intensity
    const baseOscillationFreq = 15; // Higher base frequency for more visible vibration
    const oscillationFreq = baseOscillationFreq + currentUserAudioLevel * 40; // Even faster vibration
    
    // Oscillation amplitude - VERY intense
    const oscillationAmplitude = currentUserAudioLevel * 120; // Doubled from 60 to 120

    // === MIRA VOICE: Original distortion effect settings ===
    const baseVoiceSpeed = 2.0;
    const voiceSpeedBoost = currentMiraAudioLevel * 1.5;
    const voiceAngle = time * (baseVoiceSpeed + voiceSpeedBoost);
    const voiceDistortRadius = radius * (0.3 + currentMiraAudioLevel * 0.4);

    // Physics constants for MIRA distortion
    const Z_PERSPECTIVE = 1200;
    const currentState = miraStateRef.current;
    // Slower movement when resting
    const FRICTION = currentState === 'resting' ? 0.95 : 0.88;

    particlesRef.current.forEach((p) => {
      // No pulse scale - keep sphere size constant
      const pulseScale = 1;
      
      // Organic intensity - subtle movement during thinking, boosted when MIRA speaks
      // Reduced when resting
      const stateMultiplier = currentState === 'resting' ? 0.3 : 1;
      const thinkingBoost = aiThinking ? (8 + thinkingPulse * 12) * stateMultiplier : 0;
      const miraBoost = miraSpeaking ? (25 + currentMiraAudioLevel * 40) * stateMultiplier : 0;
      const organicIntensity = (currentState === 'resting' ? 3 : 10) + thinkingBoost + miraBoost;
      
      // Calculate target center based on transition progress
      const miCenter = { x: centers.mi.x * dpr, y: centers.mi.y * dpr };
      const raCenter = { x: centers.ra.x * dpr, y: centers.ra.y * dpr };
      const combinedCenter = { x: centers.combined.x * dpr, y: centers.combined.y * dpr };

      let targetCenterX: number;
      let targetCenterY: number;

      if (p.colorType === 'mi') {
        targetCenterX = miCenter.x + (combinedCenter.x - miCenter.x) * progress;
        targetCenterY = miCenter.y + (combinedCenter.y - miCenter.y) * progress;
      } else {
        targetCenterX = raCenter.x + (combinedCenter.x - raCenter.x) * progress;
        targetCenterY = raCenter.y + (combinedCenter.y - raCenter.y) * progress;
      }
      
      // Organic noise-based movement (always happening, unique per particle)
      const noiseTime = time * p.noiseSpeed;
      const noiseX = Math.sin(noiseTime + p.noiseOffsetX) * Math.cos(noiseTime * 0.7 + p.noiseOffsetY) * organicIntensity;
      const noiseY = Math.cos(noiseTime * 0.8 + p.noiseOffsetY) * Math.sin(noiseTime * 1.1 + p.noiseOffsetZ) * organicIntensity;
      const noiseZ = Math.sin(noiseTime * 0.9 + p.noiseOffsetZ) * Math.cos(noiseTime * 0.6 + p.noiseOffsetX) * organicIntensity * 0.5;

      // Apply pulse scale to sphere positions
      const scaledRadius = radius * dpr * pulseScale;
      const scaledBaseX = (p.sphereBaseX / radius) * scaledRadius;
      const scaledBaseY = (p.sphereBaseY / radius) * scaledRadius;
      const scaledBaseZ = (p.sphereBaseZ / radius) * scaledRadius;

      // No rotation - sphere stays still
      let rotatedX = scaledBaseX;
      let rotatedZ = scaledBaseZ;
      let rotatedY = scaledBaseY;
      
      // === USER VOICE: Intense oscillation/vibration ===
      // Each particle oscillates outward/inward based on user voice, creating vibration effect
      if (userSpeaking && oscillationAmplitude > 0.5) {
        // Each particle has unique phase based on its position (creates wave pattern)
        const particlePhase = p.noiseOffsetX + p.noiseOffsetY + p.noiseOffsetZ;
        
        // Oscillation wave - multiple frequencies for complex, intense vibration
        const wave1 = Math.sin(time * oscillationFreq + particlePhase);
        const wave2 = Math.sin(time * oscillationFreq * 1.7 + particlePhase * 0.6) * 0.6;
        const wave3 = Math.sin(time * oscillationFreq * 0.6 + particlePhase * 1.4) * 0.4;
        const wave4 = Math.sin(time * oscillationFreq * 2.3 + particlePhase * 0.3) * 0.3; // Extra high freq
        const combinedWave = (wave1 + wave2 + wave3 + wave4) / 2.3;
        
        // Calculate radial direction (outward from center)
        const dist = Math.sqrt(rotatedX * rotatedX + rotatedY * rotatedY + rotatedZ * rotatedZ) || 1;
        const nx = rotatedX / dist;
        const ny = rotatedY / dist;
        const nz = rotatedZ / dist;
        
        // Apply intense oscillation - particles vibrate in/out along radial direction
        const oscillationOffset = combinedWave * oscillationAmplitude;
        rotatedX += nx * oscillationOffset;
        rotatedY += ny * oscillationOffset;
        rotatedZ += nz * oscillationOffset;
      }

      // Direct position calculation - snappy response
      const finalX = rotatedX + targetCenterX - cx + noiseX;
      const finalY = rotatedY + targetCenterY - cy + noiseY;
      const finalZ = rotatedZ + noiseZ;
      
      // Smooth interpolation to target
      const smoothing = 0.15;
      p.x += (finalX - p.x) * smoothing;
      p.y += (finalY - p.y) * smoothing;
      p.z += (finalZ - p.z) * smoothing;

      // === MIRA VOICE: Original distortion effect ===
      // Velocity-based push from rotating distortion points
      if (miraSpeaking) {
        const scale = Z_PERSPECTIVE / (Z_PERSPECTIVE + p.z);
        const screenX = cx + p.x * scale;
        const screenY = cy + p.y * scale;

        // Multiple distortion points rotating around sphere
        const numPoints = 4;
        for (let i = 0; i < numPoints; i++) {
          const pointAngle = voiceAngle + (i * Math.PI * 2 / numPoints);
          
          // Distortion points around the particle's sphere center
          const distortX = targetCenterX + Math.cos(pointAngle) * voiceDistortRadius * dpr;
          const distortY = targetCenterY + Math.sin(pointAngle) * voiceDistortRadius * dpr;

          const dx = screenX - distortX;
          const dy = screenY - distortY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Interaction radius - dynamically scales with audio level
          const baseInteractionRadius = radius * dpr * 0.5;
          const audioBoost = currentMiraAudioLevel * 1.5;
          const interactionRadius = baseInteractionRadius * (1 + audioBoost);

          if (dist < interactionRadius && dist > 0) {
            const force = (interactionRadius - dist) / interactionRadius;
            const angle = Math.atan2(dy, dx);

            // Force intensity dynamically mapped to audio level
            const baseForce = 80;
            const audioMultiplier = 1 + Math.pow(currentMiraAudioLevel, 0.7) * 3;
            const dynamicForce = baseForce * audioMultiplier;
            const voiceForce = force * dynamicForce;
            
            p.vx += Math.cos(angle) * voiceForce;
            p.vy += Math.sin(angle) * voiceForce;
            p.vz += -force * voiceForce * 0.25;
          }
        }
      }

      // Apply MIRA velocity with friction
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;
      p.vx *= FRICTION;
      p.vy *= FRICTION;
      p.vz *= FRICTION;

      // Draw particle
      const finalScale = Z_PERSPECTIVE / (Z_PERSPECTIVE + p.z);
      if (p.z > -Z_PERSPECTIVE + 10 && finalScale > 0) {
        const depthAlpha = Math.min(1, Math.max(0.1, finalScale * p.alpha - p.z / 2000));
        // Boost glow: user voice = subtle, MIRA voice = bright, thinking = pulse
        const thinkingGlow = aiThinking ? thinkingPulse * 0.6 : 0;
        const userGlow = userSpeaking ? Math.min(0.4, currentUserAudioLevel * 0.5) : 0;
        const miraGlow = miraSpeaking ? Math.min(0.8, currentMiraAudioLevel * 1.0) : 0;
        const glowAlpha = depthAlpha * (1 + thinkingGlow + userGlow + miraGlow);

        // Colors based on state
        const currentState = miraStateRef.current;
        let r: number, g: number, b: number;
        
        if (currentState === 'resting') {
          // Bright red/coral when resting - easily visible
          if (p.colorType === 'mi') {
            r = 220; g = 80; b = 100; // Bright coral red
          } else {
            r = 200; g = 60; b = 80; // Bright rose red
          }
        } else if (currentState === 'listening') {
          // Bright active listening colors
          if (p.colorType === 'mi') {
            r = 180; g = 120; b = 255; // Bright purple
          } else {
            r = 120; g = 220; b = 255; // Bright cyan
          }
        } else if (currentState === 'speaking') {
          // Warm speaking colors
          if (p.colorType === 'mi') {
            r = 220; g = 100; b = 255; // Vibrant purple
          } else {
            r = 100; g = 220; b = 200; // Teal-cyan
          }
        } else {
          // Default active colors
          if (p.colorType === 'mi') {
            r = 200; g = 100; b = 255; // Purple for MI
          } else {
            r = 100; g = 200; b = 255; // Cyan for RA
          }
        }
        
        // Apply additional dimming when resting - subtle dimming only
        const stateDimming = currentState === 'resting' ? 0.75 : 1;

        const screenX = cx + p.x * finalScale;
        const screenY = cy + p.y * finalScale;
        // Scale particles: user = vibrating effect, MIRA = size pulse
        const thinkingSizeBoost = aiThinking ? 1 + thinkingPulse * 0.15 : 1;
        const userSizeBoost = userSpeaking ? 1 + currentUserAudioLevel * 0.15 : 1;
        const miraSizeBoost = miraSpeaking ? 1 + currentMiraAudioLevel * 0.3 : 1;
        // Smaller particles when resting
        const restingScale = currentState === 'resting' ? 0.85 : 1;
        const particleSize = p.size * finalScale * thinkingSizeBoost * userSizeBoost * miraSizeBoost * restingScale;

        // Draw outer glow during thinking phase
        if (aiThinking && thinkingPulse > 0.3) {
          const glowSize = particleSize * (2 + thinkingPulse * 1.5);
          const glowIntensity = thinkingPulse * 0.3;
          const gradient = ctx.createRadialGradient(screenX, screenY, particleSize * 0.5, screenX, screenY, glowSize);
          gradient.addColorStop(0, `rgba(${r},${g},${b},${glowIntensity})`);
          gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.beginPath();
          ctx.arc(screenX, screenY, glowSize, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }

        // Draw main particle
        ctx.beginPath();
        ctx.arc(screenX, screenY, particleSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, glowAlpha * stateDimming)})`;
        ctx.fill();
      }
    });

    // Draw labels
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `${16 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    
    if (progress < 0.5) {
      // Show MI and RA labels
      const labelAlpha = 1 - progress * 2;
      ctx.fillStyle = `rgba(255, 255, 255, ${labelAlpha * 0.7})`;
      ctx.fillText('MI', centers.mi.x * dpr, (centers.mi.y + radius + 40) * dpr);
      ctx.fillText('RA', centers.ra.x * dpr, (centers.ra.y + radius + 40) * dpr);
    } else {
      // Show MIRA label
      const labelAlpha = (progress - 0.5) * 2;
      ctx.fillStyle = `rgba(255, 255, 255, ${labelAlpha * 0.8})`;
      ctx.font = `bold ${20 * dpr}px system-ui, sans-serif`;
      ctx.fillText('MIRA', centers.combined.x * dpr, (centers.combined.y + radius * 1.1 + 50) * dpr);
    }

    animationRef.current = requestAnimationFrame(animate);
  }, [dimensions, getSphereCenters, getSphereRadius]);

  // Setup canvas and particles - only initialize once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    // Cap DPR for better performance
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;

    // Only initialize particles once to prevent reset on state changes
    if (!initializedRef.current) {
      initParticles();
      initializedRef.current = true;
    }
    
    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [dimensions, initParticles, animate]);

  // Reinitialize only when dimensions change significantly (window resize)
  useEffect(() => {
    if (initializedRef.current && particlesRef.current.length > 0 && dimensions.width > 0) {
      // Update canvas size without reinitializing particles - they will adapt via physics
      const canvas = canvasRef.current;
      if (canvas) {
        // Cap DPR for better performance
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = dimensions.width * dpr;
        canvas.height = dimensions.height * dpr;
      }
    }
  }, [dimensions.width, dimensions.height]);

  // Mouse event handlers
  const handleMouseMove = useCallback((e: MouseEvent) => {
    mouseRef.current = {
      x: e.clientX,
      y: e.clientY,
      isActive: true,
    };
  }, []);

  const handleMouseLeave = useCallback(() => {
    mouseRef.current.isActive = false;
  }, []);

  // Add mouse listeners to window
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [handleMouseMove, handleMouseLeave]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
