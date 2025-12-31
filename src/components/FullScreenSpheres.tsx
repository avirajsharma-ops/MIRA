'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

interface FullScreenSpheresProps {
  mode: 'separate' | 'combined';
  speakingAgent: 'mi' | 'ra' | 'mira' | null;
  isSpeaking: boolean;
  audioLevel: number;
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
  audioLevel,
}: FullScreenSpheresProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const audioLevelRef = useRef(0);
  const modeRef = useRef(mode);
  const transitionProgressRef = useRef(mode === 'combined' ? 1 : 0);
  const mouseRef = useRef({ x: 0, y: 0, isActive: false });
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  // Smooth audio level transitions
  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  // Update mode ref for animation
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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
    const particleCount = 5000; // More particles for larger screen
    const radius = getSphereRadius();
    const centers = getSphereCenters();

    for (let i = 0; i < particleCount; i++) {
      // Fibonacci sphere distribution
      const phi = Math.acos(1 - 2 * (i + 0.5) / particleCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;

      const sphereX = radius * Math.sin(phi) * Math.cos(theta);
      const sphereY = radius * Math.sin(phi) * Math.sin(theta);
      const sphereZ = radius * Math.cos(phi);

      // Assign to MI or RA based on index
      const colorType: 'mi' | 'ra' = i % 2 === 0 ? 'mi' : 'ra';
      
      // Start position based on current mode
      const center = mode === 'combined' ? centers.combined : centers[colorType];
      
      particles.push({
        targetX: sphereX,
        targetY: sphereY,
        targetZ: sphereZ,
        x: sphereX + center.x - dimensions.width / 2,
        y: sphereY + center.y - dimensions.height / 2,
        z: sphereZ,
        vx: 0,
        vy: 0,
        vz: 0,
        size: Math.random() * 2 + 1,
        alpha: Math.random() * 0.6 + 0.4,
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

    const dpr = window.devicePixelRatio || 1;
    const width = dimensions.width * dpr;
    const height = dimensions.height * dpr;
    const cx = width / 2;
    const cy = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    const time = Date.now() * 0.001;
    const currentAudioLevel = audioLevelRef.current;
    // ONLY react to audio when AI is speaking, not user voice
    const aiSpeaking = isSpeaking;
    const currentMode = modeRef.current;
    const centers = getSphereCenters();
    const radius = getSphereRadius();
    
    // Determine which agent is currently speaking (mi, ra, or mira for both)
    const currentSpeaker = speakingAgent;

    // Smooth transition between modes
    const targetProgress = currentMode === 'combined' ? 1 : 0;
    const transitionSpeed = 0.03; // Smooth transition
    if (transitionProgressRef.current < targetProgress) {
      transitionProgressRef.current = Math.min(1, transitionProgressRef.current + transitionSpeed);
    } else if (transitionProgressRef.current > targetProgress) {
      transitionProgressRef.current = Math.max(0, transitionProgressRef.current - transitionSpeed);
    }
    const progress = transitionProgressRef.current;

    // Rotation speed based on AI speaking only
    const rotationSpeed = aiSpeaking ? 0.5 : 0.25;
    const rotTime = time * rotationSpeed;

    // Physics constants
    const SPRING = 0.04;
    const FRICTION = 0.92;
    const Z_PERSPECTIVE = 1200;
    
    // Voice distortion settings
    const voiceAngle = time * 2.5;
    const voiceDistortRadius = radius * 0.4 * (1 + (aiSpeaking ? currentAudioLevel : 0));

    particlesRef.current.forEach((p) => {
      // Determine if THIS particle should react to speech
      // - If speaker is 'mira', all particles react
      // - If speaker is 'mi', only MI particles react
      // - If speaker is 'ra', only RA particles react
      const particleShouldReact = aiSpeaking && (
        currentSpeaker === 'mira' || 
        currentSpeaker === p.colorType
      );
      
      // No pulse scale - keep sphere size constant
      const pulseScale = 1;
      
      // Organic intensity - stronger for reacting particles
      const organicIntensity = 15 + (particleShouldReact ? 25 + currentAudioLevel * 40 : 0);
      
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

      // Rotation around Y axis
      let rotatedX = scaledBaseX * Math.cos(rotTime) - scaledBaseZ * Math.sin(rotTime);
      let rotatedZ = scaledBaseX * Math.sin(rotTime) + scaledBaseZ * Math.cos(rotTime);
      let rotatedY = scaledBaseY;

      // Target position (relative to center) - includes organic noise movement
      const targetX = rotatedX + targetCenterX - cx + noiseX;
      const targetY = rotatedY + targetCenterY - cy + noiseY;
      const targetZ = rotatedZ + noiseZ;

      // Spring physics towards target
      p.vx += (targetX - p.x) * SPRING;
      p.vy += (targetY - p.y) * SPRING;
      p.vz += (targetZ - p.z) * SPRING;

      // Mouse interaction - particles repel from cursor
      const mouse = mouseRef.current;
      if (mouse.isActive) {
        const scale = Z_PERSPECTIVE / (Z_PERSPECTIVE + p.z);
        const screenX = cx + p.x * scale;
        const screenY = cy + p.y * scale;
        
        const dx = screenX - mouse.x * dpr;
        const dy = screenY - mouse.y * dpr;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mouseRadius = radius * dpr * 0.8;
        
        if (dist < mouseRadius && dist > 0) {
          const force = (mouseRadius - dist) / mouseRadius;
          const angle = Math.atan2(dy, dx);
          
          const mouseForce = force * 200;
          p.vx += Math.cos(angle) * mouseForce;
          p.vy += Math.sin(angle) * mouseForce;
          p.vz += -force * mouseForce * 0.3;
        }
      }

      // Voice/Speaking distortion - ONLY for particles belonging to speaking agent
      if (particleShouldReact) {
        const scale = Z_PERSPECTIVE / (Z_PERSPECTIVE + p.z);
        const screenX = cx + p.x * scale;
        const screenY = cy + p.y * scale;

        // Multiple distortion points rotating around sphere
        const numPoints = 4;
        for (let i = 0; i < numPoints; i++) {
          const pointAngle = voiceAngle + (i * Math.PI * 2 / numPoints);
          
          // Distortion points around the particle's sphere center
          const distortCenterX = targetCenterX;
          const distortCenterY = targetCenterY;
          const distortX = distortCenterX + Math.cos(pointAngle) * voiceDistortRadius * dpr;
          const distortY = distortCenterY + Math.sin(pointAngle) * voiceDistortRadius * dpr;

          const dx = screenX - distortX;
          const dy = screenY - distortY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Interaction radius - based on AI audio level
          const baseInteractionRadius = radius * dpr * 0.6;
          const audioBoost = currentAudioLevel;
          const interactionRadius = baseInteractionRadius * (1 + audioBoost);

          if (dist < interactionRadius && dist > 0) {
            const force = (interactionRadius - dist) / interactionRadius;
            const angle = Math.atan2(dy, dx);

            // Force intensity based on AI audio level
            const forceIntensity = 0.4 + currentAudioLevel * 0.6;
            const voiceForce = force * 150 * forceIntensity;
            p.vx += Math.cos(angle) * voiceForce;
            p.vy += Math.sin(angle) * voiceForce;
            p.vz += -force * voiceForce * 0.3;
          }
        }
      }

      // Apply velocity with friction
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
        // Only boost glow for particles belonging to speaking agent
        const glowAlpha = particleShouldReact ? depthAlpha * (1.5 + currentAudioLevel * 0.8) : depthAlpha;

        // Colors
        const { r, g, b } = p.colorType === 'mi'
          ? { r: 200, g: 100, b: 255 } // Purple for MI
          : { r: 100, g: 200, b: 255 }; // Cyan for RA

        const screenX = cx + p.x * finalScale;
        const screenY = cy + p.y * finalScale;
        // Only scale particles for speaking agent
        const particleSize = p.size * finalScale * (particleShouldReact ? 1 + currentAudioLevel * 0.3 : 1);

        ctx.beginPath();
        ctx.arc(screenX, screenY, particleSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, glowAlpha)})`;
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
  }, [dimensions, getSphereCenters, getSphereRadius, isSpeaking]);

  // Setup canvas and particles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;

    initParticles();
    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [dimensions, initParticles, animate]);

  // Reinitialize when dimensions change significantly
  useEffect(() => {
    if (particlesRef.current.length > 0 && dimensions.width > 0) {
      initParticles();
    }
  }, [dimensions.width, dimensions.height, initParticles]);

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
