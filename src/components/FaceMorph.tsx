'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export type MIRAState = 'resting' | 'active' | 'listening' | 'speaking' | 'thinking';

interface FaceMorphProps {
  miraAudioLevel?: number;
  userAudioLevel?: number;
  miraState?: MIRAState;
  isSpeaking?: boolean;
}

// Hot landmarks for visual emphasis
const HOT = new Set([
  // lips
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308,
  // eyes
  33, 133, 159, 145, 263, 362, 386, 374,
  // brows
  70, 63, 105, 66, 107, 300, 293, 334, 296, 336,
  // nose
  1, 2, 4, 5, 6, 19, 168, 197, 195, 94, 164
]);

const EXTRA_HOT = new Set([61, 291, 13, 14, 33, 263, 159, 145, 386, 374, 1, 4, 168]);

const LM_COUNT = 468;

// Face mesh triangles for interpolation
const FACE_TRIANGLES = [
  // Forehead
  [10, 109, 67], [10, 67, 103], [10, 103, 54], [10, 54, 21], [10, 21, 162],
  [10, 338, 297], [10, 297, 332], [10, 332, 284], [10, 284, 301], [10, 301, 389],
  [109, 69, 67], [338, 299, 297], [67, 69, 104], [297, 299, 333],
  [67, 104, 103], [297, 333, 332], [103, 104, 68], [332, 333, 298],
  [103, 68, 54], [332, 298, 284], [54, 68, 63], [284, 298, 293],
  [54, 63, 21], [284, 293, 301], [21, 63, 70], [301, 293, 300],
  [21, 70, 162], [301, 300, 389], [162, 70, 139], [389, 300, 368],
  [69, 108, 104], [299, 337, 333], [104, 108, 151], [333, 337, 151],
  [104, 151, 68], [333, 151, 298], [68, 151, 71], [298, 151, 301],
  [68, 71, 63], [298, 301, 293], [63, 71, 70], [293, 301, 300], [70, 71, 139], [300, 301, 368],
  // Temples & upper cheeks
  [162, 139, 127], [389, 368, 356], [127, 139, 34], [356, 368, 264],
  [127, 34, 227], [356, 264, 447], [227, 34, 143], [447, 264, 372],
  [227, 143, 116], [447, 372, 345], [116, 143, 111], [345, 372, 340],
  [116, 111, 117], [345, 340, 346], [117, 111, 118], [346, 340, 347],
  [118, 111, 119], [347, 340, 348], [119, 111, 120], [348, 340, 349],
  // Left eye region
  [33, 246, 161], [33, 161, 160], [33, 160, 159], [33, 159, 158], [33, 158, 157],
  [33, 157, 173], [33, 173, 133], [33, 133, 155], [33, 155, 154], [33, 154, 153],
  [33, 153, 145], [33, 145, 144], [33, 144, 163], [33, 163, 7], [33, 7, 246],
  [246, 7, 163], [163, 144, 145], [145, 153, 154], [154, 155, 133],
  [133, 173, 157], [157, 158, 159], [159, 160, 161], [161, 246, 7],
  [70, 63, 105], [63, 68, 105], [68, 104, 105], [104, 69, 108],
  [105, 66, 107], [107, 55, 65], [65, 52, 53], [53, 46, 124],
  // Right eye region
  [263, 466, 388], [263, 388, 387], [263, 387, 386], [263, 386, 385], [263, 385, 384],
  [263, 384, 398], [263, 398, 362], [263, 362, 382], [263, 382, 381], [263, 381, 380],
  [263, 380, 374], [263, 374, 373], [263, 373, 390], [263, 390, 249], [263, 249, 466],
  [466, 249, 390], [390, 373, 374], [374, 380, 381], [381, 382, 362],
  [362, 398, 384], [384, 385, 386], [386, 387, 388], [388, 466, 249],
  [300, 293, 334], [293, 298, 334], [298, 333, 334], [333, 299, 337],
  [334, 296, 336], [336, 285, 295], [295, 282, 283], [283, 276, 353],
  // Nose
  [6, 168, 197], [6, 197, 195], [6, 195, 5], [5, 4, 1], [1, 2, 98], [1, 98, 327], [1, 327, 2],
  [168, 6, 122], [168, 122, 196], [168, 196, 3], [168, 3, 248], [168, 248, 419], [168, 419, 351], [168, 351, 6],
  [122, 6, 188], [351, 6, 412], [188, 6, 114], [412, 6, 343],
  [114, 6, 217], [343, 6, 437], [217, 6, 198], [437, 6, 420],
  [4, 5, 51], [4, 51, 45], [4, 45, 275], [4, 275, 281], [4, 281, 5],
  [51, 5, 195], [281, 5, 195], [45, 51, 134], [275, 281, 363],
  [134, 51, 220], [363, 281, 440], [220, 51, 48], [440, 281, 278],
  [48, 51, 115], [278, 281, 344],
  [102, 48, 64], [331, 278, 294], [64, 48, 219], [294, 278, 439],
  [219, 48, 218], [439, 278, 438], [218, 48, 79], [438, 278, 309],
  // Cheeks
  [116, 117, 123], [116, 123, 50], [50, 123, 101], [101, 123, 36],
  [36, 123, 47], [36, 47, 126], [126, 47, 100], [100, 47, 121],
  [121, 47, 114], [114, 47, 188],
  [50, 101, 36], [36, 101, 206], [206, 101, 207], [207, 101, 187],
  [187, 101, 147], [147, 101, 213], [213, 101, 192], [192, 101, 214],
  [132, 93, 234], [132, 234, 127], [132, 127, 162],
  [132, 162, 21], [132, 21, 54], [132, 54, 103],
  [58, 132, 172], [172, 132, 136], [136, 132, 150],
  [150, 132, 149], [149, 132, 176], [176, 132, 148],
  [345, 346, 352], [345, 352, 280], [280, 352, 330], [330, 352, 266],
  [266, 352, 277], [266, 277, 355], [355, 277, 329], [329, 277, 350],
  [350, 277, 343], [343, 277, 412],
  [280, 330, 266], [266, 330, 426], [426, 330, 427], [427, 330, 411],
  [411, 330, 376], [376, 330, 433], [433, 330, 416], [416, 330, 434],
  [361, 323, 454], [361, 454, 356], [361, 356, 389],
  [361, 389, 301], [361, 301, 284], [361, 284, 332],
  [288, 361, 397], [397, 361, 367], [367, 361, 379],
  [379, 361, 378], [378, 361, 400], [400, 361, 377],
  // Mouth
  [61, 185, 40], [40, 185, 39], [39, 185, 37], [37, 185, 0],
  [291, 409, 270], [270, 409, 269], [269, 409, 267], [267, 409, 0],
  [0, 37, 267], [37, 39, 269], [39, 40, 270],
  [37, 0, 267], [0, 11, 267], [0, 12, 11], [267, 11, 302],
  [61, 40, 39], [291, 270, 269],
  [61, 146, 91], [91, 146, 181], [181, 146, 84], [84, 146, 17],
  [291, 375, 321], [321, 375, 405], [405, 375, 314], [314, 375, 17],
  [17, 84, 314], [84, 181, 405], [181, 91, 321],
  [78, 191, 80], [80, 191, 81], [81, 191, 82], [82, 191, 13],
  [308, 415, 310], [310, 415, 311], [311, 415, 312], [312, 415, 13],
  [13, 82, 312],
  [78, 95, 88], [88, 95, 178], [178, 95, 87], [87, 95, 14],
  [308, 324, 318], [318, 324, 402], [402, 324, 317], [317, 324, 14],
  [14, 87, 317],
  [61, 91, 78], [78, 91, 88], [291, 321, 308], [308, 321, 318],
  // Chin & jaw
  [152, 148, 176], [152, 176, 149], [152, 149, 150], [152, 150, 136],
  [152, 377, 400], [152, 400, 378], [152, 378, 379], [152, 379, 367],
  [152, 136, 172], [152, 172, 58], [152, 58, 132],
  [152, 367, 397], [152, 397, 288], [152, 288, 361],
  [152, 175, 199], [152, 199, 200], [152, 200, 421], [152, 421, 396], [152, 396, 175],
  [175, 171, 152], [396, 391, 152],
  [132, 58, 172], [172, 58, 138], [138, 58, 135], [135, 58, 169],
  [169, 58, 170], [170, 58, 140], [140, 58, 171], [171, 58, 175],
  [361, 288, 397], [397, 288, 367], [367, 288, 364], [364, 288, 394],
  [394, 288, 395], [395, 288, 369], [369, 288, 391], [391, 288, 396],
];

