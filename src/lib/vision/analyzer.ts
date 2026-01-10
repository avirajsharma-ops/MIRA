import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface VisionAnalysis {
  description: string;
  objects: string[];
  people: {
    count: number;
    descriptions: string[];
  };
  activities: string[];
  mood?: string;
  text?: string[];
  // New: Conversation and phone detection
  conversationDetected?: boolean;
  phoneActivity?: {
    detected: boolean;
    type?: 'ringing' | 'call_in_progress' | 'notification' | 'video_call' | null;
    app?: string; // Zoom, Teams, FaceTime, etc.
  };
}

export async function analyzeImage(
  imageBase64: string,
  context?: string,
  detectGestures?: boolean
): Promise<VisionAnalysis> {
  let prompt = context
    ? `Analyze this image in the context of: ${context}. Describe what you see briefly.`
    : 'Briefly describe what you see in this image.';
  
  if (detectGestures) {
    prompt += ' Also note any hand gestures the person is making.';
  }
  
  // Always check for conversation and phone activity
  prompt += ' IMPORTANT: Note if multiple people appear to be having a conversation. Also check for any phone activity (ringing phone, incoming call notifications, video call apps like Zoom/Teams/FaceTime/Meet on screen, or person on a phone call).';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: 'low',
            },
          },
        ],
      },
    ],
    max_tokens: 200,
  });

  const content = response.choices[0]?.message?.content || '';
  return parseVisionResponse(content);
}

export async function detectGesture(imageBase64: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Look at this image and identify if the person is making any of these gestures: wave, thumbs_up, thumbs_down, peace, raised_hand, pointing. If no gesture is detected, respond with "none". Only respond with one word: the gesture name or "none".`,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: 'low',
            },
          },
        ],
      },
    ],
    max_tokens: 20,
  });

  const content = response.choices[0]?.message?.content?.toLowerCase().trim() || 'none';
  const validGestures = ['wave', 'thumbs_up', 'thumbs_down', 'peace', 'raised_hand', 'pointing', 'none'];
  return validGestures.includes(content) ? content : 'none';
}

export async function analyzeScreen(
  imageBase64: string
): Promise<VisionAnalysis> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'This is a screenshot. Describe what application or website is being used, what the user appears to be doing, any important text or content visible. Be concise.',
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: 'high',
            },
          },
        ],
      },
    ],
    max_tokens: 400,
  });

  const content = response.choices[0]?.message?.content || '';
  return parseVisionResponse(content);
}

export async function detectFaces(
  imageBase64: string
): Promise<{
  count: number;
  faces: { description: string; position: string }[];
}> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'How many people/faces are in this image? For each face, describe their approximate age, gender, expression, and position in the frame (left, center, right). Respond in JSON format: { "count": number, "faces": [{ "description": "...", "position": "..." }] }',
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: 'low',
            },
          },
        ],
      },
    ],
    max_tokens: 300,
  });

  try {
    const content = response.choices[0]?.message?.content || '{}';
    const cleaned = content.replace(/```json\n?|\n?```/g, '');
    return JSON.parse(cleaned);
  } catch {
    return { count: 0, faces: [] };
  }
}

export async function compareForRecognition(
  currentImageBase64: string,
  storedImageBase64: string,
  personName: string
): Promise<{ isMatch: boolean; confidence: number }> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Compare these two images. The second image is of a person named "${personName}". Is the person in the first image the same person as in the second image? Respond in JSON format: { "isMatch": boolean, "confidence": 0-100, "reasoning": "..." }`,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${currentImageBase64}`,
              detail: 'high',
            },
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${storedImageBase64}`,
              detail: 'high',
            },
          },
        ],
      },
    ],
    max_tokens: 200,
  });

  try {
    const content = response.choices[0]?.message?.content || '{}';
    const cleaned = content.replace(/```json\n?|\n?```/g, '');
    const parsed = JSON.parse(cleaned);
    return {
      isMatch: parsed.isMatch || false,
      confidence: parsed.confidence || 0,
    };
  } catch {
    return { isMatch: false, confidence: 0 };
  }
}

