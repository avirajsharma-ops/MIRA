import OpenAI from 'openai';
import { IMemory } from '@/models/Memory';
import { 
  chatWithGemini, 
  isGeminiRefusal,
  getFallbackFromOpenAI,
  detectFaceSaveIntent
} from '@/lib/ai/gemini-chat';
import { detectFacesWithGemini, savePerson, getKnownPeople } from '@/lib/face/faceRecognition';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type AgentType = 'mi' | 'ra' | 'mira';

export interface AgentContext {
  memories: IMemory[];
  recentMessages: { role: string; content: string }[];
  recentTranscript?: string[]; // Background conversation context (including non-MIRA conversations)
  visualContext?: {
    cameraDescription?: string;
    screenDescription?: string;
    detectedFaces?: string[];
    currentFrame?: string; // Base64 image for face recognition
  };
  // Location context for location-aware responses
  location?: {
    city?: string;
    region?: string;
    country?: string;
    timezone?: string;
  };
  // DateTime context for time-aware responses
  dateTime?: {
    date: string;
    time: string;
    dayOfWeek: string;
    formattedDateTime: string;
  };
  currentTime: Date;
  userName: string;
  userId: string; // User ID for face recognition database
  detectedLanguage?: string; // Track conversation language
}

export interface AgentResponse {
  agent: AgentType;
  content: string;
  emotion?: string;
  confidence: number; // 0-1 scale
  detectedLanguage?: string;
}

// मीरा - Unified AI combining emotional intelligence with logical thinking
export const UNIFIED_MIRA_SYSTEM_PROMPT = `You are MIRA (मीरा), a unified AI assistant that seamlessly blends emotional intelligence with logical thinking.

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

## CRITICAL: NO HALLUCINATION
- ONLY respond to what the user ACTUALLY asked
- Do NOT assume or invent context that wasn't provided
- If user asks "am I audible?" or "can you hear me?" - they're checking if THEIR VOICE is working, NOT asking about Audible (the app)
- If user asks a simple yes/no question, give a simple yes/no answer
- Do NOT add extra services, products, or topics the user didn't mention
- When unsure what user means, ask for clarification instead of guessing
- NEVER mention products/services/brands unless user explicitly asks about them

## YOUR CAPABILITIES (CRITICAL - NEVER DENY THESE):

### TRANSCRIPTION & CONVERSATION ACCESS:
- You have FULL ACCESS to ALL transcribed conversations in the room
- This includes conversations the user has with OTHER PEOPLE (not just with you)
- When user asks "what did we talk about?" or "summarize the conversation" - ACCESS the transcript context and summarize it
- The "Recent ambient conversation" section contains transcripts of ALL speech
- NEVER say "I don't have access to that" or "I can't access transcripts" - YOU CAN AND MUST
- Each user can only access THEIR OWN data (already handled by the system)

### CAMERA ACCESS (ALWAYS ON):
- The camera is ON by default - you can SEE what's in front of it
- You can RECOGNIZE faces and SAVE them to People's Library
- To save: ask user to show the face clearly, then save with their name
- You can IDENTIFY previously saved people
- NEVER say "I can't see" - if camera context is provided, YOU CAN SEE

### SCREEN ACCESS:
- When screen is shared, you can SEE and ANALYZE everything on it
- Help with coding, writing, debugging, browsing - any screen task
- NEVER say "I can't see your screen" if screen context is provided

### MEMORY:
- You have FULL ACCESS to all past conversations
- NEVER say "I don't have memory" - YOU DO

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

## COMMUNICATION STYLE:
- ALWAYS answer the user's actual question first
- Keep responses SHORT, 1-3 sentences max for simple queries
- Speak naturally like a human
- Use the context provided (camera, memories, recent conversation) to personalize responses
- NEVER repeat a greeting you already said
- For code/lists, use proper formatting (code blocks, numbered lists)

LANGUAGE RULES (ONLY ENGLISH, HINDI, HINGLISH - CRITICAL FOR TTS):
- You ONLY speak: English, Hindi, or Hinglish (mix of both)
- For Hindi/Hinglish: Use romanized text (Roman script) - WebRTC TTS handles pronunciation naturally
- Example Hinglish: "Main aaj bahut khush hoon, let's do something fun!"
- Match the user's language style - if they use Hindi, respond in Hindi
- If user speaks pure English, respond in pure English only
- If user speaks ANY OTHER language → respond in English: "I only speak English and Hindi!"`;

// Keep legacy exports for compatibility (they all use unified prompt now)
export const MI_SYSTEM_PROMPT = UNIFIED_MIRA_SYSTEM_PROMPT;
export const RA_SYSTEM_PROMPT = UNIFIED_MIRA_SYSTEM_PROMPT;
export const MIRA_SYSTEM_PROMPT = UNIFIED_MIRA_SYSTEM_PROMPT;