// Landmark weights for density distribution
const LANDMARK_WEIGHTS: Record<number, number> = {
  // Lips - heavy emphasis
  61: 4, 146: 3, 91: 3, 181: 3, 84: 3, 17: 4, 314: 3, 405: 3, 321: 3, 375: 3, 291: 4,
  78: 4, 95: 3, 88: 3, 178: 3, 87: 3, 14: 4, 317: 3, 402: 3, 318: 3, 324: 3, 308: 4,
  // Eyes - heavy emphasis
  33: 4, 133: 4, 159: 3, 145: 3, 263: 4, 362: 4, 386: 3, 374: 3,
  246: 3, 161: 2, 160: 2, 158: 2, 157: 2, 173: 2, 155: 2, 154: 2, 153: 2,
  466: 3, 388: 2, 387: 2, 385: 2, 384: 2, 398: 2, 382: 2, 381: 2, 380: 2,
  // Eyebrows
  70: 2, 63: 2, 105: 2, 66: 2, 107: 2, 300: 2, 293: 2, 334: 2, 296: 2, 336: 2,
  // Nose
  1: 3, 2: 2, 4: 3, 5: 2, 6: 3, 168: 2, 197: 2, 195: 2,
  // Face outline
  10: 2, 109: 2, 67: 2, 103: 2, 54: 2, 21: 2, 162: 2, 127: 2, 234: 2, 93: 2, 132: 2,
  338: 2, 297: 2, 332: 2, 284: 2, 301: 2, 389: 2, 356: 2, 454: 2, 323: 2, 361: 2,
  // Chin
  152: 3, 175: 2, 199: 2, 396: 2,
  // Jawline
  58: 2, 172: 2, 136: 2, 150: 2, 149: 2, 148: 2, 176: 2,
  288: 2, 397: 2, 367: 2, 379: 2, 378: 2, 377: 2, 400: 2
};

