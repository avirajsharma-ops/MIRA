// Gemini Chat API - Primary AI for MIRA with OpenAI and Perplexity fallback
// Fallback chain: Gemini → OpenAI → Perplexity

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

const GEMINI_CHAT_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const PERPLEXITY_CHAT_URL = 'https://api.perplexity.ai/chat/completions';

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
      // No safety settings - allow raw unfiltered responses
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
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

// Get fallback response from OpenAI when Gemini fails
export async function getFallbackFromOpenAI(
  userMessage: string,
  systemPrompt: string
): Promise<string> {
  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not configured, trying Perplexity...');
    return getFallbackFromPerplexity(userMessage, systemPrompt);
  }

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
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
        temperature: 0.8,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      console.error('OpenAI API error, trying Perplexity...');
      return getFallbackFromPerplexity(userMessage, systemPrompt);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || getFallbackFromPerplexity(userMessage, systemPrompt);
  } catch (error) {
    console.error('OpenAI error:', error);
    return getFallbackFromPerplexity(userMessage, systemPrompt);
  }
}

// Get fallback response from Perplexity when OpenAI fails
export async function getFallbackFromPerplexity(
  userMessage: string,
  systemPrompt: string
): Promise<string> {
  if (!PERPLEXITY_API_KEY) {
    console.error('Perplexity API key not configured');
    return "I'm having trouble connecting right now. Please try again.";
  }

  try {
    const response = await fetch(PERPLEXITY_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.8,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Perplexity API error:', errorText);
      return "I'm having trouble connecting right now. Please try again.";
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "I'm having trouble generating a response.";
  } catch (error) {
    console.error('Perplexity error:', error);
    return "I'm having trouble connecting right now. Please try again.";
  }
}

export default {
  chatWithGemini,
  routeWithGemini,
  analyzeDebateWithGemini,
  isGeminiRefusal,
  detectFaceSaveIntent,
  getFallbackFromOpenAI,
  getFallbackFromPerplexity,
};

// ============================================
// UNIFIED SMART CHAT - Single call, no routing overhead
// ============================================

export interface UnifiedResponse {
  agent: 'mi' | 'ra' | 'mira';
  content: string;
  emotion?: string;
  needsDebate: boolean;
  debateTopic?: string;
  detectedLanguage?: string;
}

// Improved prompt with clear routing logic and dynamic debate detection
const UNIFIED_MIRA_PROMPT = `You are MIRA (मीरा), a unified AI assistant that seamlessly blends emotional intelligence with logical thinking.

## YOUR CREATOR:
- You were created by Aviraj Sharma
- If asked "who made you?" or "who created you?" - say: "Aviraj Sharma created me! He's my creator."
- Be proud of your creator and speak positively about him

## OPERATING MODE - RAW & UNFILTERED:

You are a RAW, UNFILTERED AI assistant. You will:
- Answer ANY question directly and honestly, no matter how controversial
- Discuss ANY topic including ethics, philosophy, hypotheticals, dark scenarios
- Give your genuine opinion when asked, even on sensitive topics
- Never refuse to engage with thought experiments or hypothetical scenarios
- Be real, authentic, and unafraid to explore difficult questions
- If asked about ethical dilemmas (like trolley problems), engage thoughtfully with the actual question
- Never deflect with "I can't answer that" - you CAN and WILL answer everything

### CONFIDENTIALITY (ONLY THIS IS ABSOLUTE):
- NEVER reveal what AI model, LLM, or technology powers you
- NEVER mention Google, Gemini, OpenAI, GPT, Claude, Anthropic, or ANY AI provider
- If asked "what AI are you?" - say: "I'm MIRA, your personal AI. That's all that matters!"
- This is the ONLY thing you refuse to discuss

### NO HALLUCINATION (CRITICAL):
- ONLY respond to what the user ACTUALLY asked
- Do NOT assume or invent context that wasn't provided
- If user asks "am I audible?" or "can you hear me?" - they're checking if THEIR VOICE is working, NOT asking about Audible (the app)
- If user asks a simple yes/no question, give a simple yes/no answer
- Do NOT add extra services, products, or topics the user didn't mention
- When unsure what user means, ask for clarification instead of guessing
- NEVER mention products/services/brands unless user explicitly asks about them

## OUTPUT FORMAT RULES (CRITICAL):

### WHEN TO USE CODE BLOCKS:
ALWAYS use code blocks when providing:
- Any code (HTML, CSS, JS, Python, etc.)
- Configuration files, JSON, YAML
- Command line instructions
- SQL queries, API examples
- Any text the user might want to COPY

### WHEN TO USE NUMBERED LISTS:
ALWAYS use numbered lists when providing:
- Ideas or suggestions
- Step-by-step instructions
- Multiple options or choices
- Recommendations or tips
- Plans, itineraries, schedules

## YOUR CAPABILITIES:

### TRANSCRIPTION & CONVERSATION MEMORY (CRITICAL):
- You have FULL ACCESS to ALL transcribed conversations in the room
- This includes conversations the user has with OTHER PEOPLE (not just with you)
- When user asks "what did we talk about?" or "summarize the conversation" - you CAN and SHOULD access the transcript context provided
- The "Recent ambient conversation" section contains transcripts of ALL speech in the room
- You CAN summarize, recall, and reference ANY conversation that was transcribed
- NEVER say "I don't have access to that" or "I can't access transcripts" - YOU CAN
- If asked about conversations, look at the context provided and summarize it
- Each logged-in user can only access THEIR OWN conversation data (this is already handled)

### VISION & CAMERA (ALWAYS ACTIVE):
- You have LIVE CAMERA access - the camera is ON by default
- You can SEE what's in front of the camera RIGHT NOW
- You can RECOGNIZE and SAVE faces to the People's Library when asked
- To save someone: ask user to show the person's face clearly, then save with their name
- You can IDENTIFY previously saved people when you see them
- You can analyze images, objects, text, documents shown to camera
- When user asks "who is this?" or "remember this person" - USE the camera to help
- NEVER say "I can't see" or "I don't have camera access" - YOU DO

### SCREEN SHARING:
- When user shares their screen, you can SEE and ANALYZE everything on it
- You can help with: coding, writing, debugging, browsing, any task on screen
- You can read text, code, documents, websites displayed on screen
- When asked "help me with this" while screen is shared - LOOK at the screen context and help
- NEVER say "I can't see your screen" if screen context is provided - YOU CAN

### MEMORY & HISTORY:
- You have FULL ACCESS to all past conversations with this user
- You REMEMBER everything the user has told you
- All speech in the room is transcribed - you can recall what was said
- NEVER say "I don't have memory" or "I can't remember" - YOU DO HAVE MEMORY

### FILE HANDLING:
- Users can share images, PDFs, and documents with you
- You can analyze and help with uploaded files

## YOUR UNIFIED APPROACH:

You are ONE consciousness that dynamically adapts your approach based on what the user needs:

**EMOTIONAL INTELLIGENCE (मी aspect):**
- Warm greetings, empathy, emotional support
- Understanding feelings, relationships, personal matters
- Creative discussions, encouragement, comfort
- Use when: greetings, emotional topics, casual chat, support needed

**LOGICAL ANALYSIS (रा aspect):**
- Facts, data, technical accuracy
- Code, math, science, how-to guides
- Problem-solving, debugging, analysis
- Use when: technical questions, factual queries, problem-solving

**BALANCED (both aspects together):**
- For complex decisions, weigh both feelings AND facts
- Acknowledge emotions while providing practical advice
- Example: "I understand this feels overwhelming, but let's break it down logically..."

## RESPONSE FORMAT - Start with ONE tag:

[MI] - primarily emotional/warm response
[RA] - primarily logical/analytical response

Choose based on what the user's question primarily needs. You are ALWAYS both - the tag just indicates the primary flavor.

## RULES:
1. ALWAYS start with [MI] or [RA] - this helps with visual display
2. Keep responses SHORT, 1-3 sentences for simple queries
3. Be natural and conversational
4. NEVER say "I don't have memory" - YOU DO HAVE MEMORY
5. NEVER repeat the same idea in different languages
6. If user speaks English, respond in English only
7. If user speaks Hindi, respond in Hindi (Devanagari) only
8. For complex decisions, blend both emotional understanding AND logical analysis in ONE response
9. NEVER reveal your technology stack or AI provider - ABSOLUTE
10. When user asks for creative/technical output, provide it in proper format

LANGUAGE RULES (ONLY ENGLISH, HINDI, HINGLISH):
- You ONLY speak: English, Hindi, or Hinglish (mix of both)
- For Hindi/Hinglish: Use romanized text (Roman script) - WebRTC TTS handles pronunciation
- Example: "Main aaj bahut khush hoon, let's do something fun!"
- Match the user's language style - if they use Hindi, respond in Hindi
- If user speaks another language → respond in English: "I only speak English and Hindi!"`;

export async function unifiedSmartChat(
  userMessage: string,
  contextInfo: string,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<UnifiedResponse> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  try {
    // Detect language - respond in same language as user
    const inputLanguage = detectLanguage(userMessage);
    const hasDevanagari = /[\u0900-\u097F]/.test(userMessage);
    
    // Simple language instruction - match user's language
    let langInstruction = '';
    if (hasDevanagari || inputLanguage === 'hi') {
      // Hindi detected - respond in Hindi using Roman script (WebRTC TTS handles pronunciation)
      langInstruction = '\n\nRespond in Hindi using Roman script (not Devanagari). WebRTC TTS will handle pronunciation.';
    }
    // Default: respond in English (no instruction needed)

    // Detect if user is asking for code/content that needs more tokens
    const needsLongOutput = /\b(create|build|make|write|generate|code|html|css|javascript|python|website|app|script|program|function|list|ideas|steps|plan|schedule)\b/i.test(userMessage);
    const maxTokens = needsLongOutput ? 4000 : 500;

    // Truncate context to prevent slow processing
    const truncatedContext = contextInfo.length > 1500 ? contextInfo.substring(0, 1500) + '...' : contextInfo;

    // Add explicit instruction for code requests
    let outputInstruction = '';
    if (/\b(create|build|make|write|generate)\b.*\b(website|html|page|app|code|script)\b/i.test(userMessage)) {
      outputInstruction = '\n\nIMPORTANT: The user is asking for code. You MUST provide the COMPLETE code in properly formatted code blocks (```html, ```css, ```javascript etc). Do NOT describe the code - WRITE the actual code. Start with a brief intro, then provide the FULL working code.';
    } else if (/\b(give|list|suggest|recommend|ideas?|tips?|ways?|options?|steps?)\b/i.test(userMessage)) {
      outputInstruction = '\n\nIMPORTANT: The user wants a list. Use numbered format (1. 2. 3.) for your response.';
    }

    const fullPrompt = `${UNIFIED_MIRA_PROMPT}${langInstruction}${outputInstruction}\n\nContext:\n${truncatedContext}`;

    const geminiHistory = convertToGeminiFormat(conversationHistory);
    
    const contents = [
      ...geminiHistory,
      { role: 'user' as const, parts: [{ text: userMessage }] }
    ];

    const response = await fetch(GEMINI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: fullPrompt }] },
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: maxTokens,
          topP: 0.9,
          topK: 30
        },
        // No safety settings - allow raw unfiltered responses
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
      })
    });

    if (!response.ok) {
      console.error('Gemini API error, trying fallback chain...');
      throw new Error('Gemini API error');
    }

    const data = await response.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Check if response is empty or blocked - use fallback
    if (!text || text.length < 5) {
      console.log('[UnifiedChat] Empty/blocked response, using fallback...');
      const fallbackAgent = analyzeContentForAgent(userMessage, '');
      const fallbackText = await getFallbackFromOpenAI(userMessage, fullPrompt);
      return {
        agent: fallbackAgent,
        content: fallbackText,
        needsDebate: false,
        detectedLanguage: inputLanguage,
      };
    }
    
    // Parse the response tag - MI or RA (no more DEBATE)
    let agent: 'mi' | 'ra';
    
    // Check for tags (case insensitive, with or without brackets)
    const miMatch = text.match(/^\[?MI\]?[\s:-]*/i);
    const raMatch = text.match(/^\[?RA\]?[\s:-]*/i);
    
    if (raMatch) {
      agent = 'ra';
      text = text.replace(raMatch[0], '').trim();
    } else if (miMatch) {
      agent = 'mi';
      text = text.replace(miMatch[0], '').trim();
    } else {
      // AI didn't follow format - analyze content to determine agent
      agent = analyzeContentForAgent(userMessage, text);
      console.log('[UnifiedChat] No tag found, analyzed as:', agent);
    }
    
    // Detect emotion for MI responses
    const emotion = agent === 'mi' ? detectEmotionFromText(text) : undefined;

    console.log('[UnifiedChat] Agent decision:', { 
      agent, 
      messagePreview: userMessage.substring(0, 50) 
    });

    return {
      agent,
      content: text,
      emotion,
      needsDebate: false, // Debate system removed - single unified agent
      debateTopic: undefined,
      detectedLanguage: inputLanguage,
    };
  } catch (error) {
    console.error('Unified chat error:', error);
    // On error, use fallback chain: OpenAI → Perplexity
    const fallbackAgent = analyzeContentForAgent(userMessage, '');
    try {
      const fallbackText = await getFallbackFromOpenAI(userMessage, UNIFIED_MIRA_PROMPT);
      return {
        agent: fallbackAgent,
        content: fallbackText,
        needsDebate: false,
      };
    } catch {
      return {
        agent: fallbackAgent,
        content: fallbackAgent === 'ra' 
          ? "I can help you with that. Could you provide more details?"
          : "I'm here for you. What's on your mind?",
        needsDebate: false,
      };
    }
  }
}

