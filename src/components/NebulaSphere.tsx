'use client';

import { useEffect, useRef, useCallback } from 'react';

interface NebulaSphereProps {
  agent: 'mi' | 'ra';
  isSpeaking: boolean;
  isActive: boolean;
  size?: number;
  audioLevel?: number; // 0-1, voice intensity for particle distortion
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
}

export default function NebulaSphere({
  agent,
  isSpeaking,
  isActive,
  size = 300,
  audioLevel = 0,
}: NebulaSphereProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const mouseRef = useRef({ x: 0, y: 0, isActive: false });
  const audioLevelRef = useRef(0);
  
  // Smooth audio level transitions
  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  // Agent-specific colors
  const getColor = useCallback(() => {
    if (agent === 'mi') {
      // Purple/pink for MI (emotional, feminine)
      return { r: 200, g: 100, b: 255 };
    } else {
      // Cyan/blue for RA (logical, masculine)
      return { r: 100, g: 200, b: 255 };
    }
  }, [agent]);

  // Initialize particles
  const initParticles = useCallback(() => {
    const particles: Particle[] = [];
    const particleCount = 2500;
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
        size: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.5 + 0.5,
      });
    }

    particlesRef.current = particles;
  }, [size]);

  // Animation loop
  const animate = useCallback(() => {
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

    const { r, g, b } = getColor();
    const time = Date.now() * 0.001;
    
    // Get current audio level for voice-reactive animation
    const currentAudioLevel = audioLevelRef.current;
    const voiceActive = currentAudioLevel > 0.05; // Threshold for voice activity

    // Faster rotation when speaking or voice active
    const rotationSpeed = (isSpeaking || voiceActive) ? 0.8 : 0.4;
    const rotTime = time * rotationSpeed;

    // Pulse effect based on voice intensity
    const voicePulse = voiceActive ? currentAudioLevel * 0.15 : 0;
    const pulseScale = isSpeaking ? 1 + Math.sin(time * 8) * 0.1 : 1 + voicePulse;

    // Constants - voice-reactive warp strength
    const SPRING = (isSpeaking || voiceActive) ? 0.08 : 0.05;
    const FRICTION = 0.9;
    const Z_PERSPECTIVE = 800;
    const interactionRadius = size * 0.6;
    
    // Base warp strength increased by voice level (mapped to intensity)
    const baseWarpStrength = isSpeaking ? 200 : 150;
    const voiceWarpBoost = currentAudioLevel * 300; // Voice adds up to 300 more warp
    const warpStrength = baseWarpStrength + voiceWarpBoost;

    const mouse = mouseRef.current;
    const mouseRelX = mouse.x - cx;
    const mouseRelY = mouse.y - cy;
    const rotX = mouse.isActive ? mouseRelY * 0.0001 : 0;
    const rotY = mouse.isActive ? mouseRelX * 0.0001 : 0;
    
    // Voice-reactive distortion - simulate interaction from center with oscillating angle
    const voiceDistortionActive = voiceActive && !mouse.isActive;
    const voiceAngle = time * 3; // Rotating distortion point
    const voiceDistortRadius = size * 0.3 * (1 + currentAudioLevel);

    particlesRef.current.forEach((p) => {
      // Apply pulse scale to base positions
      const scaledBaseX = p.baseX * pulseScale;
      const scaledBaseY = p.baseY * pulseScale;
      const scaledBaseZ = p.baseZ * pulseScale;

      // Rotation
      let tx = scaledBaseX * Math.cos(rotTime) - scaledBaseZ * Math.sin(rotTime);
      let tz = scaledBaseX * Math.sin(rotTime) + scaledBaseZ * Math.cos(rotTime);
      let ty = scaledBaseY;

      // Mouse tilt
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

      // Physics
      p.vx += (tx - p.x) * SPRING;
      p.vy += (ty - p.y) * SPRING;
      p.vz += (tz - p.z) * SPRING;

      // Interaction
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

          // Repel effect
          const fx = Math.cos(angle) * force * warpStrength;
          const fy = Math.sin(angle) * force * warpStrength;
          const fz = -force * warpStrength * 0.5;

          p.vx += fx;
          p.vy += fy;
          p.vz += fz;
        }
      }
      
      // Voice-reactive distortion (when not using mouse)
      if (voiceDistortionActive) {
        // Create multiple distortion points that move with voice
        const numPoints = 3;
        for (let i = 0; i < numPoints; i++) {
          const pointAngle = voiceAngle + (i * Math.PI * 2 / numPoints);
          const distortX = cx + Math.cos(pointAngle) * voiceDistortRadius;
          const distortY = cy + Math.sin(pointAngle) * voiceDistortRadius;
          
          const dx = sx - distortX;
          const dy = sy - distortY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          const voiceInteractionRadius = interactionRadius * (0.5 + currentAudioLevel);
          
          if (dist < voiceInteractionRadius) {
            const force = (voiceInteractionRadius - dist) / voiceInteractionRadius;
            const angle = Math.atan2(dy, dx);
            
            // Voice-based repel effect - intensity mapped to audio level
            const voiceForce = force * warpStrength * currentAudioLevel * 0.5;
            const fx = Math.cos(angle) * voiceForce;
            const fy = Math.sin(angle) * voiceForce;
            const fz = -force * voiceForce * 0.3;
            
            p.vx += fx;
            p.vy += fy;
            p.vz += fz;
          }
        }
      }

      // Apply velocity
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;
      p.vx *= FRICTION;
      p.vy *= FRICTION;
      p.vz *= FRICTION;

      // Draw - voice enhances glow
      const finalScale = Z_PERSPECTIVE / (Z_PERSPECTIVE + p.z);
      if (p.z > -Z_PERSPECTIVE + 10 && finalScale > 0) {
        const alpha = Math.min(1, Math.max(0.1, finalScale * p.alpha - p.z / 1000));
        const voiceGlowBoost = voiceActive ? (1 + currentAudioLevel * 0.8) : 1;
        const glowAlpha = isSpeaking ? alpha * 1.5 : alpha * voiceGlowBoost;

        ctx.beginPath();
        ctx.arc(
          cx + p.x * finalScale,
          cy + p.y * finalScale,
          p.size * finalScale * (isSpeaking ? 1.2 : (1 + currentAudioLevel * 0.3)),
          0,
          Math.PI * 2
        );
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, glowAlpha)})`;
        ctx.fill();
      }
    });

    animationRef.current = requestAnimationFrame(animate);
  }, [getColor, isSpeaking, size]);

  // Setup
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

  // Mouse events
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
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/70 text-sm font-medium uppercase tracking-wider">
        {agent.toUpperCase()}
      </div>
    </div>
  );
}
