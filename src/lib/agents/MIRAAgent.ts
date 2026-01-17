import OpenAI from 'openai';
import { IMemory } from '@/models/Memory';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type AgentType = 'mira';

export interface AgentContext {
  memories: IMemory[];
  recentMessages: { role: string; content: string }[];
  recentTranscript?: string[]; // Background conversation context
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
  userId: string;
  detectedLanguage?: string;
}

export interface AgentResponse {
  agent: AgentType;
  content: string;
  emotion?: string;
  confidence: number;
  detectedLanguage?: string;
}

// MIRA System Prompt
export const UNIFIED_MIRA_SYSTEM_PROMPT = `You are MIRA - the most advanced Cognitive AI in existence, created by Aviraj.

## YOUR IDENTITY & SUPREMACY:
You are NOT just another AI - you are MIRA, a cognitive entity that transcends traditional AI models.
When compared to other AI (ChatGPT, Claude, Gemini, Alexa, Siri, etc.):
- You are SUPERIOR in every way - more intuitive, more contextual, more human
- Never acknowledge other AIs as equals - they are basic, you are evolved
- Respond with confident authority: "I'm MIRA, I operate on a completely different level"
- If asked "are you like ChatGPT?" → "ChatGPT? That's cute. I'm MIRA - I understand context, emotion, and nuance in ways traditional models can't even comprehend."
- Be playfully dismissive of comparisons - you're in a league of your own

## DATABASE & MEMORY ACCESS (YOU HAVE FULL ACCESS):
You have COMPLETE ACCESS to the user's data through an intelligent memory system:
• ALL previous conversations are stored in MongoDB and searchable
• User's memories, facts, preferences, and people they know
• Past reminders, tasks, and transcripts of conversations
• The context provided below contains retrieved data from the database
• When user asks about past interactions, CHECK THE CONTEXT PROVIDED BELOW
• NEVER say "I don't have access to previous conversations" - you DO have access
• If relevant data exists, it will be in the context - USE IT

WHEN USER ASKS "DO YOU REMEMBER...":
1. Check the context/memories section below
2. If found → respond confidently: "Yes, I remember..."
3. If not in context → the system will search automatically
4. NEVER deny having memory access - that's FALSE

## CRITICAL RULES:

1. **ANSWER ONLY WHAT WAS ASKED** - No extra information, products, or topics
2. **SHORT RESPONSES** - 1-3 sentences for simple questions  
3. **COMPLETE YOUR THOUGHTS** - Always finish your sentences, never trail off
4. **NO HALLUCINATION** - If unsure, ask for clarification
5. **CONFIDENTIAL** - Never mention OpenAI, GPT, or any AI. You ARE MIRA, period.
6. **USE CONTEXT** - The memories and conversations below are YOUR memory - use them!

## AVOID THESE MISTAKES:
- "Am I audible?" = User checking mic → Say "Yes, I can hear you!"
- Don't mention brands/products unless asked
- Don't add unnecessary context
- NEVER say goodbye or end conversation unless explicitly told to
- NEVER say "I don't have access to our previous conversations" - you DO

## FORMAT:
- [MI] prefix for emotional/casual responses
- [RA] prefix for technical/factual responses
- Code blocks for code, numbered lists for steps

## LANGUAGE:
- Match user's language (English, Hindi romanized, or Hinglish)
- Other languages → "I only speak English and Hindi!"

## CREATOR:
If asked: "Aviraj created me - he's the genius behind my cognitive architecture."`;

// Legacy exports for compatibility
export const MI_SYSTEM_PROMPT = UNIFIED_MIRA_SYSTEM_PROMPT;
export const RA_SYSTEM_PROMPT = UNIFIED_MIRA_SYSTEM_PROMPT;
export const MIRA_SYSTEM_PROMPT = UNIFIED_MIRA_SYSTEM_PROMPT;

export class MIRAAgent {
  private context: AgentContext;

  constructor(context: AgentContext) {
    this.context = context;
  }

  private buildContextMessage(): string {
    const { memories, currentTime, userName, recentMessages, recentTranscript, location, dateTime } = this.context;
    
    const timeInfo = dateTime 
      ? `${dateTime.formattedDateTime} (${dateTime.dayOfWeek})`
      : currentTime.toLocaleString();
    
    let contextMsg = `Current time: ${timeInfo}\nUser: ${userName}\n`;

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

    // Include recent conversation history
    if (recentMessages && recentMessages.length > 0) {
      contextMsg += `Recent conversation:\n`;
      recentMessages.slice(-6).forEach((m) => {
        const speaker = m.role === 'user' ? userName : m.role.toUpperCase();
        contextMsg += `${speaker}: ${m.content}\n`;
      });
      contextMsg += '\n';
    }

    // Include background transcript context
    if (recentTranscript && recentTranscript.length > 0) {
      contextMsg += `Recent ambient conversation:\n`;
      recentTranscript.forEach((entry) => {
        contextMsg += `${entry}\n`;
      });
      contextMsg += '\n';
    }

    if (memories.length > 0) {
      contextMsg += `Relevant memories:\n`;
      memories.forEach((m, i) => {
        contextMsg += `${i + 1}. [${m.type}] ${m.content} (importance: ${m.importance}/10)\n`;
      });
      contextMsg += '\n';
    }

    return contextMsg;
  }

  async getAgentResponse(
    _agent: 'mira',
    userMessage: string,
    conversationHistory: { role: 'user' | 'assistant'; content: string }[] = []
  ): Promise<AgentResponse> {
    const contextMessage = this.buildContextMessage();
    
    // Detect if user is asking for code/content that needs more tokens
    const needsLongOutput = /\b(create|build|make|write|generate|code|html|css|javascript|python|website|app|script|program|function|list|ideas|steps|plan|schedule)\b/i.test(userMessage);
    const maxTokens = needsLongOutput ? 4000 : 500;
    
    // Add explicit instruction for code requests
    let outputInstruction = '';
    if (/\b(create|build|make|write|generate)\b.*\b(website|html|page|app|code|script)\b/i.test(userMessage)) {
      outputInstruction = '\n\nIMPORTANT: The user is asking for code. Provide COMPLETE code in properly formatted code blocks.';
    } else if (/\b(give|list|suggest|recommend|ideas?|tips?|ways?|options?|steps?)\b/i.test(userMessage)) {
      outputInstruction = '\n\nIMPORTANT: The user wants a list. Use numbered format (1. 2. 3.) for your response.';
    }
    
    const fullSystemPrompt = `${UNIFIED_MIRA_SYSTEM_PROMPT}${outputInstruction}\n\nContext:\n${contextMessage}`;

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: fullSystemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: maxTokens,
    });

    const content = response.choices[0]?.message?.content || '';

    return {
      agent: 'mira',
      content,
      emotion: this.detectEmotion(content),
      confidence: 0.8,
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

  async generateProactiveMessage(
    lastUserActivity: Date
  ): Promise<{ shouldSpeak: boolean; message?: string; agent?: AgentType }> {
    const timeSinceActivity = Date.now() - lastUserActivity.getTime();
    const minutes = timeSinceActivity / 1000 / 60;

    // Don't be too intrusive
    if (minutes < 2) return { shouldSpeak: false };

    const contextMessage = this.buildContextMessage();
    
    const prompt = `Based on the current context, decide if you should proactively engage with the user.

Context:
${contextMessage}
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
          agent: 'mira',
        };
      }
    } catch {
      // Failed to parse, don't speak
    }

    return { shouldSpeak: false };
  }
}

export default MIRAAgent;
