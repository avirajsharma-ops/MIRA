'use client';

import { useEffect, useRef, useCallback } from 'react';

export type MIRAState = 'resting' | 'active' | 'listening' | 'speaking' | 'thinking';

interface MIRACombinedSphereProps {
  isSpeaking: boolean;
  size?: number;
  audioLevel?: number; // Now properly receives MIRA's output audio level when speaking
  miraState?: MIRAState; // MIRA's current state for visual feedback
}

interface Particle {
  baseX: number;
  baseY: number;
  baseZ: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  alpha: number;
  colorType: 'mi' | 'ra';
}

export default function MIRACombinedSphere({
  isSpeaking,
  size = 400,
  audioLevel = 0, // Receives proper MIRA output level from context
  miraState = 'active', // Default to active
}: MIRACombinedSphereProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const mouseRef = useRef({ x: 0, y: 0, isActive: false });
  const audioLevelRef = useRef(0);
  const miraStateRef = useRef<MIRAState>('active');
  
  // Update refs when props change
  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);
  
  useEffect(() => {
    miraStateRef.current = miraState;
  }, [miraState]);

  // Initialize particles with mixed colors - OPTIMIZED for performance
  const initParticles = useCallback(() => {
    const particles: Particle[] = [];
    // Reduced particle count for better performance (was 4000, now 1200)
    const particleCount = 1200;
    const baseRadius = size * 0.4;

    for (let i = 0; i < particleCount; i++) {
      const phi = Math.acos(1 - 2 * (i + 0.5) / particleCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;

      const x = baseRadius * Math.sin(phi) * Math.cos(theta);
      const y = baseRadius * Math.sin(phi) * Math.sin(theta);
      const z = baseRadius * Math.cos(phi);

      particles.push({
        baseX: x,
        baseY: y,
        baseZ: z,
        x,
        y,
        z,
        vx: 0,
        vy: 0,
        vz: 0,
        size: Math.random() * 2.5 + 1.2, // Slightly larger particles to compensate for fewer
        alpha: Math.random() * 0.6 + 0.4,
        colorType: Math.random() > 0.5 ? 'mi' : 'ra', // Mixed colors
      });
    }

    particlesRef.current = particles;
  }, [size]);

  // Track last frame time for throttling
  const lastFrameTimeRef = useRef(0);
  const targetFPS = 30; // Throttle to 30 FPS for better performance
  const frameInterval = 1000 / targetFPS;

  const animate = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastFrameTimeRef.current;
    
    // Throttle frame rate
    if (elapsed < frameInterval) {
      animationRef.current = requestAnimationFrame(animate);
      return;
    }
    lastFrameTimeRef.current = now - (elapsed % frameInterval);

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    const time = now * 0.001;
    const currentAudioLevel = audioLevelRef.current;
    const voiceActive = currentAudioLevel > 0.05;
    const currentState = miraStateRef.current;
    
    // Rotation speed based on state
    let baseSpeed = 0.25;
    if (currentState === 'resting') {
      baseSpeed = 0.08; // Very slow rotation when resting - sleeping orb
    } else if (currentState === 'listening') {
      baseSpeed = 0.35; // Slightly faster when listening
    } else if (currentState === 'speaking' || isSpeaking || voiceActive) {
      baseSpeed = 0.4; // Faster when speaking
    }
    const rotationSpeed = baseSpeed;
    const rotTime = time * rotationSpeed;
    
    // No pulse/zoom effect - keep sphere size constant for stability
    const pulseScale = 1;

    // Spring stiffness and friction based on state
    const SPRING = currentState === 'resting' ? 0.03 : (isSpeaking || voiceActive) ? 0.08 : 0.06;
    const FRICTION = currentState === 'resting' ? 0.95 : 0.88; // More friction when resting for calmer movement
    const Z_PERSPECTIVE = 800;
    const interactionRadius = size * 0.5; // Reduced interaction radius
    
    // Reduced warp strength for stability
    const baseWarpStrength = isSpeaking ? 120 : 100;
    const voiceWarpBoost = currentAudioLevel * 150; // Reduced from 250
    const warpStrength = baseWarpStrength + voiceWarpBoost;

    const mouse = mouseRef.current;
    const mouseRelX = mouse.x - cx;
    const mouseRelY = mouse.y - cy;
    const rotX = mouse.isActive ? mouseRelY * 0.0001 : 0;
    const rotY = mouse.isActive ? mouseRelX * 0.0001 : 0;
    
    // Voice distortion - smoother and more stable
    const voiceDistortionActive = voiceActive && !mouse.isActive;
    const voiceAngle = time * 2; // Slower rotation for stability
    const voiceDistortRadius = size * 0.25 * (1 + currentAudioLevel * 0.5); // Reduced range

    particlesRef.current.forEach((p) => {
      const scaledBaseX = p.baseX * pulseScale;
      const scaledBaseY = p.baseY * pulseScale;
      const scaledBaseZ = p.baseZ * pulseScale;

      let tx = scaledBaseX * Math.cos(rotTime) - scaledBaseZ * Math.sin(rotTime);
      let tz = scaledBaseX * Math.sin(rotTime) + scaledBaseZ * Math.cos(rotTime);
      let ty = scaledBaseY;

      if (mouse.isActive) {
        let mx = tx * Math.cos(rotY) - tz * Math.sin(rotY);
        let mz = tx * Math.sin(rotY) + tz * Math.cos(rotY);
        tx = mx;
        tz = mz;
        let my = ty * Math.cos(rotX) - tz * Math.sin(rotX);
        mz = ty * Math.sin(rotX) + tz * Math.cos(rotX);
        ty = my;
        tz = mz;
      }

      p.vx += (tx - p.x) * SPRING;
      p.vy += (ty - p.y) * SPRING;
      p.vz += (tz - p.z) * SPRING;

      const scale = Z_PERSPECTIVE / (Z_PERSPECTIVE + p.z);
      const sx = cx + p.x * scale;
      const sy = cy + p.y * scale;

      if (mouse.isActive) {
        const dx = sx - mouse.x;
        const dy = sy - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < interactionRadius) {
          const force = (interactionRadius - dist) / interactionRadius;
          const angle = Math.atan2(dy, dx);

          const fx = Math.cos(angle) * force * warpStrength;
          const fy = Math.sin(angle) * force * warpStrength;
          const fz = -force * warpStrength * 0.5;

          p.vx += fx;
          p.vy += fy;
          p.vz += fz;
        }
      }
      
      // Voice-reactive distortion - reduced to 2 points for performance
      if (voiceDistortionActive) {
        const numPoints = 2;
        for (let i = 0; i < numPoints; i++) {
          const pointAngle = voiceAngle + (i * Math.PI);
          const distortX = cx + Math.cos(pointAngle) * voiceDistortRadius;
          const distortY = cy + Math.sin(pointAngle) * voiceDistortRadius;
          
          const dx = sx - distortX;
          const dy = sy - distortY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          const voiceInteractionRadius = interactionRadius * (0.4 + currentAudioLevel);
          
          if (dist < voiceInteractionRadius) {
            const force = (voiceInteractionRadius - dist) / voiceInteractionRadius;
            const angle = Math.atan2(dy, dx);
            
            const voiceForce = force * warpStrength * currentAudioLevel * 0.5;
            const fx = Math.cos(angle) * voiceForce;
            const fy = Math.sin(angle) * voiceForce;
            const fz = -force * voiceForce * 0.25;
            
            p.vx += fx;
            p.vy += fy;
            p.vz += fz;
          }
        }
      }

      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;
      p.vx *= FRICTION;
      p.vy *= FRICTION;
      p.vz *= FRICTION;

      const finalScale = Z_PERSPECTIVE / (Z_PERSPECTIVE + p.z);
      if (p.z > -Z_PERSPECTIVE + 10 && finalScale > 0) {
        const alpha = Math.min(1, Math.max(0.1, finalScale * p.alpha - p.z / 1000));
        const voiceGlowBoost = voiceActive ? (1 + currentAudioLevel * 0.6) : 1;
        const glowAlpha = isSpeaking ? alpha * 1.3 : alpha * voiceGlowBoost;
        
        // Colors based on state and particle type
        const currentState = miraStateRef.current;
        let r: number, g: number, b: number;
        
        if (currentState === 'resting') {
          // Dimmed, dark red/maroon when resting
          if (p.colorType === 'mi') {
            r = 120; g = 40; b = 80; // Dark magenta
          } else {
            r = 80; g = 40; b = 60; // Dark burgundy
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
        
        // Apply additional dimming when resting
        const stateDimming = currentState === 'resting' ? 0.5 : 1;

        ctx.beginPath();
        ctx.arc(
          cx + p.x * finalScale,
          cy + p.y * finalScale,
          p.size * finalScale * (1 + currentAudioLevel * 0.25),
          0,
          Math.PI * 2
        );
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, glowAlpha * stateDimming)})`;
        ctx.fill();
      }
    });

    animationRef.current = requestAnimationFrame(animate);
  }, [isSpeaking, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    initParticles();
    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [size, initParticles, animate]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const dpr = window.devicePixelRatio || 1;
    mouseRef.current = {
      x: (e.clientX - rect.left) * dpr,
      y: (e.clientY - rect.top) * dpr,
      isActive: true,
    };
  };

  const handleMouseLeave = () => {
    mouseRef.current.isActive = false;
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          width: size,
          height: size,
        }}
        className="cursor-pointer"
      />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-lg font-bold uppercase tracking-widest">
        MIRA
      </div>
    </div>
  );
}
