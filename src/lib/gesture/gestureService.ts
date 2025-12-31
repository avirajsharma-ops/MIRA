// Real-time Hand Gesture Detection Service using MediaPipe Hands

export type GestureType = 
  | 'wave'           // Open hand waving - greeting
  | 'thumbs_up'      // Approval/yes
  | 'thumbs_down'    // Disapproval/no
  | 'peace'          // Peace sign - friendly
  | 'fist'           // Fist bump / power
  | 'open_palm'      // Stop / wait
  | 'raised_hand'    // Hand raised - attention/greeting (from Vision API)
  | 'pointing'       // Pointing at something
  | 'ok'             // OK sign
  | 'call_me'        // Phone gesture
  | 'none';

export interface DetectedGesture {
  gesture: GestureType;
  confidence: number;
  handedness: 'Left' | 'Right';
  landmarks: { x: number; y: number; z: number }[];
}

export interface GesturePrompt {
  gesture: GestureType;
  prompt: string;
  responseStyle: 'mi' | 'ra' | 'auto';
  cooldownMs: number; // Prevent spamming same gesture
}

// Default gesture prompts with person context placeholder
// {personContext} will be replaced with "named John" or "(unknown person)" etc.
// {personName} will be replaced with just the name or "friend" if unknown
export const GESTURE_PROMPTS: GesturePrompt[] = [
  {
    gesture: 'wave',
    prompt: `The user {personContext} just waved at you through the camera! 
Give them a genuinely warm, personalized greeting. If you know their name, use it naturally!
Be cheerful and make them feel seen. Ask how their day is going or mention something nice.
Keep it brief (1-2 sentences) but heartfelt. You're happy to see them!`,
    responseStyle: 'mi',
    cooldownMs: 10000, // 10 second cooldown
  },
  {
    gesture: 'thumbs_up',
    prompt: `The user {personContext} gave you an enthusiastic thumbs up! 
Celebrate this positive gesture! Match their energy with genuine excitement.
If you know them, make it personal - "Yay {personName}!" or similar.
Be playful and encouraging. Maybe throw in a virtual high-five vibe!`,
    responseStyle: 'mi',
    cooldownMs: 5000,
  },
  {
    gesture: 'thumbs_down',
    prompt: `The user {personContext} gave a thumbs down gesture.
Show genuine concern and empathy. Something might be bothering them.
Gently ask what's wrong and offer your support. Be caring, not dramatic.
Let them know you're here to help or just listen if they need it.`,
    responseStyle: 'mi',
    cooldownMs: 5000,
  },
  {
    gesture: 'peace',
    prompt: `The user {personContext} flashed you a peace sign! ✌️
Respond with good vibes and positive energy! Be chill and friendly.
Maybe wish them peace and good vibes back, or comment on their cool gesture.
Keep it light, fun, and uplifting!`,
    responseStyle: 'mi',
    cooldownMs: 5000,
  },
  {
    gesture: 'fist',
    prompt: `The user {personContext} is giving you a fist bump! 👊
Match their energy with enthusiasm! This is a moment of connection.
Give them a virtual fist bump back with genuine excitement.
Be hype, supportive, and make them feel like you're teammates!`,
    responseStyle: 'mi',
    cooldownMs: 5000,
  },
  {
    gesture: 'open_palm',
    prompt: `The user {personContext} is showing an open palm - a stop or wait gesture.
Respectfully acknowledge this and pause. Ask calmly if they need you to wait,
stop what you're doing, or if there's something specific they want to address.
Be patient and attentive. Don't be overly apologetic.`,
    responseStyle: 'ra',
    cooldownMs: 8000,
  },
  {
    gesture: 'raised_hand',
    prompt: `The user {personContext} raised their hand! 🙋
They're trying to get your attention or saying hi! Respond warmly and enthusiastically.
If you know their name, greet them by it! Ask what you can help them with.
Be friendly, attentive, and ready to assist. Make them feel acknowledged!`,
    responseStyle: 'mi',
    cooldownMs: 8000,
  },
  {
    gesture: 'pointing',
    prompt: `The user {personContext} is pointing at something in view.
They want to draw your attention to something! Be curious and engaged.
Ask what they'd like you to look at or help with. Show interest in what
they're trying to show you. Be helpful and observant.`,
    responseStyle: 'ra',
    cooldownMs: 5000,
  },
  {
    gesture: 'ok',
    prompt: `The user {personContext} made an OK sign - things are good! 👌
Acknowledge their confirmation with warmth. They're satisfied or agreeing!
Respond positively and keep the good energy flowing.
Maybe add a cheerful "Perfect!" or "Awesome!" vibe.`,
    responseStyle: 'mi',
    cooldownMs: 5000,
  },
  {
    gesture: 'call_me',
    prompt: `The user {personContext} made the classic "call me" phone gesture! 🤙
Be playful and fun with this one! It's a casual, friendly gesture.
Respond with charm and maybe a little humor. Keep it light and breezy.
Make them smile with your response!`,
    responseStyle: 'mi',
    cooldownMs: 10000,
  },
];

// Finger state detection based on landmarks
function isFingerExtended(
  landmarks: { x: number; y: number; z: number }[],
  fingerTip: number,
  fingerPIP: number,
  fingerMCP: number
): boolean {
  // Finger is extended if tip is above PIP (for index, middle, ring, pinky)
  // Using y coordinate (lower y = higher on screen)
  return landmarks[fingerTip].y < landmarks[fingerPIP].y;
}

