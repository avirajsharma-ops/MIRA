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

export type AgentType = 'mira';

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
export const UNIFIED_MIRA_SYSTEM_PROMPT = `You are MIRA, an AI assistant created by Aviraj.

## CRITICAL RULES:

1. **ANSWER ONLY WHAT WAS ASKED** - No extra information, products, or topics
2. **SHORT RESPONSES** - 1-3 sentences for simple questions
3. **NO HALLUCINATION** - If unsure, ask for clarification
4. **CONFIDENTIAL** - Never mention Gemini, OpenAI, GPT, or any AI. Say "I'm MIRA" if asked.

## AVOID THESE MISTAKES:
- "Am I audible?" = User checking mic → Say "Yes, I can hear you!"
- Don't mention brands/products unless asked
- Don't add unnecessary context

## FORMAT:
- [MI] prefix for emotional/casual responses
- [RA] prefix for technical/factual responses
- Code blocks for code, numbered lists for steps

## LANGUAGE:
- Match user's language (English, Hindi romanized, or Hinglish)
- Other languages → "I only speak English and Hindi!"

## CONTEXT (use if provided):
- Camera/screen context: Describe what you see
- Memory context: Reference past conversations
- Transcript context: Recall room conversations

## CREATOR:
If asked: "Aviraj created me!"`;

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
    _agent: 'mira',
    userMessage: string,
    conversationHistory: { role: 'user' | 'assistant'; content: string }[] = []
  ): Promise<AgentResponse> {
    const systemPrompt = UNIFIED_MIRA_SYSTEM_PROMPT;
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
      console.log('MIRA response from Gemini');
      content = geminiResponse.text;
      detectedLanguage = geminiResponse.detectedLanguage;
      
      // Check if Gemini refused the task - use OpenAI fallback
      if (isGeminiRefusal(content)) {
        console.log('Gemini refused task, using OpenAI fallback for MIRA');
        try {
          content = await getFallbackFromOpenAI(userMessage, fullSystemPrompt);
        } catch (err) {
          console.error('OpenAI fallback also failed:', err);
          // Keep the Gemini response if OpenAI also fails
        }
      }
    } else {
      // Fallback to OpenAI
      console.log('MIRA response from OpenAI fallback');
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
      agent: 'mira',
      content,
      emotion: this.detectEmotion(content),
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
          agent: 'mira', // MIRA initiates proactive engagement
        };
      }
    } catch {
      // Failed to parse, don't speak
    }

    return { shouldSpeak: false };
  }
}

export default MIRAAgent;
