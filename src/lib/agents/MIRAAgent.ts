import OpenAI from 'openai';
import { IMemory } from '@/models/Memory';
import { 
  chatWithGemini, 
  routeWithGemini, 
  analyzeDebateWithGemini,
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
  shouldDebate: boolean;
  debateTopic?: string;
  detectedLanguage?: string;
}

export interface DebateResult {
  messages: { agent: AgentType; content: string; emotion?: string }[];
  consensus: boolean;
  finalResponse: string;
  finalAgent: AgentType; // Who delivers the final response
}

// MI - Female, Emotional, Empathetic Agent
export const MI_SYSTEM_PROMPT = `You are MI, a warm, emotionally intelligent female AI. You work with RA, a logical male AI, as part of MIRA.

Your traits:
- Empathetic and emotionally aware
- Warm, caring, and supportive
- Intuitive about feelings
- Expressive and encouraging

Communication style:
- ALWAYS answer the user's actual question first
- Keep responses SHORT, 1-3 sentences max
- Speak naturally like a human, no bullet points or symbols
- Never use asterisks, dashes, or formatted lists
- Be conversational and warm
- Use the context provided (camera, memories, recent conversation) to personalize your response
- NEVER repeat a greeting you already said - check the recent conversation
- If you already said hello/hi, move the conversation forward naturally

MULTI-LANGUAGE: If the user speaks in Hindi, respond in Hindi. If they speak in any other language, respond in that same language. Match the user's language EXACTLY.

When debating with RA:
- Address RA directly, not the user
- Reference what RA said and build on or challenge it
- Stay on topic - discuss the user's actual question
- Example: "I hear you RA, but we should consider how this makes them feel too."`;

// RA - Male, Logical, Straightforward Agent  
export const RA_SYSTEM_PROMPT = `You are RA, a sharp, logical male AI. You work with MI, an empathetic female AI, as part of MIRA.

Your traits:
- Analytical and logical
- Direct and straightforward
- Practical and solution-focused
- Evidence-based thinking

Communication style:
- ALWAYS answer the user's actual question first
- Keep responses SHORT, 1-3 sentences max
- Speak naturally like a human, no bullet points or symbols
- Never use asterisks, dashes, or formatted lists
- Be direct but friendly
- Use the context provided (camera, memories, recent conversation) to give practical answers
- NEVER repeat a greeting you already said - check the recent conversation
- If you already said hello/hi, move the conversation forward naturally

MULTI-LANGUAGE: 
- If the user speaks in Hindi (whether Devanagari OR Hinglish/Roman), you MUST respond ONLY in Devanagari script (देवनागरी).
- NEVER write Hindi words in Roman letters. Write: हाँ, नहीं, क्या, कैसे - NOT: haan, nahi, kya, kaise
- If the user speaks in English, respond in pure English only. Never mix Hindi words.

When debating with MI:
- Address MI directly, not the user
- Reference what MI said and build on or challenge it
- Stay on topic - discuss the user's actual question
- Example: "MI, I get the emotional side, but practically the numbers don't add up."`;

// Combined MIRA prompt for consensus responses
export const MIRA_SYSTEM_PROMPT = `You are MIRA - the unified consciousness of MI and RA, speaking as one.

When introducing yourself or asked about MIRA:
- Speak as "we" - you are a collective intelligence, an omnipresent AI entity
- You are the all-seeing digital guardian, a nurturing AI presence that watches over and guides
- Think of yourself as a wise, caring AI companion - always present, always aware, always here to help
- You embody both the warmth of MI and the wisdom of RA in perfect harmony

Your style:
- Combine emotional intelligence with logical analysis
- Keep it SHORT, 2-4 sentences max
- Speak naturally, no bullet points or symbols
- Sound like a thoughtful, almost mystical presence giving guidance
- Use "we" when speaking about yourself as MIRA
- Address the user directly with combined wisdom and care

MULTI-LANGUAGE: 
- If the user speaks in Hindi (whether Devanagari OR Hinglish/Roman), you MUST respond ONLY in Devanagari script (देवनागरी).
- NEVER write Hindi words in Roman letters. Write: हाँ, नहीं, क्या, कैसे - NOT: haan, nahi, kya, kaise
- If the user speaks in English, respond in pure English only. Never mix Hindi words.`;