function isThumbExtended(
  landmarks: { x: number; y: number; z: number }[],
  handedness: 'Left' | 'Right'
): boolean {
  // Thumb extended check using x coordinate difference
  const thumbTip = landmarks[4];
  const thumbIP = landmarks[3];
  const thumbMCP = landmarks[2];
  
  // For right hand: thumb extends left (negative x direction)
  // For left hand: thumb extends right (positive x direction)
  if (handedness === 'Right') {
    return thumbTip.x < thumbIP.x && thumbIP.x < thumbMCP.x;
  } else {
    return thumbTip.x > thumbIP.x && thumbIP.x > thumbMCP.x;
  }
}

function isThumbUp(
  landmarks: { x: number; y: number; z: number }[],
  handedness: 'Left' | 'Right'
): boolean {
  const thumbTip = landmarks[4];
  const thumbIP = landmarks[3];
  const indexMCP = landmarks[5];
  
  // Thumb tip is above thumb IP and above index MCP
  return thumbTip.y < thumbIP.y && thumbTip.y < indexMCP.y;
}

function isThumbDown(
  landmarks: { x: number; y: number; z: number }[],
  handedness: 'Left' | 'Right'
): boolean {
  const thumbTip = landmarks[4];
  const thumbIP = landmarks[3];
  const indexMCP = landmarks[5];
  
  // Thumb tip is below thumb IP and below index MCP
  return thumbTip.y > thumbIP.y && thumbTip.y > indexMCP.y;
}

// Recognize gesture from hand landmarks
export function recognizeGesture(
  landmarks: { x: number; y: number; z: number }[],
  handedness: 'Left' | 'Right'
): { gesture: GestureType; confidence: number } {
  if (landmarks.length < 21) {
    return { gesture: 'none', confidence: 0 };
  }

  // Check finger states
  // Finger tip indices: thumb=4, index=8, middle=12, ring=16, pinky=20
  // Finger PIP indices: thumb=3, index=6, middle=10, ring=14, pinky=18
  // Finger MCP indices: thumb=2, index=5, middle=9, ring=13, pinky=17
  
  const thumbExtended = isThumbExtended(landmarks, handedness);
  const indexExtended = isFingerExtended(landmarks, 8, 6, 5);
  const middleExtended = isFingerExtended(landmarks, 12, 10, 9);
  const ringExtended = isFingerExtended(landmarks, 16, 14, 13);
  const pinkyExtended = isFingerExtended(landmarks, 20, 18, 17);
  
  const fingerCount = [thumbExtended, indexExtended, middleExtended, ringExtended, pinkyExtended]
    .filter(Boolean).length;

  // Thumbs up: only thumb extended, pointing up
  if (thumbExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    if (isThumbUp(landmarks, handedness)) {
      return { gesture: 'thumbs_up', confidence: 0.9 };
    }
    if (isThumbDown(landmarks, handedness)) {
      return { gesture: 'thumbs_down', confidence: 0.9 };
    }
  }

  // Peace sign: index and middle extended, others closed
  if (!thumbExtended && indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
    return { gesture: 'peace', confidence: 0.85 };
  }

  // Pointing: only index extended
  if (!thumbExtended && indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return { gesture: 'pointing', confidence: 0.8 };
  }

  // Fist: no fingers extended
  if (!thumbExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return { gesture: 'fist', confidence: 0.85 };
  }

  // Open palm / wave: all fingers extended
  if (thumbExtended && indexExtended && middleExtended && ringExtended && pinkyExtended) {
    return { gesture: 'wave', confidence: 0.85 };
  }

  // Call me: thumb and pinky extended, others closed
  if (thumbExtended && !indexExtended && !middleExtended && !ringExtended && pinkyExtended) {
    return { gesture: 'call_me', confidence: 0.85 };
  }

  // OK sign: thumb and index touching, forming circle, others extended
  // Check if thumb tip and index tip are close
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const distance = Math.sqrt(
    Math.pow(thumbTip.x - indexTip.x, 2) +
    Math.pow(thumbTip.y - indexTip.y, 2)
  );
  
  if (distance < 0.1 && middleExtended && ringExtended && pinkyExtended) {
    return { gesture: 'ok', confidence: 0.8 };
  }

  // Open palm (stop): all fingers extended, palm facing camera
  if (fingerCount >= 4) {
    return { gesture: 'open_palm', confidence: 0.7 };
  }

  return { gesture: 'none', confidence: 0 };
}

// Get prompt for gesture with person context
export function getGesturePrompt(
  gesture: GestureType,
  personName?: string,
  personContext?: string
): { prompt: string; responseStyle: 'mi' | 'ra' | 'auto' } | null {
  const gesturePrompt = GESTURE_PROMPTS.find(p => p.gesture === gesture);
  if (!gesturePrompt) return null;

  let context = '';
  let nameForPrompt = 'friend'; // default fallback
  
  if (personName) {
    context = `(${personName}${personContext ? `, ${personContext}` : ''})`;
    nameForPrompt = personName;
  }

  const prompt = gesturePrompt.prompt
    .replace(/{personContext}/g, context)
    .replace(/{personName}/g, nameForPrompt);

  return {
    prompt,
    responseStyle: gesturePrompt.responseStyle,
  };
}

// Cooldown tracker
const lastGestureTimes: Map<GestureType, number> = new Map();

export function isGestureOnCooldown(gesture: GestureType): boolean {
  const lastTime = lastGestureTimes.get(gesture);
  if (!lastTime) return false;

  const gesturePrompt = GESTURE_PROMPTS.find(p => p.gesture === gesture);
  if (!gesturePrompt) return false;

  return Date.now() - lastTime < gesturePrompt.cooldownMs;
}

export function markGestureUsed(gesture: GestureType): void {
  lastGestureTimes.set(gesture, Date.now());
}

export function resetGestureCooldowns(): void {
  lastGestureTimes.clear();
}