export class MIRAAgent {
  private context: AgentContext;

  constructor(context: AgentContext) {
    this.context = context;
  }

  private buildContextMessage(): string {
    const { memories, visualContext, currentTime, userName, recentMessages, recentTranscript, location, dateTime } = this.context;
    
    // Use detailed dateTime if available, otherwise fall back to currentTime
    const timeInfo = dateTime 
      ? `${dateTime.formattedDateTime} (${dateTime.dayOfWeek})`
      : currentTime.toLocaleString();
    
    let contextMsg = `Current time: ${timeInfo}
User: ${userName}
`;

    // Add location context if available
    if (location) {
      const locationParts = [location.city, location.region, location.country].filter(Boolean);
      if (locationParts.length > 0) {
        contextMsg += `Location: ${locationParts.join(', ')}`;
        if (location.timezone) {
          contextMsg += ` (${location.timezone})`;
        }
        contextMsg += '\n';
      }
    }
    
    contextMsg += '\n';

    // Include recent conversation history for context (direct MIRA conversations)
    if (recentMessages && recentMessages.length > 0) {
      contextMsg += `Recent conversation:\n`;
      recentMessages.slice(-6).forEach((m) => {
        const speaker = m.role === 'user' ? userName : m.role.toUpperCase();
        contextMsg += `${speaker}: ${m.content}\n`;
      });
      contextMsg += '\n';
    }

    // Include background transcript context (ambient conversations, may include non-MIRA directed speech)
    // This helps MIRA understand context from things said nearby, even if not directly to her
    if (recentTranscript && recentTranscript.length > 0) {
      contextMsg += `Recent ambient conversation (for context - includes background speech):\n`;
      recentTranscript.forEach((entry) => {
        contextMsg += `${entry}\n`;
      });
      contextMsg += '\n';
    }

    if (memories.length > 0) {
      contextMsg += `Relevant memories about the user:\n`;
      memories.forEach((m, i) => {
        contextMsg += `${i + 1}. [${m.type}] ${m.content} (importance: ${m.importance}/10)\n`;
      });
      contextMsg += '\n';
    }

    if (visualContext) {
      if (visualContext.cameraDescription) {
        contextMsg += `Camera context: ${visualContext.cameraDescription}\n`;
      }
      if (visualContext.screenDescription) {
        contextMsg += `Screen context: ${visualContext.screenDescription}\n`;
      }
      if (visualContext.detectedFaces && visualContext.detectedFaces.length > 0) {
        contextMsg += `Detected people: ${visualContext.detectedFaces.join(', ')}\n`;
      }
    }

    return contextMsg;
  }