function parseVisionResponse(content: string): VisionAnalysis {
  // Basic parsing of the AI response into structured format
  const lower = content.toLowerCase();
  
  // Extract people count
  const peopleMatch = content.match(/(\d+)\s*(?:people|person|individual|face)/i);
  const peopleCount = peopleMatch ? parseInt(peopleMatch[1]) : 0;

  // Detect conversation - multiple people talking/interacting
  const conversationKeywords = [
    'conversation', 'talking', 'speaking', 'discussing', 'chatting',
    'meeting', 'dialogue', 'interacting', 'engaged in discussion'
  ];
  const conversationDetected = conversationKeywords.some(k => lower.includes(k)) || 
    (peopleCount >= 2 && (lower.includes('talk') || lower.includes('speak') || lower.includes('discuss')));

  // Detect phone activity
  const phoneActivity = detectPhoneActivity(content);

  return {
    description: content,
    objects: extractListItems(content, ['objects', 'items', 'things']),
    people: {
      count: peopleCount || (lower.includes('person') || lower.includes('someone') ? 1 : 0),
      descriptions: extractListItems(content, ['person', 'people', 'individual']),
    },
    activities: extractListItems(content, ['doing', 'activity', 'working', 'looking']),
    mood: extractMood(content),
    text: extractListItems(content, ['text', 'says', 'reads', 'written']),
    conversationDetected,
    phoneActivity,
  };
}

function detectPhoneActivity(content: string): VisionAnalysis['phoneActivity'] {
  const lower = content.toLowerCase();
  
  // Video call apps
  const videoCallApps = ['zoom', 'teams', 'facetime', 'google meet', 'webex', 'skype', 'discord'];
  const detectedApp = videoCallApps.find(app => lower.includes(app));
  
  // Phone activity indicators
  const ringingIndicators = ['ringing', 'incoming call', 'phone ringing', 'call notification'];
  const callInProgressIndicators = ['on a call', 'phone call', 'talking on phone', 'holding phone to ear', 'on the phone'];
  const notificationIndicators = ['notification', 'alert', 'message', 'incoming'];
  
  let detected = false;
  let type: 'ringing' | 'call_in_progress' | 'notification' | 'video_call' | null = null;
  
  if (detectedApp) {
    detected = true;
    type = 'video_call';
  } else if (ringingIndicators.some(i => lower.includes(i))) {
    detected = true;
    type = 'ringing';
  } else if (callInProgressIndicators.some(i => lower.includes(i))) {
    detected = true;
    type = 'call_in_progress';
  } else if (lower.includes('phone') && notificationIndicators.some(i => lower.includes(i))) {
    detected = true;
    type = 'notification';
  }
  
  return {
    detected,
    type,
    app: detectedApp || undefined,
  };
}

function extractListItems(content: string, keywords: string[]): string[] {
  const items: string[] = [];
  const sentences = content.split(/[.!?]/);
  
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (keywords.some(k => lower.includes(k))) {
      items.push(sentence.trim());
    }
  }
  
  return items.slice(0, 5);
}

function extractMood(content: string): string {
  const moods: { [key: string]: string[] } = {
    positive: ['happy', 'smiling', 'bright', 'cheerful', 'warm'],
    neutral: ['calm', 'neutral', 'normal', 'standard'],
    focused: ['focused', 'concentrated', 'working', 'busy'],
    negative: ['sad', 'tired', 'stressed', 'worried'],
  };

  const lower = content.toLowerCase();
  for (const [mood, keywords] of Object.entries(moods)) {
    if (keywords.some(k => lower.includes(k))) {
      return mood;
    }
  }
  
  return 'neutral';
}

export default {
  analyzeImage,
  analyzeScreen,
  detectFaces,
  compareForRecognition,
  detectGesture,
};