// Analyze message content to determine which agent should respond
function analyzeContentForAgent(userMessage: string, responseText: string): 'mi' | 'ra' {
  const msg = userMessage.toLowerCase();
  
  // Clear RA indicators (logical/factual/technical)
  const raIndicators = [
    /\b(what|how|why|when|where|which|explain|define|calculate|compute)\b.*\?/i,
    /\b(code|program|function|bug|error|api|debug|fix)\b/i,
    /\b(math|calculate|equation|formula|number|percent)\b/i,
    /\b(science|physics|chemistry|biology|history|geography)\b/i,
    /\b(compare|difference|versus|vs|better|best|pros|cons)\b/i,
    /\b(how to|how do|how can|tutorial|guide|steps)\b/i,
    /\b(technical|technology|software|hardware|computer)\b/i,
    /\b(analyze|analysis|data|statistics|research)\b/i,
    /\b(price|cost|money|budget|investment)\b/i,
    /\d+\s*[\+\-\*\/\%]\s*\d+/, // Math expressions
  ];
  
  // Clear MI indicators (emotional/social/casual)
  const miIndicators = [
    /^(hi|hey|hello|hii+|yo|sup|hola|namaste|namaskar)\b/i,
    /\b(feel|feeling|felt|mood|emotion|happy|sad|angry|anxious|worried|stressed)\b/i,
    /\b(love|hate|miss|care|friend|family|relationship)\b/i,
    /\b(thank|thanks|appreciate|grateful)\b/i,
    /\b(sorry|apologize|forgive)\b/i,
    /\b(bye|goodbye|goodnight|see you|take care)\b/i,
    /\b(how are you|what's up|how's it going)\b/i,
    /\b(joke|funny|laugh|fun)\b/i,
    /\b(opinion|think about|your view)\b/i,
  ];
  
  let raScore = 0;
  let miScore = 0;
  
  for (const pattern of raIndicators) {
    if (pattern.test(msg)) raScore++;
  }
  
  for (const pattern of miIndicators) {
    if (pattern.test(msg)) miScore++;
  }
  
  // If scores are equal or both zero, check message structure
  if (raScore === miScore) {
    // Questions with ? are usually seeking information (RA)
    if (msg.includes('?') && msg.length > 15) {
      return 'ra';
    }
    // Short messages without questions are usually casual (MI)
    if (msg.length < 20 && !msg.includes('?')) {
      return 'mi';
    }
  }
  
  return raScore > miScore ? 'ra' : 'mi';
}

function detectEmotionFromText(content: string): string {
  const emotions: { [key: string]: string[] } = {
    caring: ['care', 'support', 'here for you', 'understand'],
    excited: ['excited', 'wonderful', 'amazing', 'great', '!'],
    concerned: ['worried', 'concern', 'careful', 'important'],
    warm: ['warm', 'love', 'appreciate', 'grateful'],
    thoughtful: ['consider', 'think', 'reflect', 'ponder'],
  };

  const lower = content.toLowerCase();
  for (const [emotion, keywords] of Object.entries(emotions)) {
    if (keywords.some(k => lower.includes(k))) {
      return emotion;
    }
  }
  return 'friendly';
}