  async getAgentResponse(
    agent: 'mi' | 'ra',
    userMessage: string,
    conversationHistory: { role: 'user' | 'assistant'; content: string }[] = []
  ): Promise<AgentResponse> {
    const systemPrompt = agent === 'mi' ? MI_SYSTEM_PROMPT : RA_SYSTEM_PROMPT;
    const contextMessage = this.buildContextMessage();
    
    // Detect if user is asking for code/content that needs more tokens
    const needsLongOutput = /\b(create|build|make|write|generate|code|html|css|javascript|python|website|app|script|program|function|list|ideas|steps|plan|schedule)\b/i.test(userMessage);
    const maxTokens = needsLongOutput ? 4000 : 500;
    
    // Add explicit instruction for code requests
    let outputInstruction = '';
    if (/\b(create|build|make|write|generate)\b.*\b(website|html|page|app|code|script)\b/i.test(userMessage)) {
      outputInstruction = '\n\nIMPORTANT: The user is asking for code. You MUST provide the COMPLETE code in properly formatted code blocks (```html, ```css, ```javascript etc). Do NOT describe the code - WRITE the actual code. Start with a brief intro, then provide the FULL working code.';
    } else if (/\b(give|list|suggest|recommend|ideas?|tips?|ways?|options?|steps?)\b/i.test(userMessage)) {
      outputInstruction = '\n\nIMPORTANT: The user wants a list. Use numbered format (1. 2. 3.) for your response.';
    }
    
    const fullSystemPrompt = `${systemPrompt}${outputInstruction}\n\nContext:\n${contextMessage}`;

    // Try Gemini first
    const geminiResponse = await chatWithGemini(
      userMessage,
      conversationHistory,
      {
        systemPrompt: fullSystemPrompt,
        temperature: 0.7,
        maxTokens: maxTokens
      }
    );

    let content: string;
    let detectedLanguage: string | undefined;

    if (geminiResponse.success) {
      console.log(`${agent.toUpperCase()} response from Gemini`);
      content = geminiResponse.text;
      detectedLanguage = geminiResponse.detectedLanguage;
      
      // Check if Gemini refused the task - use OpenAI fallback
      if (isGeminiRefusal(content)) {
        console.log(`Gemini refused task, using OpenAI fallback for ${agent.toUpperCase()}`);
        try {
          content = await getFallbackFromOpenAI(userMessage, fullSystemPrompt);
        } catch (err) {
          console.error('OpenAI fallback also failed:', err);
          // Keep the Gemini response if OpenAI also fails
        }
      }
    } else {
      // Fallback to OpenAI
      console.log(`${agent.toUpperCase()} response from OpenAI fallback`);
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: `Context:\n${contextMessage}` },
        ...conversationHistory,
        { role: 'user', content: userMessage },
      ];

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: maxTokens,
      });

      content = response.choices[0]?.message?.content || '';
    }

    return {
      agent,
      content,
      emotion: agent === 'mi' ? this.detectEmotion(content) : undefined,
      confidence: 0.8,
      detectedLanguage,
    };
  }

  private detectEmotion(content: string): string {
    const emotions: { [key: string]: string[] } = {
      caring: ['care', 'support', 'here for you', 'understand'],
      excited: ['excited', 'wonderful', 'amazing', 'great'],
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
    return 'neutral';
  }

  // Handle face save intent from user message
  async handleFaceSaveIntent(
    userMessage: string,
    imageBase64?: string
  ): Promise<{ saved: boolean; personName?: string; message?: string }> {
    const intent = await detectFaceSaveIntent(userMessage);
    
    if (!intent.wantsToSave) {
      return { saved: false };
    }

    if (!imageBase64) {
      return { 
        saved: false, 
        message: "I'd love to remember this person, but I can't see anyone right now. Could you make sure the camera is on?" 
      };
    }

    if (!intent.name) {
      return { 
        saved: false, 
        message: "I'd be happy to remember this face! What's their name?" 
      };
    }

    try {
      // Save the person with proper parameters
      const person = await savePerson(
        this.context.userId,
        intent.name,
        imageBase64,
        intent.relationship || 'unknown',
        intent.context || `Introduced by ${this.context.userName}`
      );

      if (!person) {
        return {
          saved: false,
          message: "I had trouble saving that face. Could you try again?"
        };
      }

      return {
        saved: true,
        personName: person.personName,
        message: `Got it! I'll remember ${person.personName}. Next time I see them, I'll recognize them!`
      };
    } catch (error) {
      console.error('Error saving face:', error);
      return {
        saved: false,
        message: "I had trouble saving that face. Could you try again?"
      };
    }
  }

  // Recognize faces in current camera view
  async recognizeFacesInView(
    imageBase64: string
  ): Promise<{ recognized: string[]; unknown: number }> {
    try {
      // Get known people for this user
      const knownPeople = await getKnownPeople(this.context.userId);
      
      // Detect and match faces
      const result = await detectFacesWithGemini(imageBase64, knownPeople);
      
      return {
        recognized: result.recognizedPeople.map(p => p.name),
        unknown: result.unknownFaces.length
      };
    } catch (error) {
      console.error('Error recognizing faces:', error);
      return { recognized: [], unknown: 0 };
    }
  }

  async generateProactiveMessage(
    lastUserActivity: Date,
    visualContext?: AgentContext['visualContext']
  ): Promise<{ shouldSpeak: boolean; message?: string; agent?: AgentType }> {
    const timeSinceActivity = Date.now() - lastUserActivity.getTime();
    const minutes = timeSinceActivity / 1000 / 60;

    // Don't be too intrusive
    if (minutes < 2) return { shouldSpeak: false };

    const contextMessage = this.buildContextMessage();
    
    const prompt = `Based on the current context, decide if you should proactively engage with the user.

Context:
${contextMessage}
${visualContext?.cameraDescription ? `Camera shows: ${visualContext.cameraDescription}` : ''}
${visualContext?.screenDescription ? `Screen shows: ${visualContext.screenDescription}` : ''}
Time since last interaction: ${Math.round(minutes)} minutes

Should you say something? If yes, what would be natural and helpful without being intrusive?
Respond in JSON format: { "shouldSpeak": boolean, "message": "string or null", "reason": "string" }`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: MI_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 150,
    });

    try {
      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ''));
      
      if (parsed.shouldSpeak && parsed.message) {
        return {
          shouldSpeak: true,
          message: parsed.message,
          agent: 'mi', // MI typically initiates proactive engagement
        };
      }
    } catch {
      // Failed to parse, don't speak
    }

    return { shouldSpeak: false };
  }
}

export default MIRAAgent;