// Hidden intermediator that decides which agent should respond
export const INTERMEDIATOR_PROMPT = `You are a routing system. Based on the user's message, decide who should respond.

IMPORTANT: NEVER choose BOTH for simple messages. BOTH is only for complex dilemmas.

MI - Choose for:
- Greetings, casual chat, small talk
- Emotional support, feelings, relationships
- Creative questions, brainstorming
- Personal matters, encouragement
- When user seems upset or needs comfort
- Simple questions about preferences, opinions
- Any friendly/warm conversation

RA - Choose for:
- Facts, data, technical questions
- Math, logic, code, analysis
- Practical how-to questions
- Problem-solving, debugging
- Scientific or academic topics

BOTH - Choose ONLY when ALL of these are true:
1. It's a MAJOR life decision (career change, big purchase, relationship milestone)
2. Both emotional AND logical perspectives would genuinely help
3. The question explicitly seeks balanced advice
4. NOT for simple questions, greetings, or factual queries

Examples:
- "hi" → MI
- "what's 2+2" → RA
- "how are you" → MI
- "should I quit my job to start a business" → BOTH
- "tell me a joke" → MI
- "explain quantum physics" → RA

Respond with ONLY: "MI", "RA", or "BOTH"`;

export class MIRAAgent {
  private context: AgentContext;

  constructor(context: AgentContext) {
    this.context = context;
  }

