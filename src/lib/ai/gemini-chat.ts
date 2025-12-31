// Gemini Chat API - Primary AI for MIRA with OpenAI fallback

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_CHAT_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export interface GeminiChatOptions {
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GeminiChatResponse {
  text: string;
  success: boolean;
  usedFallback: boolean;
  detectedLanguage?: string;
}

// Convert conversation history to Gemini format
function convertToGeminiFormat(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
): GeminiMessage[] {
  return messages
    .filter(m => m.role !== 'system') // Gemini handles system prompt differently
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
}

// Detect language from text - including Hinglish (Hindi in Roman script)
function detectLanguage(text: string): string {
  const lower = text.toLowerCase();
  
  // Hindi detection (Devanagari script)
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  
  // Hinglish detection - common Hindi words written in English
  const hinglishWords = [
    'kya', 'hai', 'hain', 'kaise', 'kaisa', 'kaisi', 'ho', 'hoon', 'hun',
    'mein', 'main', 'mujhe', 'mujhse', 'tum', 'tumhe', 'tumhara', 'tumhari',
    'aap', 'aapka', 'aapki', 'aapko', 'apna', 'apni', 'apne',
    'yeh', 'ye', 'woh', 'wo', 'yaha', 'yahan', 'waha', 'wahan',
    'kab', 'kahan', 'kyun', 'kyu', 'kyuki', 'isliye', 'lekin', 'par', 'aur',
    'nahi', 'nahin', 'nhi', 'haa', 'haan', 'ji', 'accha', 'acha', 'achha',
    'theek', 'thik', 'sahi', 'galat', 'bahut', 'bohot', 'boht', 'zyada',
    'kam', 'thoda', 'thodi', 'kuch', 'sab', 'sabhi', 'koi', 'kaun',
    'kar', 'karo', 'karna', 'karke', 'kiya', 'kiye', 'karunga', 'karenge',
    'bolo', 'bol', 'batao', 'bata', 'batana', 'sunao', 'suno', 'dekho', 'dekh',
    'jao', 'ja', 'jana', 'aao', 'aa', 'aana', 'lo', 'le', 'lena', 'do', 'de', 'dena',
    'samajh', 'samjha', 'samjho', 'pata', 'maloom', 'matlab',
    'abhi', 'ab', 'phir', 'fir', 'kabhi', 'hamesha', 'pehle', 'baad',
    'kal', 'aaj', 'parso', 'raat', 'din', 'subah', 'shaam', 'dopahar',
    'paisa', 'paise', 'rupee', 'rupaye', 'khana', 'peena', 'khaana', 'khao',
    'ghar', 'dost', 'yaar', 'bhai', 'behen', 'beta', 'beti', 'maa', 'papa',
    'pyaar', 'pyar', 'dil', 'zindagi', 'life', 'time', 'kaam', 'kam',
    'soch', 'socho', 'sochna', 'lagta', 'lagti', 'lagte', 'chahiye', 'chahte',
    'pasand', 'acchi', 'bura', 'buri', 'mast', 'mazaa', 'maza',
    'namaste', 'namaskar', 'dhanyawad', 'shukriya', 'alvida', 'chalo', 'chaliye',
    'arrey', 'arre', 'oye', 'yaar', 'haanji', 'hanji', 'bilkul', 'zaroor',
    'kaise ho', 'kya haal', 'theek hai', 'sab theek', 'kya hua', 'kya kar',
    'baat', 'baatein', 'bol raha', 'bol rahi', 'kar raha', 'kar rahi',
  ];
  
  // Count Hinglish word matches
  const words = lower.split(/\s+/);
  let hinglishCount = 0;
  for (const word of words) {
    // Clean the word of punctuation
    const cleanWord = word.replace(/[.,!?'"]/g, '');
    if (hinglishWords.includes(cleanWord)) {
      hinglishCount++;
    }
  }
  
  // If more than 20% of words are Hinglish, treat as Hindi
  if (words.length > 0 && (hinglishCount / words.length) >= 0.2) {
    return 'hi';
  }
  
  // Also check for common Hinglish patterns/phrases
  const hinglishPatterns = [
    /\bkya\s+(hai|ho|hua|kar|baat)/i,
    /\bkaise\s+(ho|hai|hain)/i,
    /\bmujhe\s+/i,
    /\btumhe\s+/i,
    /\baapko\s+/i,
    /\bkar\s*(raha|rahi|rahe|lo|do|na)/i,
    /\bho\s*(raha|rahi|gaya|gayi)/i,
    /\btha\b|\bthi\b|\bthe\b/i,
    /\bhoga\b|\bhogi\b|\bhonge/i,
    /\bhai\s+na\b/i,
    /\bna\s+hai/i,
    /\bkuch\s+(nahi|bhi|aur)/i,
    /\bbahut\s+(accha|acha|badiya|zyada)/i,
  ];
  
  if (hinglishPatterns.some(pattern => pattern.test(lower))) {
    return 'hi';
  }
  
  // Arabic
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  // Chinese
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  // Japanese
  if (/[\u3040-\u30FF]/.test(text)) return 'ja';
  // Korean
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
  // Spanish/French common patterns
  if (/[áéíóúñ¿¡àâêëîïôûùç]/i.test(text)) return 'es';
  
  return 'en';
}

export async function chatWithGemini(
  userMessage: string,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [],
  options: GeminiChatOptions
): Promise<GeminiChatResponse> {
  if (!GEMINI_API_KEY) {
    console.warn('Gemini API key not configured, using fallback');
    return { text: '', success: false, usedFallback: true };
  }

  try {
    // Detect input language
    const inputLanguage = detectLanguage(userMessage);
    console.log('Detected language:', inputLanguage, 'for message:', userMessage.substring(0, 50));
    
    // Build system instruction with language awareness
    let languageInstruction = '';
    
    // Check if user is using Devanagari script (pure Hindi)
    const hasDevanagari = /[\u0900-\u097F]/.test(userMessage);
    // Check if user has English words too (Hinglish)
    const hasEnglish = /[a-zA-Z]{2,}/.test(userMessage);
    const isHinglish = (inputLanguage === 'hi' || hasDevanagari) && hasEnglish;
    
    if (inputLanguage === 'hi' || hasDevanagari) {
      if (isHinglish || !hasDevanagari) {
        // Hinglish mode: English words in Roman, Hindi words in Devanagari
        languageInstruction = `\n\nCRITICAL LANGUAGE & SCRIPT RULES (FOR TTS PRONUNCIATION):
The user is speaking in Hinglish. You MUST respond in Hinglish with this STRICT rule:
- English words: Write in Roman script (normal English)
- Hindi words: Write ONLY in देवनागरी script

EXAMPLES OF CORRECT HINGLISH:
✓ "Main आज बहुत खुश हूँ, let's do something fun!"
✓ "हाँ definitely, यह idea बहुत अच्छा है!"
✓ "Sure, मैं समझ गया। What's next?"

EXAMPLES OF WRONG (TTS CANNOT PRONOUNCE):
✗ "Main aaj bahut khush hoon" - Roman Hindi is WRONG
✗ "Haan definitely, yeh idea bahut accha hai" - Roman Hindi is WRONG

Common Hindi words that MUST be Devanagari: हाँ, नहीं, क्या, कैसे, अच्छा, ठीक है, धन्यवाद, बहुत, कुछ, यह, वह, मैं, तुम, आप, हम, कर, हो, है`;
      } else {
        // Pure Devanagari Hindi
        languageInstruction = `\n\nCRITICAL LANGUAGE INSTRUCTION: The user is communicating in pure Hindi (Devanagari). Respond ONLY in Devanagari script (देवनागरी लिपि).

RULES:
- Write ALL words in Devanagari script: हाँ, नहीं, क्या, कैसे, अच्छा, धन्यवाद
- NEVER use Roman/English letters for Hindi words
- Example correct: "हाँ, मैं समझ गया! क्या बात है?"`;
      }
    } else if (inputLanguage === 'en') {
      // English - respond in pure English, no Hindi mixing
      languageInstruction = `\n\nIMPORTANT: Respond in clear English only. Do NOT mix Hindi words or phrases. Use proper English throughout your response.`;
    } else if (inputLanguage !== 'en') {
      languageInstruction = `\n\nIMPORTANT: The user is speaking in ${inputLanguage}. ALWAYS respond in the SAME language using its native script. Do NOT mix with English.`;
    }
    
    const systemInstruction = options.systemPrompt + languageInstruction;

    // Build conversation history in Gemini format
    const geminiHistory = convertToGeminiFormat(conversationHistory);
    
    // Add current user message
    const contents = [
      ...geminiHistory,
      {
        role: 'user' as const,
        parts: [{ text: userMessage }]
      }
    ];

    const requestBody = {
      contents,
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 150,
        topP: 0.95,
        topK: 40
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    };

    const response = await fetch(GEMINI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      return { text: '', success: false, usedFallback: true };
    }

    const data = await response.json();
    
    // Extract text from response
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (!text) {
      console.warn('Empty response from Gemini');
      return { text: '', success: false, usedFallback: true };
    }

    // Detect response language
    const responseLanguage = detectLanguage(text);

    return {
      text,
      success: true,
      usedFallback: false,
      detectedLanguage: responseLanguage
    };
  } catch (error) {
    console.error('Gemini chat error:', error);
    return { text: '', success: false, usedFallback: true };
  }
}

// AI-based debate need analysis
export async function analyzeDebateWithGemini(
  userMessage: string,
  initialResponse: string,
  respondingAgent: 'mi' | 'ra'
): Promise<{ needsDebate: boolean; reason?: string }> {
  if (!GEMINI_API_KEY) {
    return { needsDebate: false };
  }

  try {
    const analysisPrompt = `You are an intelligent mediator. Be VERY CONSERVATIVE about recommending debates.

User's message: "${userMessage}"

Should MI (emotional) and RA (logical) have a debate about this?

Say YES ONLY if ALL of these are true:
1. It's a MAJOR life decision (career change, relationship milestone, big financial decision)
2. The user is explicitly asking for advice or opinions
3. Both emotional AND logical perspectives would GENUINELY add different value
4. The message is substantial (not a greeting, question about surroundings, or simple request)

Say NO for:
- Greetings (hi, hello, how are you)
- Simple questions (what do you see, who is this, what time is it)
- Factual questions (what is X, explain Y)
- Commands (show me, tell me, do this)
- Small talk or casual conversation
- Questions about the camera/screen/surroundings
- Short messages under 20 words
- Anything that doesn't require weighing emotional vs logical tradeoffs

DEFAULT TO NO. Only say YES for truly complex dilemmas.

Respond with ONLY:
DEBATE: NO
or
DEBATE: YES
REASON: one sentence`;

    const requestBody = {
      contents: [{
        role: 'user',
        parts: [{ text: analysisPrompt }]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 100
      }
    };

    const response = await fetch(GEMINI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      return { needsDebate: false };
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    
    const needsDebate = /DEBATE:\s*YES/i.test(result);
    const reasonMatch = result.match(/REASON:\s*(.+)/i);
    const reason = reasonMatch?.[1]?.trim();
    
    console.log('Debate analysis:', { needsDebate, reason, raw: result });
    
    return { needsDebate, reason };
  } catch (error) {
    console.error('Debate analysis error:', error);
    return { needsDebate: false };
  }
}

// Simple routing with Gemini
export async function routeWithGemini(userMessage: string): Promise<'mi' | 'ra' | 'both' | null> {
  if (!GEMINI_API_KEY) {
    return null; // Use fallback
  }

  try {
    const routingPrompt = `You are a routing system. Based on the user's message, decide who should respond.

मी - Choose for:
- Greetings, casual chat, small talk, emotional support
- Feelings, relationships, creative questions
- Personal matters, encouragement, comfort

रा - Choose for:
- Facts, data, technical questions, math, code
- Practical how-to questions, problem-solving

BOTH - Choose ONLY for major life decisions that need both emotional AND logical perspectives.

User message: "${userMessage}"

Respond with ONLY ONE word: मी, रा, or BOTH`;

    const requestBody = {
      contents: [{
        role: 'user',
        parts: [{ text: routingPrompt }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 10
      }
    };

    const response = await fetch(GEMINI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const decision = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();

    if (decision === 'MI' || decision === 'मी') return 'mi';
    if (decision === 'RA' || decision === 'रा') return 'ra';
    if (decision === 'BOTH') return 'both';
    
    return null;
  } catch {
    return null;
  }
}

// Detect if Gemini refused to answer (content policy, etc.)
export function isGeminiRefusal(response: string): boolean {
  const refusalPatterns = [
    /i can'?t (help|assist|provide|generate|create|discuss|analyze)/i,
    /i'?m not able to/i,
    /i cannot (help|assist|provide|generate|create|discuss|analyze)/i,
    /as an ai,? i (can'?t|cannot|am not able to)/i,
    /i'?m sorry,? but i (can'?t|cannot|won'?t)/i,
    /this (request|topic|content) (is|goes) (against|beyond)/i,
    /i don'?t (feel comfortable|think i should)/i,
    /my (guidelines|policies|safety) (prevent|don'?t allow)/i,
    /i'?m designed to (avoid|not|refuse)/i,
    /violates? (my|content) (policies|guidelines)/i,
    /i must (decline|refuse)/i,
  ];

  return refusalPatterns.some(pattern => pattern.test(response));
}

// Detect if user wants to save a face
export interface FaceSaveIntent {
  wantsToSave: boolean;
  name?: string;
  relationship?: string;
  context?: string;
}

export async function detectFaceSaveIntent(userMessage: string): Promise<FaceSaveIntent> {
  if (!GEMINI_API_KEY) {
    return { wantsToSave: false };
  }

  const prompt = `Analyze if the user wants to SAVE/REMEMBER a person's face.

User message: "${userMessage}"

The user wants to save a face if they say things like:
- "Remember this face as John"
- "This is my friend Sarah"
- "Save this person as my mom"
- "Her name is Lisa, she's my sister"
- "That's Mike, my coworker"
- "Remember him as Dad"
- "This is [name]"

Extract:
1. Does the user want to save a face? (YES/NO)
2. What name to save? (if any)
3. What relationship? (friend, family, coworker, etc.)
4. Any context provided?

Respond in EXACT format:
SAVE: YES or NO
NAME: extracted name or NONE
RELATIONSHIP: relationship or unknown
CONTEXT: any context or NONE`;

  try {
    const response = await fetch(GEMINI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 100 }
      })
    });

    if (!response.ok) {
      return { wantsToSave: false };
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const wantsToSave = /SAVE:\s*YES/i.test(result);
    const nameMatch = result.match(/NAME:\s*(.+)/i);
    const relationshipMatch = result.match(/RELATIONSHIP:\s*(.+)/i);
    const contextMatch = result.match(/CONTEXT:\s*(.+)/i);

    const name = nameMatch?.[1]?.trim();
    const relationship = relationshipMatch?.[1]?.trim();
    const context = contextMatch?.[1]?.trim();

    return {
      wantsToSave,
      name: name && name !== 'NONE' ? name : undefined,
      relationship: relationship && relationship !== 'unknown' ? relationship : undefined,
      context: context && context !== 'NONE' ? context : undefined,
    };
  } catch {
    return { wantsToSave: false };
  }
}

// Get fallback response from OpenAI when Gemini refuses
export async function getFallbackFromOpenAI(
  userMessage: string,
  systemPrompt: string
): Promise<string> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 200
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'I apologize, but I had trouble generating a response.';
}

export default {
  chatWithGemini,
  routeWithGemini,
  analyzeDebateWithGemini,
  isGeminiRefusal,
  detectFaceSaveIntent,
  getFallbackFromOpenAI,
};