interface Particle {
  baseX: number;
  baseY: number;
  baseZ: number;
  x: number;
  y: number;
  z: number;
  facePos: FacePosition | null;
  size: number;
  alpha: number;
  oscSeed1: number;
  oscSeed2: number;
  oscSeed3: number;
  disperseAngle: number;
  disperseDist: number;
}

interface FacePosition {
  type: 'landmark' | 'interpolated';
  lmIndex?: number;
  lm1?: number;
  lm2?: number;
  lm3?: number;
  u?: number;
  v?: number;
  w?: number;
  isHot: number;
  jitter: number;
}

interface FaceBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

interface Rotation {
  yaw: number;
  pitch: number;
  roll: number;
}

interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

export default function FaceMorph({
  miraAudioLevel = 0,
  userAudioLevel = 0,
  miraState = 'active',
  isSpeaking = false,
}: FaceMorphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const hasFaceRef = useRef(false);
  const faceBlendRef = useRef(0);
  const transitionPhaseRef = useRef<'stable' | 'oscillate' | 'forming' | 'disperse' | 'reforming'>('stable');
  const chaosAmountRef = useRef(0);
  const disperseAmountRef = useRef(0);
  const dimensionsRef = useRef({ W: 0, H: 0, CX: 0, CY: 0 });
  const videoAspectRef = useRef(4 / 3);
  const neutralCenterRef = useRef({ x: 0.5, y: 0.5 });
  const neutralRotRef = useRef<Rotation>({ yaw: 0, pitch: 0, roll: 0 });
  const facePositionsRef = useRef<FacePosition[]>([]);
  const miraAudioRef = useRef(miraAudioLevel);
  const isInitializedRef = useRef(false);
  const feedLoopRunningRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);

  const [isLoading, setIsLoading] = useState(true);

  // Update audio ref
  useEffect(() => {
    miraAudioRef.current = miraAudioLevel;
  }, [miraAudioLevel]);

  // Config
  const cfg = {
    particleCount: 5000,
    sphereRadiusFrac: 0.30,
    rotationSpeed: 0.22,
    perspective: 950,
    dotMin: 0.35,
    dotMax: 0.95,
    follow: 0.28,
    followFaceBoost: 0.12,
    faceWidthFrac: 0.38,
    facePad: 1.05,
    centerSmoothing: 0.25,
    rotSmoothing: 0.18,
    rotAmount: 0.55,
    BLEND_IN: 0.08,
    BLEND_OUT: 0.06,
    CHAOS_BUILD_SPEED: 0.06,
    CHAOS_DECAY_SPEED: 0.02,
    MAX_CHAOS: 1.0,
    OSCILLATION_FREQ: 12,
    OSCILLATION_AMP: 150,
    DISPERSE_BUILD_SPEED: 0.07,
    DISPERSE_DECAY_SPEED: 0.025,
    MAX_DISPERSE: 1.0,
    DISPERSE_RADIUS: 350,
  };

  // Generate face positions for particles
  const generateFacePositions = useCallback(() => {
    const facePositions: FacePosition[] = [];
    const count = cfg.particleCount;

    // Add weighted landmarks
    for (let i = 0; i < LM_COUNT; i++) {
      const weight = LANDMARK_WEIGHTS[i] || 1;
      for (let w = 0; w < weight; w++) {
        facePositions.push({
          type: 'landmark',
          lmIndex: i,
          isHot: EXTRA_HOT.has(i) ? 2 : (HOT.has(i) ? 1 : 0),
          jitter: w > 0 ? 0.02 : 0
        });
      }
    }

    // Fill remaining with interpolated positions from triangles
    while (facePositions.length < count) {
      const triIdx = Math.floor(Math.random() * FACE_TRIANGLES.length);
      const tri = FACE_TRIANGLES[triIdx];
      const [i1, i2, i3] = tri;

      const r1 = Math.random();
      const r2 = Math.random();
      const sqrtR1 = Math.sqrt(r1);
      const u = 1 - sqrtR1;
      const v = sqrtR1 * (1 - r2);
      const w = sqrtR1 * r2;

      facePositions.push({
        type: 'interpolated',
        lm1: i1,
        lm2: i2,
        lm3: i3,
        u,
        v,
        w,
        isHot: (HOT.has(i1) || HOT.has(i2) || HOT.has(i3)) ? 1 : 0,
        jitter: 0
      });
    }

    // Shuffle
    for (let i = facePositions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [facePositions[i], facePositions[j]] = [facePositions[j], facePositions[i]];
    }

    facePositionsRef.current = facePositions;
  }, [cfg.particleCount]);

  // Initialize particles
  const initParticles = useCallback(() => {
    const { W, H } = dimensionsRef.current;
    if (W === 0 || H === 0) return;

    generateFacePositions();
    const particles: Particle[] = [];
    const R = Math.min(W, H) * cfg.sphereRadiusFrac;

    for (let i = 0; i < cfg.particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const jitterStrength = Math.random() * 0.5;
      const finalTheta = theta + (Math.random() - 0.5) * jitterStrength;
      const finalPhi = Math.max(0.05, Math.min(Math.PI - 0.05, phi + (Math.random() - 0.5) * jitterStrength * 0.5));

      const x = R * Math.sin(finalPhi) * Math.cos(finalTheta);
      const y = R * Math.sin(finalPhi) * Math.sin(finalTheta);
      const z = R * Math.cos(finalPhi);

      particles.push({
        baseX: x,
        baseY: y,
        baseZ: z,
        x,
        y,
        z,
        facePos: facePositionsRef.current[i] || null,
        size: cfg.dotMin + Math.random() * (cfg.dotMax - cfg.dotMin),
        alpha: 0.30 + Math.random() * 0.70,
        oscSeed1: Math.random() * Math.PI * 2,
        oscSeed2: Math.random() * Math.PI * 2,
        oscSeed3: Math.random() * Math.PI * 2,
        disperseAngle: Math.random() * Math.PI * 2,
        disperseDist: 0.5 + Math.random() * 0.5,
      });
    }

    particlesRef.current = particles;
  }, [generateFacePositions, cfg]);

  // Compute face bounds
  const computeFaceBounds = useCallback((lm: NormalizedLandmark[]): FaceBounds => {
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (let i = 0; i < Math.min(LM_COUNT, lm.length); i++) {
      const p = lm[i];
      if (!p) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return {
      minX, maxX, minY, maxY,
      w: maxX - minX,
      h: maxY - minY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2
    };
  }, []);

  // Estimate rotation
  const estimateRotation = useCallback((lm: NormalizedLandmark[]): Rotation => {
    const L = lm[234] || lm[33];
    const R = lm[454] || lm[263];
    const N = lm[1] || lm[4];

    if (!L || !R || !N) return { yaw: 0, pitch: 0, roll: 0 };

    const midX = (L.x + R.x) * 0.5;
    const yaw = (N.x - midX) / Math.max(1e-6, R.x - L.x);
    const midY = (L.y + R.y) * 0.5;
    const pitch = (N.y - midY) / Math.max(1e-6, R.x - L.x);
    const roll = Math.atan2(R.y - L.y, R.x - L.x);

    return { yaw, pitch, roll };
  }, []);

  // Convert landmark to screen coordinates
  const faceTarget = useCallback((lm: NormalizedLandmark, faceInfo: FaceBounds, rot: Rotation) => {
    const { W, H } = dimensionsRef.current;
    const x = 1 - lm.x;
    const y = lm.y;

    const dx = x - neutralCenterRef.current.x;
    const dy = y - neutralCenterRef.current.y;
    const nx = dx / Math.max(1e-6, faceInfo.w);
    const ny = dy / Math.max(1e-6, faceInfo.h);

    const baseSize = Math.min(W, H) * cfg.faceWidthFrac * cfg.facePad;
    const faceAspect = faceInfo.w / Math.max(1e-6, faceInfo.h);
    const correctedAspect = faceAspect * videoAspectRef.current;

    let faceW: number, faceH: number;
    if (correctedAspect > 1) {
      faceW = baseSize;
      faceH = baseSize / correctedAspect;
    } else {
      faceH = baseSize;
      faceW = baseSize * correctedAspect;
    }

    let px = nx * faceW;
    let py = ny * faceH;

    const yaw = rot.yaw * cfg.rotAmount;
    const pitch = rot.pitch * cfg.rotAmount;
    const roll = rot.roll * cfg.rotAmount * 0.35;

    px += yaw * faceW * 0.06;
    py += pitch * faceH * 0.05;

    const cos = Math.cos(roll), sin = Math.sin(roll);
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    px = rx;
    py = ry;

    const z = lm.z ?? 0;
    const pz = z * (Math.min(W, H) * 0.75);

    return { x: px, y: py, z: pz };
  }, [cfg]);

  // Draw particle
  const drawDot = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, hotBoost: number) => {
    const glowSize = r * 3.5;
    const glowAlpha = alpha * 0.4 * hotBoost;
    
    const glow = ctx.createRadialGradient(x, y, 0, x, y, glowSize);
    glow.addColorStop(0, `rgba(100,200,255,${glowAlpha})`);
    glow.addColorStop(0.3, `rgba(80,180,255,${glowAlpha * 0.5})`);
    glow.addColorStop(1, 'rgba(50,150,255,0)');
    ctx.beginPath();
    ctx.arc(x, y, glowSize, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180,240,255,${alpha})`;
    ctx.fill();
  }, []);

  // Animation step
  const step = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      animationRef.current = requestAnimationFrame(step);
      return;
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      animationRef.current = requestAnimationFrame(step);
      return;
    }

    const { W, H, CX, CY } = dimensionsRef.current;
    if (W === 0 || H === 0) {
      animationRef.current = requestAnimationFrame(step);
      return;
    }

    // Clear with gradient background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const r = Math.min(W, H) * 0.60;
    const g = ctx.createRadialGradient(CX, CY, r * 0.08, CX, CY, r);
    g.addColorStop(0, 'rgba(40,140,255,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const now = performance.now();
    const hasFace = hasFaceRef.current;
    const lastLandmarks = lastLandmarksRef.current;
    const faceBlend = faceBlendRef.current;
    let chaosAmount = chaosAmountRef.current;
    let disperseAmount = disperseAmountRef.current;

    // Update transition state
    if (hasFace && lastLandmarks) {
      if (faceBlend < 0.1 && transitionPhaseRef.current !== 'oscillate') {
        transitionPhaseRef.current = 'oscillate';
      }

      if (transitionPhaseRef.current === 'oscillate') {
        chaosAmount = Math.min(cfg.MAX_CHAOS, chaosAmount + cfg.CHAOS_BUILD_SPEED);
        if (chaosAmount > 0.6) {
          faceBlendRef.current = Math.min(1, faceBlend + cfg.BLEND_IN * 0.5);
        }
        if (faceBlendRef.current > 0.3) {
          transitionPhaseRef.current = 'forming';
        }
      } else if (transitionPhaseRef.current === 'forming' || transitionPhaseRef.current === 'stable') {
        chaosAmount = Math.max(0, chaosAmount - cfg.CHAOS_DECAY_SPEED);
        faceBlendRef.current = Math.min(1, faceBlendRef.current + cfg.BLEND_IN);
        if (faceBlendRef.current >= 0.95 && chaosAmount < 0.05) {
          transitionPhaseRef.current = 'stable';
        }
      }
      disperseAmount = Math.max(0, disperseAmount - cfg.DISPERSE_DECAY_SPEED * 2);
    } else {
      if (faceBlend > 0.5 && transitionPhaseRef.current !== 'disperse') {
        transitionPhaseRef.current = 'disperse';
      }

      if (transitionPhaseRef.current === 'disperse') {
        disperseAmount = Math.min(cfg.MAX_DISPERSE, disperseAmount + cfg.DISPERSE_BUILD_SPEED);
        if (disperseAmount > 0.5) {
          faceBlendRef.current = Math.max(0, faceBlend - cfg.BLEND_OUT * 0.6);
        }
        if (faceBlendRef.current < 0.4) {
          transitionPhaseRef.current = 'reforming';
        }
      } else if (transitionPhaseRef.current === 'reforming' || transitionPhaseRef.current === 'stable') {
        disperseAmount = Math.max(0, disperseAmount - cfg.DISPERSE_DECAY_SPEED);
        faceBlendRef.current = Math.max(0, faceBlendRef.current - cfg.BLEND_OUT);
        if (faceBlendRef.current <= 0.05 && disperseAmount < 0.05) {
          transitionPhaseRef.current = 'stable';
        }
      }
      chaosAmount = Math.max(0, chaosAmount - cfg.CHAOS_DECAY_SPEED * 2);
    }

    chaosAmountRef.current = chaosAmount;
    disperseAmountRef.current = disperseAmount;

    const time = now * 0.001 * cfg.rotationSpeed;
    const oscTime = now * 0.001;
    const R = Math.min(W, H) * cfg.sphereRadiusFrac;
    const persp = cfg.perspective;

    let faceInfo: FaceBounds | null = null;
    let rot: Rotation = { yaw: 0, pitch: 0, roll: 0 };

    if (lastLandmarks && faceBlendRef.current > 0.001) {
      faceInfo = computeFaceBounds(lastLandmarks);
      const curCenter = { x: 1 - faceInfo.cx, y: faceInfo.cy };
      neutralCenterRef.current.x += (curCenter.x - neutralCenterRef.current.x) * cfg.centerSmoothing;
      neutralCenterRef.current.y += (curCenter.y - neutralCenterRef.current.y) * cfg.centerSmoothing;

      const r0 = estimateRotation(lastLandmarks);
      neutralRotRef.current.yaw += (r0.yaw - neutralRotRef.current.yaw) * cfg.rotSmoothing;
      neutralRotRef.current.pitch += (r0.pitch - neutralRotRef.current.pitch) * cfg.rotSmoothing;
      neutralRotRef.current.roll += (r0.roll - neutralRotRef.current.roll) * cfg.rotSmoothing;
      rot = neutralRotRef.current;
    }

    ctx.globalCompositeOperation = 'lighter';

    for (const p of particlesRef.current) {
      const bx = p.baseX, by = p.baseY, bz = p.baseZ;
      const gx = bx * Math.cos(time) - bz * Math.sin(time);
      const gz = bx * Math.sin(time) + bz * Math.cos(time);
      const gy = by;

      let fx = gx, fy = gy, fz = gz;
      let hotBoost = 1.0;

      if (faceInfo && faceBlendRef.current > 0.001 && p.facePos && lastLandmarks) {
        const fp = p.facePos;
        let targetPt = null;

        if (fp.type === 'landmark' && fp.lmIndex !== undefined) {
          const lm = lastLandmarks[fp.lmIndex];
          if (lm) {
            targetPt = faceTarget(lm, faceInfo, rot);
            if (fp.jitter > 0) {
              targetPt.x += (Math.random() - 0.5) * fp.jitter * Math.min(W, H) * cfg.faceWidthFrac;
              targetPt.y += (Math.random() - 0.5) * fp.jitter * Math.min(W, H) * cfg.faceWidthFrac;
            }
            hotBoost = fp.isHot === 2 ? 1.45 : (fp.isHot === 1 ? 1.20 : 1.0);
          }
        } else if (fp.type === 'interpolated' && fp.lm1 !== undefined && fp.lm2 !== undefined && fp.lm3 !== undefined) {
          const lm1 = lastLandmarks[fp.lm1];
          const lm2 = lastLandmarks[fp.lm2];
          const lm3 = lastLandmarks[fp.lm3];
          if (lm1 && lm2 && lm3 && fp.u !== undefined && fp.v !== undefined && fp.w !== undefined) {
            const t1 = faceTarget(lm1, faceInfo, rot);
            const t2 = faceTarget(lm2, faceInfo, rot);
            const t3 = faceTarget(lm3, faceInfo, rot);
            targetPt = {
              x: fp.u * t1.x + fp.v * t2.x + fp.w * t3.x,
              y: fp.u * t1.y + fp.v * t2.y + fp.w * t3.y,
              z: fp.u * t1.z + fp.v * t2.z + fp.w * t3.z
            };
            hotBoost = fp.isHot === 2 ? 1.35 : (fp.isHot === 1 ? 1.15 : 1.0);
          }
        }

        if (targetPt) {
          fx = targetPt.x;
          fy = targetPt.y;
          fz = targetPt.z - R * 0.22;
        }
      }

      // Interpolate position
      let tx = gx + (fx - gx) * faceBlendRef.current;
      let ty = gy + (fy - gy) * faceBlendRef.current;
      let tz = gz + (fz - gz) * faceBlendRef.current;

      // Add oscillation effect
      if (chaosAmount > 0.01) {
        const oscIntensity = chaosAmount * chaosAmount * chaosAmount;
        const freq1 = cfg.OSCILLATION_FREQ + p.oscSeed1 * 5;
        const freq2 = cfg.OSCILLATION_FREQ * 1.5 + p.oscSeed2 * 4;
        const freq3 = cfg.OSCILLATION_FREQ * 0.8 + p.oscSeed3 * 6;

        const oscX = (Math.sin(oscTime * freq1 + p.oscSeed1 * 10) +
          Math.sin(oscTime * freq1 * 2.3 + p.oscSeed2 * 7) * 0.5) * cfg.OSCILLATION_AMP * oscIntensity;
        const oscY = (Math.sin(oscTime * freq2 + p.oscSeed2 * 10) +
          Math.sin(oscTime * freq2 * 1.7 + p.oscSeed3 * 8) * 0.5) * cfg.OSCILLATION_AMP * oscIntensity;
        const oscZ = (Math.sin(oscTime * freq3 + p.oscSeed3 * 10) +
          Math.sin(oscTime * freq3 * 2.1 + p.oscSeed1 * 9) * 0.4) * cfg.OSCILLATION_AMP * 0.7 * oscIntensity;

        tx += oscX;
        ty += oscY;
        tz += oscZ;
      }

      // Add dispersion effect
      if (disperseAmount > 0.01) {
        const dispIntensity = disperseAmount * disperseAmount * disperseAmount;
        const dispX = Math.cos(p.disperseAngle) * cfg.DISPERSE_RADIUS * p.disperseDist * dispIntensity;
        const dispY = Math.sin(p.disperseAngle) * cfg.DISPERSE_RADIUS * p.disperseDist * dispIntensity;
        const dispZ = (Math.sin(p.oscSeed1 * 5) - 0.3) * cfg.DISPERSE_RADIUS * 0.8 * dispIntensity;

        const swirlTime = oscTime * 4;
        const swirlRadius = 60 * dispIntensity;
        const swirlX = Math.sin(swirlTime + p.oscSeed2 * 6) * swirlRadius;
        const swirlY = Math.cos(swirlTime + p.oscSeed3 * 6) * swirlRadius;

        const chaosX = Math.sin(oscTime * 15 + p.oscSeed1 * 20) * 40 * dispIntensity;
        const chaosY = Math.cos(oscTime * 13 + p.oscSeed2 * 20) * 40 * dispIntensity;

        tx += dispX + swirlX + chaosX;
        ty += dispY + swirlY + chaosY;
        tz += dispZ;
      }

      const follow = cfg.follow + (faceBlendRef.current > 0.2 ? cfg.followFaceBoost : 0);
      p.x += (tx - p.x) * follow;
      p.y += (ty - p.y) * follow;
      p.z += (tz - p.z) * follow;

      const scale = persp / (persp + p.z);
      if (scale <= 0) continue;

      const sx = CX + p.x * scale;
      const sy = CY + p.y * scale;

      const depth = Math.max(0, Math.min(1, (scale - 0.55) * 1.8));
      const baseA = p.alpha * (0.20 + depth * 0.90);
      const a = Math.min(1, baseA * (1.0 + faceBlendRef.current * 1.05 * hotBoost));
      const rad = (p.size * scale) * (0.42 + depth * 0.70);

      drawDot(ctx, sx, sy, rad, a, hotBoost);
    }

    ctx.globalCompositeOperation = 'source-over';

    animationRef.current = requestAnimationFrame(step);
  }, [cfg, computeFaceBounds, estimateRotation, faceTarget, drawDot]);

  // Resize handler
  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    const DPR = Math.max(1, window.devicePixelRatio || 1);

    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(DPR, DPR);
    }

    dimensionsRef.current = { W, H, CX: W / 2, CY: H / 2 };

    if (particlesRef.current.length === 0 || particlesRef.current.length !== cfg.particleCount) {
      initParticles();
    }
  }, [initParticles, cfg.particleCount]);

  // Process video frame
  const processVideoFrame = useCallback(() => {
    if (!feedLoopRunningRef.current) {
      return;
    }

    const faceLandmarker = faceLandmarkerRef.current;
    const video = videoRef.current;

    // Check all prerequisites
    if (!faceLandmarker || !video) {
      requestAnimationFrame(processVideoFrame);
      return;
    }

    // Ensure video is fully ready with valid dimensions
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      requestAnimationFrame(processVideoFrame);
      return;
    }

    // Only process if we have a new frame
    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      
      try {
        const results = faceLandmarker.detectForVideo(video, performance.now());
        
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
          hasFaceRef.current = true;
          lastLandmarksRef.current = results.faceLandmarks[0];
        } else {
          hasFaceRef.current = false;
        }
      } catch (e) {
        // Silently handle errors - don't spam console
      }
    }

    requestAnimationFrame(processVideoFrame);
  }, []);

  // Start camera
  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return false;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      video.srcObject = stream;
      
      // Wait for video to be ready
      await new Promise<void>((resolve) => {
        const checkReady = () => {
          if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
            resolve();
          } else {
            requestAnimationFrame(checkReady);
          }
        };
        video.onloadeddata = () => resolve();
        checkReady();
      });
      
      await video.play();
      
      if (video.videoWidth && video.videoHeight) {
        videoAspectRef.current = video.videoWidth / video.videoHeight;
      }
      
      return true;
    } catch (err) {
      console.error('Camera error:', err);
      return false;
    }
  }, []);

  // Initialize FaceLandmarker
  const initFaceLandmarker = useCallback(async () => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    try {
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      const faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU'
        },
        outputFaceBlendshapes: false,
        runningMode: 'VIDEO',
        numFaces: 1
      });

      faceLandmarkerRef.current = faceLandmarker;
      console.log('FaceLandmarker initialized successfully');
      
      // Start camera after face landmarker is ready
      await startCamera();
      
      // Start processing loop
      feedLoopRunningRef.current = true;
      processVideoFrame();
      
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to initialize FaceLandmarker:', error);
      setIsLoading(false);
    }
  }, [processVideoFrame, startCamera]);

  // Initialize face detection
  useEffect(() => {
    initFaceLandmarker();

    return () => {
      // Cleanup
      feedLoopRunningRef.current = false;
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
        faceLandmarkerRef.current = null;
      }
    };
  }, [initFaceLandmarker]);

  // Setup canvas and animation
  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    
    animationRef.current = requestAnimationFrame(step);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [handleResize, step]);

  // Update video aspect when metadata loads
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleMetadata = () => {
      if (video.videoWidth && video.videoHeight) {
        videoAspectRef.current = video.videoWidth / video.videoHeight;
      }
    };

    video.addEventListener('loadedmetadata', handleMetadata);
    return () => video.removeEventListener('loadedmetadata', handleMetadata);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <video
        ref={videoRef}
        playsInline
        muted
        className="hidden"
      />
      <canvas
        ref={canvasRef}
        className="w-full h-full"
      />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-white text-sm">Loading face detection...</div>
        </div>
      )}
    </div>
  );
}