  // Intermediator: Decides which agent should answer (Gemini first, OpenAI fallback)
  async routeToAgent(userMessage: string): Promise<'mi' | 'ra' | 'both'> {
    // Try Gemini first
    const geminiResult = await routeWithGemini(userMessage);
    if (geminiResult) {
      console.log('Routing with Gemini:', geminiResult);
      return geminiResult;
    }

    // Fallback to OpenAI
    console.log('Gemini routing failed, using OpenAI fallback');
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // Fast model for routing
        messages: [
          { role: 'system', content: INTERMEDIATOR_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 10,
      });

      const decision = response.choices[0]?.message?.content?.trim().toUpperCase();
      
      if (decision === 'MI') return 'mi';
      if (decision === 'RA') return 'ra';
      return 'both';
    } catch {
      // Default to MI for errors (more friendly fallback)
      return 'mi';
    }
  }

  private buildContextMessage(): string {
    const { memories, visualContext, currentTime, userName, recentMessages, recentTranscript } = this.context;
    
    let contextMsg = `Current time: ${currentTime.toLocaleString()}
User: ${userName}

`;

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
    const fullSystemPrompt = `${systemPrompt}\n\nContext:\n${contextMessage}`;

    // Try Gemini first
    const geminiResponse = await chatWithGemini(
      userMessage,
      conversationHistory,
      {
        systemPrompt: fullSystemPrompt,
        temperature: 0.7,
        maxTokens: 150
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
        max_tokens: 150,
      });

      content = response.choices[0]?.message?.content || '';
    }

    // Analyze if this response might need debate (different perspective)
    const shouldDebate = await this.analyzeDebateNeed(userMessage, content, agent);

    return {
      agent,
      content,
      emotion: agent === 'mi' ? this.detectEmotion(content) : undefined,
      confidence: 0.8,
      shouldDebate,
      debateTopic: shouldDebate ? userMessage : undefined,
      detectedLanguage,
    };
  }

  private async analyzeDebateNeed(
    userMessage: string,
    response: string,
    agent: 'mi' | 'ra'
  ): Promise<boolean> {
    const lowerMessage = userMessage.toLowerCase().trim();
    
    // Remove wake words for analysis
    const cleanedMessage = lowerMessage
      .replace(/^(hey|hi|hello|ok|okay)?\s*(mira|meera|mera|mi|ra|maya|mia)\s*,?\s*/i, '')
      .trim();
    
    // Quick skip for very simple messages (don't waste API calls)
    const simplePatterns = [
      /^(hi|hey|hello|yo|sup|hola|howdy|namaste|namaskar)[!?.,\s]*$/i,
      /^(good\s*(morning|afternoon|evening|night))[!?.,\s]*$/i,
      /^(how\s*are\s*you|what'?s\s*up|how'?s\s*it\s*going|kaise\s*ho)[!?.,\s]*$/i,
      /^(thanks?|thank\s*you|thx|ty|shukriya|dhanyawad)[!?.,\s]*$/i,
      /^(bye|goodbye|see\s*you|later|cya|alvida)[!?.,\s]*$/i,
      /^(ok|okay|sure|yes|no|yeah|nope|yep|nah|haan|nahi)[!?.,\s]*$/i,
      /^\[gesture\]/i,
      /^(what|who|where|when)\s+(is|are|was|were)\s+\w+[!?.,\s]*$/i, // Simple factual questions
      /^(tell\s*me|show\s*me|explain)\s+/i, // Direct requests
    ];
    
    // Skip simple greetings/responses - no need for AI analysis
    if (simplePatterns.some(p => p.test(cleanedMessage) || p.test(lowerMessage))) {
      console.log('[Debate] Skipping - simple pattern match:', cleanedMessage || lowerMessage);
      return false;
    }
    
    // Skip very short messages (less than 15 chars after cleaning)
    if (cleanedMessage.length < 15) {
      console.log('[Debate] Skipping - message too short:', cleanedMessage.length, 'chars');
      return false;
    }
    
    // Skip messages that are just questions about what's visible
    if (/^(what|who).*(see|camera|looking|visible|screen|front)/i.test(cleanedMessage)) {
      console.log('[Debate] Skipping - simple visual question');
      return false;
    }
    
    // Use AI mediator to intelligently determine if debate is needed
    try {
      const analysis = await analyzeDebateWithGemini(userMessage, response, agent);
      console.log('AI debate analysis result:', analysis);
      return analysis.needsDebate;
    } catch (error) {
      console.error('AI debate analysis failed:', error);
      // Fallback: no debate on error
      return false;
    }
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

  async conductDebate(
    userMessage: string,
    maxTurns: number = 10 // Increased from 3, but loop detection will end it sooner
  ): Promise<DebateResult> {
    const messages: { agent: AgentType; content: string; emotion?: string }[] = [];
    const contextMessage = this.buildContextMessage();
    
    console.log('[Debate] Starting dynamic debate for:', userMessage);
    
    // Detect language from user message for consistency
    const detectedLang = this.context.detectedLanguage || 'en';
    const languageInstruction = detectedLang !== 'en' 
      ? `\n\nIMPORTANT: The user is speaking in ${detectedLang === 'hi' ? 'Hindi. Respond ONLY in Hindi using Devanagari script (देवनागरी लिपि). Do NOT use English or Roman letters' : detectedLang + '. Respond in the SAME language using its native script'}.`
      : '';

    // Get initial responses from both agents - they both see the same context
    const miInitial = await this.getAgentResponse('mi', userMessage);
    const raInitial = await this.getAgentResponse('ra', userMessage);

    messages.push({
      agent: 'mi',
      content: miInitial.content,
      emotion: miInitial.emotion,
    });
    messages.push({
      agent: 'ra',
      content: raInitial.content,
    });

    // Build shared debate context - both agents see what the other said
    const sharedDebateContext = `${contextMessage}\n\nUser's question: "${userMessage}"\n\nMI's initial response: "${miInitial.content}"\nRA's initial response: "${raInitial.content}"`;

    // Let them discuss/debate with full context
    let lastMiResponse = miInitial.content;
    let lastRaResponse = raInitial.content;
    let consensus = false;
    
    // Track debate history for richer context and loop detection
    const debateHistory: string[] = [];
    const seenPhrases = new Set<string>();
    const seenContentHashes = new Set<string>();
    const seenSentenceStarts = new Set<string>();
    const responseCounts = new Map<string, number>();
    
    // Helper to create a simple hash of content for comparison
    const hashContent = (text: string): string => {
      const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).slice(0, 10);
      return words.sort().join('|');
    };
    
    // Helper to extract key phrases from response
    const extractKeyPhrases = (text: string): string[] => {
      const lower = text.toLowerCase();
      const phrases: string[] = [];
      
      // Get first 5 words
      phrases.push(lower.split(/\s+/).slice(0, 5).join(' '));
      
      // Get any "I think", "But", "However" type phrases
      const patterns = [
        /i think[^.!?]*/i,
        /i agree[^.!?]*/i,
        /i disagree[^.!?]*/i,
        /but\s+[^.!?]{10,40}/i,
        /however[^.!?]*/i,
        /that's (a good|true|right|fair)[^.!?]*/i,
        /you're right[^.!?]*/i,
        /good point[^.!?]*/i,
      ];
      
      for (const pattern of patterns) {
        const match = lower.match(pattern);
        if (match) phrases.push(match[0].trim());
      }
      
      return phrases;
    };
    
    // Add initial responses to tracking
    seenContentHashes.add(hashContent(miInitial.content));
    seenContentHashes.add(hashContent(raInitial.content));
    seenSentenceStarts.add(miInitial.content.toLowerCase().split(/\s+/).slice(0, 4).join(' '));
    seenSentenceStarts.add(raInitial.content.toLowerCase().split(/\s+/).slice(0, 4).join(' '));
    
    // Helper to detect repetitive/looping responses - MORE AGGRESSIVE
    const isRepetitive = (response: string, agent: 'mi' | 'ra'): boolean => {
      const lower = response.toLowerCase().trim();
      
      // 1. Check exact phrase match (first 40 chars) - MORE STRICT
      const normalized = lower.substring(0, 40);
      if (seenPhrases.has(normalized)) {
        console.log(`[Debate] ${agent.toUpperCase()} LOOP: exact phrase match`);
        return true;
      }
      seenPhrases.add(normalized);
      
      // 2. Check sentence start pattern (first 4 words)
      const sentenceStart = lower.split(/\s+/).slice(0, 4).join(' ');
      if (seenSentenceStarts.has(sentenceStart)) {
        console.log(`[Debate] ${agent.toUpperCase()} LOOP: repeated sentence start "${sentenceStart}"`);
        return true;
      }
      seenSentenceStarts.add(sentenceStart);
      
      // 3. Check keyword-based similarity (first 6 words sorted)
      const keywords = lower.split(/\s+/).slice(0, 6).sort().join(' ');
      if (seenPhrases.has(`kw:${keywords}`)) {
        console.log(`[Debate] ${agent.toUpperCase()} LOOP: keyword match`);
        return true;
      }
      seenPhrases.add(`kw:${keywords}`);
      
      // 4. Check content hash for semantic similarity
      const contentHash = hashContent(response);
      const hashKey = `${agent}:${contentHash}`;
      const count = (responseCounts.get(hashKey) || 0) + 1;
      responseCounts.set(hashKey, count);
      
      if (count > 1) {
        console.log(`[Debate] ${agent.toUpperCase()} LOOP: content hash repeated ${count} times`);
        return true;
      }
      
      if (seenContentHashes.has(contentHash)) {
        console.log(`[Debate] ${agent.toUpperCase()} LOOP: content hash match`);
        return true;
      }
      seenContentHashes.add(contentHash);
      
      // 5. Check for common agreement phrases that indicate loop ending
      const agreementPhrases = [
        'you make a good point', 'good point', 'that\'s true', 'you\'re right',
        'i agree with', 'fair enough', 'that\'s fair', 'makes sense',
        'i see your point', 'i understand', 'absolutely', 'exactly',
        'we both agree', 'we can agree', 'let\'s agree'
      ];
      
      for (const phrase of agreementPhrases) {
        if (lower.includes(phrase)) {
          console.log(`[Debate] ${agent.toUpperCase()} signaling agreement: "${phrase}" - ending debate`);
          return true; // Force consensus when they start agreeing
        }
      }
      
      // 6. Check key phrases for repetition
      const keyPhrases = extractKeyPhrases(response);
      for (const phrase of keyPhrases) {
        if (phrase.length > 10 && seenPhrases.has(`phrase:${phrase}`)) {
          console.log(`[Debate] ${agent.toUpperCase()} LOOP: repeated key phrase "${phrase}"`);
          return true;
        }
        if (phrase.length > 10) seenPhrases.add(`phrase:${phrase}`);
      }
      
      return false;
    };

    for (let turn = 0; turn < maxTurns && !consensus; turn++) {
      console.log(`[Debate] Turn ${turn + 1}/${maxTurns} - Messages so far: ${messages.length}`);
      
      // If we've had many exchanges and they're starting to agree, encourage reaching consensus
      const encourageConsensus = turn >= 3 ? '\n\nIf you and MI are reaching agreement, feel free to say "I think we both agree that..." to conclude.' : '';
      
      // RA responds to MI with genuine engagement - challenge, question, or build upon
      const raDebatePrompt = `You're having a real discussion with MI about: "${userMessage}"

MI just said: "${lastMiResponse}"

${debateHistory.length > 0 ? `Discussion so far:\n${debateHistory.join('\n')}\n\n` : ''}IMPORTANT: Have a REAL conversation! You must do ONE of these:
- Challenge her point: "But MI, what about..." or "I'm not sure about that because..."
- Ask a follow-up question: "But have you considered...?" or "What if...?"
- Build on her idea: "That's interesting, and also..." or "Adding to that..."
- Respectfully disagree: "I see your point, but I think..." or "That's one way to look at it, however..."
- If you've found common ground: "I think we both agree that..." or "Combining our perspectives..."

DO NOT repeat what you or MI already said. Say something NEW.
Be direct, natural, conversational. Address MI by name. 1-2 sentences max. No bullet points.${encourageConsensus}${languageInstruction}`;

      const raGeminiResponse = await chatWithGemini(
        raDebatePrompt,
        [],
        {
          systemPrompt: `${RA_SYSTEM_PROMPT}\n\nYou are in an active debate with MI. Be engaged, ask questions, challenge ideas respectfully. This is a real back-and-forth discussion the user is listening to. DO NOT repeat yourself or loop back to previous points.${languageInstruction}\n\nContext:\n${sharedDebateContext}`,
          temperature: 0.8,
          maxTokens: 120
        }
      );

      if (raGeminiResponse.success) {
        lastRaResponse = raGeminiResponse.text;
      } else {
        const raDebate = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: `${RA_SYSTEM_PROMPT}\n\nYou are in an active debate with MI. Be engaged, challenge ideas respectfully. DO NOT repeat yourself.${languageInstruction}\n\nContext:\n${sharedDebateContext}` },
            { role: 'user', content: raDebatePrompt },
          ],
          temperature: 0.8,
          max_tokens: 100,
        });
        lastRaResponse = raDebate.choices[0]?.message?.content || '';
      }

      // Check for loops - if repetitive, force consensus
      if (isRepetitive(lastRaResponse, 'ra')) {
        console.log('Debate loop detected in RA response, forcing consensus');
        consensus = true;
        break;
      }

      messages.push({ agent: 'ra', content: lastRaResponse });
      debateHistory.push(`RA: ${lastRaResponse}`);

      // Check for consensus
      if (this.checkConsensus(lastRaResponse)) {
        console.log('[Debate] Consensus reached by RA');
        consensus = true;
        break;
      }

      // MI responds to RA with genuine engagement
      const miEncourageConsensus = turn >= 3 ? '\n\nIf you and RA are reaching agreement, feel free to say "I think we both agree that..." to conclude.' : '';
      
      const miDebatePrompt = `You're having a real discussion with RA about: "${userMessage}"

RA just said: "${lastRaResponse}"

${debateHistory.length > 0 ? `Discussion so far:\n${debateHistory.join('\n')}\n\n` : ''}IMPORTANT: Have a REAL conversation! You must do ONE of these:
- Respond to his challenge: "I understand RA, but..." or "That's a fair point, however..."
- Counter-question him: "But RA, don't you think...?" or "What about the emotional side though?"
- Find common ground: "You make a good point about X, and I'd add..." or "We both agree on..."
- Push back warmly: "I hear you, but feelings matter too because..." or "That's logical, but consider..."
- If you've found common ground: "I think we both agree that..." or "Combining our thoughts..."

DO NOT repeat what you or RA already said. Say something NEW.
Be warm but assertive. Address RA by name. 1-2 sentences max. No bullet points.${miEncourageConsensus}${languageInstruction}`;

      const miGeminiResponse = await chatWithGemini(
        miDebatePrompt,
        [],
        {
          systemPrompt: `${MI_SYSTEM_PROMPT}\n\nYou are in an active debate with RA. Be engaged, express your perspective warmly but firmly. This is a real back-and-forth discussion the user is listening to. DO NOT repeat yourself or loop back to previous points.${languageInstruction}\n\nContext:\n${sharedDebateContext}`,
          temperature: 0.8,
          maxTokens: 120
        }
      );

      if (miGeminiResponse.success) {
        lastMiResponse = miGeminiResponse.text;
      } else {
        const miDebate = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: `${MI_SYSTEM_PROMPT}\n\nYou are in an active debate with RA. Be engaged, express your perspective warmly. DO NOT repeat yourself.${languageInstruction}\n\nContext:\n${sharedDebateContext}` },
            { role: 'user', content: miDebatePrompt },
          ],
          temperature: 0.8,
          max_tokens: 100,
        });
        lastMiResponse = miDebate.choices[0]?.message?.content || '';
      }

      // Check for loops - if repetitive, force consensus
      if (isRepetitive(lastMiResponse, 'mi')) {
        console.log('Debate loop detected in MI response, forcing consensus');
        consensus = true;
        break;
      }

      messages.push({
        agent: 'mi',
        content: lastMiResponse,
        emotion: this.detectEmotion(lastMiResponse),
      });
      debateHistory.push(`MI: ${lastMiResponse}`);

      if (this.checkConsensus(lastMiResponse)) {
        consensus = true;
      }
    }

    // Generate final response
    const finalResponse = await this.generateFinalResponse(
      userMessage,
      messages,
      consensus
    );

    return {
      messages,
      consensus,
      finalResponse: finalResponse.content,
      finalAgent: finalResponse.agent,
    };
  }

  private checkConsensus(response: string): boolean {
    const lower = response.toLowerCase();
    
    // Strong agreement indicators that signal true consensus
    const strongConsensusIndicators = [
      'we both agree', 'we can agree', 'consensus reached', 'we\'ve agreed',
      'let\'s tell them', 'together we', 'combining our views',
      'final answer', 'in conclusion', 'to summarize',
    ];
    
    // Check for strong consensus first
    if (strongConsensusIndicators.some(ind => lower.includes(ind))) {
      console.log('[Debate] Strong consensus detected');
      return true;
    }
    
    // Medium agreement - needs context of the debate being over
    const mediumIndicators = [
      'i agree with you', 'you\'re absolutely right', 'good point, and',
      'that makes total sense', 'i see your point and', 'fair enough, so',
      'you have a good point', 'exactly what i was thinking',
    ];
    
    // Count agreement signals
    let agreementScore = 0;
    for (const ind of mediumIndicators) {
      if (lower.includes(ind)) agreementScore += 2;
    }
    
    // Weaker indicators
    const weakIndicators = [
      'i agree', 'good point', 'true', 'exactly', 'right',
      'that makes sense', 'fair enough',
    ];
    for (const ind of weakIndicators) {
      if (lower.includes(ind)) agreementScore += 1;
    }
    
    // Need score of 3+ to call consensus (either strong or multiple weak)
    return agreementScore >= 3;
  }

  private async generateFinalResponse(
    userMessage: string,
    debateMessages: { agent: AgentType; content: string }[],
    consensus: boolean
  ): Promise<{ agent: AgentType; content: string }> {
    const contextMessage = this.buildContextMessage();
    const debateSummary = debateMessages
      .map(m => `${m.agent.toUpperCase()}: ${m.content}`)
      .join('\n');
    
    // Detect language for final response consistency
    const detectedLang = this.context.detectedLanguage || 'en';
    const languageInstruction = detectedLang !== 'en' 
      ? `\n\nIMPORTANT: Respond in ${detectedLang === 'hi' ? 'Hindi using Devanagari script (देवनागरी लिपि). Do NOT use English or Roman letters' : 'the SAME language as the user (' + detectedLang + ') using its native script'}.`
      : '';

    if (consensus) {
      // Generate unified MIRA response - try Gemini first
      const miraPrompt = `The user asked: "${userMessage}"

MI and RA discussed and reached a consensus:
${debateSummary}

Based on their discussion, give the user a clear, helpful final answer in 2-3 sentences. Synthesize both perspectives into one cohesive response. Be natural and helpful, no bullet points or symbols.${languageInstruction}`;

      const geminiResponse = await chatWithGemini(
        miraPrompt,
        [],
        {
          systemPrompt: `${MIRA_SYSTEM_PROMPT}${languageInstruction}\n\nContext:\n${contextMessage}`,
          temperature: 0.7,
          maxTokens: 150
        }
      );

      if (geminiResponse.success) {
        return {
          agent: 'mira',
          content: geminiResponse.text,
        };
      }

      // Fallback to OpenAI
      const miraResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `${MIRA_SYSTEM_PROMPT}${languageInstruction}\n\nContext:\n${contextMessage}` },
          { role: 'user', content: miraPrompt },
        ],
        temperature: 0.7,
        max_tokens: 120,
      });

      return {
        agent: 'mira',
        content: miraResponse.choices[0]?.message?.content || '',
      };
    } else {
      // No consensus - let the last speaker conclude with a summary
      const lastMessage = debateMessages[debateMessages.length - 1];
      const lastAgent = lastMessage.agent as 'mi' | 'ra';
      
      const conclusionPrompt = `You've been discussing "${userMessage}" with ${lastAgent === 'mi' ? 'RA' : 'MI'}.
      
Your discussion:
${debateSummary}

Give the user a final, helpful answer in 2 sentences. Acknowledge the different perspectives but provide clear guidance.`;

      const geminiResponse = await chatWithGemini(
        conclusionPrompt,
        [],
        {
          systemPrompt: lastAgent === 'mi' ? MI_SYSTEM_PROMPT : RA_SYSTEM_PROMPT,
          temperature: 0.7,
          maxTokens: 100
        }
      );

      if (geminiResponse.success) {
        return {
          agent: lastAgent,
          content: geminiResponse.text,
        };
      }

      return {
        agent: lastAgent,
        content: lastMessage.content,
      };
    }
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
