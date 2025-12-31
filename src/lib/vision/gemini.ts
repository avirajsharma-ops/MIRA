// Gemini Vision API for image and camera processing with face recognition

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Updated to use gemini-2.0-flash as per latest docs
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Rate limiting - track last request time
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3000; // Minimum 3 seconds between requests

export interface GeminiVisionAnalysis {
  description: string;
  objects: string[];
  people: {
    count: number;
    descriptions: string[];
    faces: FaceData[];
  };
  activities: string[];
  mood?: string;
  gesture?: string;
  context: string;
}

export interface FaceData {
  id: string;
  description: string;
  expression: string;
  estimatedAge?: string;
  gender?: string;
  distinctiveFeatures?: string[];
  isLookingAtCamera: boolean;
}

// Helper to strip data URL prefix and get clean base64
function cleanBase64(imageBase64: string): { data: string; mimeType: string } {
  if (imageBase64.startsWith('data:')) {
    const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    }
  }
  return { mimeType: 'image/jpeg', data: imageBase64 };
}

// Default fallback response when rate limited or error
function getDefaultAnalysis(): GeminiVisionAnalysis {
  return {
    description: 'Unable to analyze image at this time',
    objects: [],
    people: { count: 0, descriptions: [], faces: [] },
    activities: [],
    mood: 'neutral',
    gesture: 'none',
    context: 'Vision analysis temporarily unavailable'
  };
}

export async function analyzeImageWithGemini(
  imageBase64: string,
  context?: string,
  detectGestures: boolean = true
): Promise<GeminiVisionAnalysis> {
  if (!GEMINI_API_KEY) {
    console.warn('Gemini API key not configured');
    return getDefaultAnalysis();
  }

  // Rate limiting check
  const now = Date.now();
  if (now - lastRequestTime < MIN_REQUEST_INTERVAL) {
    console.log('Rate limiting: skipping vision request');
    return getDefaultAnalysis();
  }
  lastRequestTime = now;

  const { data: cleanedData, mimeType } = cleanBase64(imageBase64);

  const prompt = `Analyze this camera image for an AI assistant named MIRA.

${context ? `Additional context: ${context}` : ''}

Identify:
1. People visible - describe each person's appearance, expression, what they're doing
2. For each face: expression (happy, sad, neutral, focused, confused, etc), if they're looking at camera
3. Hand gestures: wave, thumbs_up, thumbs_down, peace, raised_hand, pointing, or none
4. Environment and objects
5. Overall mood/atmosphere

IMPORTANT: For face recognition, describe distinctive features that could help identify the same person later (hair color/style, glasses, facial hair, clothing color, etc.)

Respond in this exact JSON format:
{
  "description": "Brief scene description",
  "objects": ["object1", "object2"],
  "people": {
    "count": 1,
    "descriptions": ["Person 1 description"],
    "faces": [
      {
        "id": "face_1",
        "description": "Detailed appearance description for identification",
        "expression": "happy/sad/neutral/focused/etc",
        "estimatedAge": "20s/30s/etc",
        "gender": "male/female/unknown",
        "distinctiveFeatures": ["glasses", "beard", "red shirt"],
        "isLookingAtCamera": true
      }
    ]
  },
  "activities": ["what they are doing"],
  "mood": "overall mood",
  "gesture": "detected gesture or none",
  "context": "Rich summary for the AI to understand the situation and who is present"
}`;

  // Retry logic for network errors (ECONNRESET, etc.)
  const maxRetries = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Exponential backoff: 0ms, 500ms, 1500ms
      if (attempt > 0) {
        const delay = Math.pow(2, attempt - 1) * 500;
        console.log(`Gemini vision retry attempt ${attempt + 1}/${maxRetries}, waiting ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: cleanedData } }
            ]
          }]
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error:', response.status, errorText);
        // Return default for rate limit errors instead of throwing
        if (response.status === 429) {
          console.warn('Rate limited by Gemini API, returning default analysis');
          return getDefaultAnalysis();
        }
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const responseData = await response.json();
      const textContent = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      try {
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          // Sanitize common JSON formatting issues from Gemini
          let jsonStr = jsonMatch[0];
          
          // Fix trailing commas before ] or }
          jsonStr = jsonStr.replace(/,(\s*[\]\}])/g, '$1');
          
          // Fix missing commas between array elements (e.g., "word1" "word2")
          jsonStr = jsonStr.replace(/"\s*\n\s*"/g, '",\n"');
          
          // Fix unescaped newlines in strings
          jsonStr = jsonStr.replace(/:\s*"([^"]*)\n([^"]*)"/g, ': "$1 $2"');
          
          // Fix single quotes to double quotes (but not apostrophes in words)
          jsonStr = jsonStr.replace(/'([^']+)'(\s*[:\],\}])/g, '"$1"$2');
          
          const parsed = JSON.parse(jsonStr);
          // Ensure faces array exists
          if (parsed.people && !parsed.people.faces) {
            parsed.people.faces = [];
          }
          return parsed;
        }
      } catch (parseError) {
        console.error('Failed to parse Gemini response:', parseError);
        console.error('Raw response:', textContent.substring(0, 500));
      }

      return {
        description: textContent.substring(0, 200),
        objects: [],
        people: { count: 0, descriptions: [], faces: [] },
        activities: [],
        mood: 'neutral',
        gesture: 'none',
        context: textContent
      };
    } catch (error) {
      lastError = error as Error;
      const errorMessage = lastError?.message || '';
      const errorCause = (lastError as NodeJS.ErrnoException)?.cause;
      
      // Check if it's a retryable network error
      const isNetworkError = 
        errorMessage.includes('fetch failed') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('ECONNREFUSED') ||
        (errorCause && typeof errorCause === 'object' && 'code' in errorCause);
      
      if (isNetworkError && attempt < maxRetries - 1) {
        console.warn(`Gemini vision network error (attempt ${attempt + 1}):`, errorMessage);
        continue; // Retry
      }
      
      // Non-retryable error or max retries reached
      console.error('Gemini vision error:', error);
      break;
    }
  }
  
  // All retries failed
  if (lastError) {
    console.error(`Gemini vision failed after ${maxRetries} attempts:`, lastError.message);
  }
  return getDefaultAnalysis();
}

export async function analyzeScreenWithGemini(imageBase64: string): Promise<GeminiVisionAnalysis> {
  if (!GEMINI_API_KEY) {
    return getDefaultAnalysis();
  }

  const { data: cleanedData, mimeType } = cleanBase64(imageBase64);

  const prompt = `Analyze this screenshot for an AI assistant:

1. What application/website is shown?
2. What is the user working on?
3. Any important text, code, or content?
4. What might the user need help with?

Respond in JSON format:
{
  "description": "Brief screen description",
  "objects": ["UI elements"],
  "people": { "count": 0, "descriptions": [], "faces": [] },
  "activities": ["user activity"],
  "mood": "n/a",
  "gesture": "none",
  "context": "What the user is working on and might need help with"
}`;

  // Retry logic for network errors
  const maxRetries = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt - 1) * 500;
        console.log(`Gemini screen retry attempt ${attempt + 1}/${maxRetries}, waiting ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: cleanedData } }
            ]
          }]
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini screen API error:', response.status, errorText);
        if (response.status === 429) {
          return getDefaultAnalysis();
        }
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const responseData = await response.json();
      const textContent = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      try {
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error('Failed to parse screen response:', parseError);
      }

      return {
        description: textContent.substring(0, 200),
        objects: [],
        people: { count: 0, descriptions: [], faces: [] },
        activities: [],
        mood: 'n/a',
        gesture: 'none',
        context: textContent
      };
    } catch (error) {
      lastError = error as Error;
      const errorMessage = lastError?.message || '';
      const errorCause = (lastError as NodeJS.ErrnoException)?.cause;
      
      const isNetworkError = 
        errorMessage.includes('fetch failed') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('ECONNREFUSED') ||
        (errorCause && typeof errorCause === 'object' && 'code' in errorCause);
      
      if (isNetworkError && attempt < maxRetries - 1) {
        console.warn(`Gemini screen network error (attempt ${attempt + 1}):`, errorMessage);
        continue;
      }
      
      console.error('Gemini screen error:', error);
      break;
    }
  }
  
  if (lastError) {
    console.error(`Gemini screen failed after ${maxRetries} attempts:`, lastError.message);
  }
  return getDefaultAnalysis();
}

