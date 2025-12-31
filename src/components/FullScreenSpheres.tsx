'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

interface FullScreenSpheresProps {
  mode: 'separate' | 'combined';
  speakingAgent: 'mi' | 'ra' | 'mira' | null;
  isSpeaking: boolean;
  audioLevel: number;
  isThinking?: boolean;
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
  isThinking = false,
}: FullScreenSpheresProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const audioLevelRef = useRef(0);
  const modeRef = useRef(mode);
  const transitionProgressRef = useRef(mode === 'combined' ? 1 : 0);
  const mouseRef = useRef({ x: 0, y: 0, isActive: false });
  const isSpeakingRef = useRef(isSpeaking);
  const isThinkingRef = useRef(isThinking);
  const speakingAgentRef = useRef(speakingAgent);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const initializedRef = useRef(false);
  
  // Smooth audio level transitions - use refs to avoid callback recreation
  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  // Update mode ref for animation
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Update speaking state refs
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    speakingAgentRef.current = speakingAgent;
  }, [speakingAgent]);

  // Update thinking state ref
  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

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
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

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
    // ONLY react to audio when AI is speaking, not user voice - use refs for continuous animation
    const aiSpeaking = isSpeakingRef.current;
    const aiThinking = isThinkingRef.current;
    const currentMode = modeRef.current;
    const centers = getSphereCenters();
    const radius = getSphereRadius();
    
    // Determine which agent is currently speaking (mi, ra, or mira for both) - use ref
    const currentSpeaker = speakingAgentRef.current;

    // Thinking animation - subtle pulsing glow effect
    const thinkingPulse = aiThinking ? Math.sin(time * 3) * 0.3 + 0.7 : 0; // 0 to 1 pulse

    // Smooth transition between modes
    const targetProgress = currentMode === 'combined' ? 1 : 0;
    const transitionSpeed = 0.03; // Smooth transition
    if (transitionProgressRef.current < targetProgress) {
      transitionProgressRef.current = Math.min(1, transitionProgressRef.current + transitionSpeed);
    } else if (transitionProgressRef.current > targetProgress) {
      transitionProgressRef.current = Math.max(0, transitionProgressRef.current - transitionSpeed);
    }
    const progress = transitionProgressRef.current;

    // Rotation speed based on AI speaking or thinking
    const rotationSpeed = aiSpeaking ? 0.5 : aiThinking ? 0.35 : 0.25;
    const rotTime = time * rotationSpeed;

    // Physics constants - softer spring and higher friction for smoother movement
    const SPRING = 0.025;
    const FRICTION = 0.88;
    const Z_PERSPECTIVE = 1200;
    
    // Voice distortion settings - dynamically mapped to audio level
    const baseVoiceSpeed = 2.0;
    const voiceSpeedBoost = currentAudioLevel * 1.5; // Faster rotation at higher volumes
    const voiceAngle = time * (baseVoiceSpeed + voiceSpeedBoost);
    const voiceDistortRadius = radius * (0.3 + currentAudioLevel * 0.4); // Grows with volume

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
      
      // Organic intensity - stronger for reacting particles, subtle movement during thinking
      const thinkingBoost = aiThinking ? 8 + thinkingPulse * 12 : 0;
      const organicIntensity = 15 + thinkingBoost + (particleShouldReact ? 25 + currentAudioLevel * 40 : 0);
      
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

      // Spring physics towards target - use softer spring to prevent sudden jumps
      const springForce = SPRING;
      p.vx += (targetX - p.x) * springForce;
      p.vy += (targetY - p.y) * springForce;
      p.vz += (targetZ - p.z) * springForce;
      
      // Clamp velocity to prevent extreme stretching/zooming
      const maxVelocity = 25;
      p.vx = Math.max(-maxVelocity, Math.min(maxVelocity, p.vx));
      p.vy = Math.max(-maxVelocity, Math.min(maxVelocity, p.vy));
      p.vz = Math.max(-maxVelocity, Math.min(maxVelocity, p.vz));

      // Mouse interaction - particles repel from cursor (reduced force)
      const mouse = mouseRef.current;
      if (mouse.isActive) {
        const scale = Z_PERSPECTIVE / (Z_PERSPECTIVE + p.z);
        const screenX = cx + p.x * scale;
        const screenY = cy + p.y * scale;
        
        const dx = screenX - mouse.x * dpr;
        const dy = screenY - mouse.y * dpr;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mouseRadius = radius * dpr * 0.6;
        
        if (dist < mouseRadius && dist > 0) {
          const force = (mouseRadius - dist) / mouseRadius;
          const angle = Math.atan2(dy, dx);
          
          const mouseForce = force * 60;
          p.vx += Math.cos(angle) * mouseForce;
          p.vy += Math.sin(angle) * mouseForce;
          p.vz += -force * mouseForce * 0.15;
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

          // Interaction radius - dynamically scales with audio level
          const baseInteractionRadius = radius * dpr * 0.5;
          const audioBoost = currentAudioLevel * 1.5; // More responsive to audio
          const interactionRadius = baseInteractionRadius * (1 + audioBoost);

          if (dist < interactionRadius && dist > 0) {
            const force = (interactionRadius - dist) / interactionRadius;
            const angle = Math.atan2(dy, dx);

            // Force intensity dynamically mapped to audio level
            // Base force when speaking + exponential boost based on volume
            const baseForce = 80;
            const audioMultiplier = 1 + Math.pow(currentAudioLevel, 0.7) * 3; // Exponential response
            const dynamicForce = baseForce * audioMultiplier;
            const voiceForce = force * dynamicForce;
            
            p.vx += Math.cos(angle) * voiceForce;
            p.vy += Math.sin(angle) * voiceForce;
            p.vz += -force * voiceForce * 0.25;
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
        // Boost glow for speaking particles, enhanced glow during thinking
        const thinkingGlow = aiThinking ? thinkingPulse * 0.6 : 0;
        const glowAlpha = particleShouldReact 
          ? depthAlpha * (1.5 + currentAudioLevel * 0.8) 
          : depthAlpha * (1 + thinkingGlow);

        // Colors
        const { r, g, b } = p.colorType === 'mi'
          ? { r: 200, g: 100, b: 255 } // Purple for MI
          : { r: 100, g: 200, b: 255 }; // Cyan for RA

        const screenX = cx + p.x * finalScale;
        const screenY = cy + p.y * finalScale;
        // Scale particles for speaking agent, subtle pulse during thinking
        const thinkingSizeBoost = aiThinking ? 1 + thinkingPulse * 0.15 : 1;
        const particleSize = p.size * finalScale * thinkingSizeBoost * (particleShouldReact ? 1 + currentAudioLevel * 0.3 : 1);

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
  }, [dimensions, getSphereCenters, getSphereRadius]);

  // Setup canvas and particles - only initialize once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const dpr = window.devicePixelRatio || 1;
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
        const dpr = window.devicePixelRatio || 1;
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