export async function detectGestureWithGemini(imageBase64: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    return 'none';
  }

  const { data: cleanedData, mimeType } = cleanBase64(imageBase64);

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Identify hand gesture in this image. Options: wave, thumbs_up, thumbs_down, peace, raised_hand, pointing, none. Reply with ONE word only.' },
            { inline_data: { mime_type: mimeType, data: cleanedData } }
          ]
        }]
      }),
    });

    if (!response.ok) return 'none';

    const responseData = await response.json();
    const gesture = responseData.candidates?.[0]?.content?.parts?.[0]?.text?.toLowerCase().trim() || 'none';
    
    const validGestures = ['wave', 'thumbs_up', 'thumbs_down', 'peace', 'raised_hand', 'pointing', 'none'];
    return validGestures.includes(gesture) ? gesture : 'none';
  } catch {
    return 'none';
  }
}

// Identify if this is a known person based on stored face data
export async function identifyPerson(
  imageBase64: string,
  knownFaces: { name: string; description: string }[]
): Promise<{ identified: boolean; name?: string; confidence?: string }> {
  if (!GEMINI_API_KEY || knownFaces.length === 0) {
    return { identified: false };
  }

  const { data: cleanedData, mimeType } = cleanBase64(imageBase64);

  const knownPeopleList = knownFaces.map((f, i) => `${i + 1}. ${f.name}: ${f.description}`).join('\n');

  const prompt = `Compare the person in this image against these known people:

${knownPeopleList}

Based on visible features (face, hair, glasses, clothing, etc), does the person in the image match any known person?

Respond in JSON:
{
  "identified": true,
  "name": "matched name or null",
  "confidence": "high/medium/low"
}`;

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: cleanedData } }
          ]
        }]
      }),
    });

    if (!response.ok) return { identified: false };

    const responseData = await response.json();
    const textContent = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { identified: false };
  } catch {
    return { identified: false };
  }
}
