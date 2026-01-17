/**
 * Instruction Detection Service
 * 
 * Detects when users give MIRA instructions, preferences, or corrections
 * and automatically saves them for personalization.
 */

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface DetectedInstruction {
  category: 
    | 'speaking_pattern'
    | 'response_style'
    | 'address_preference'
    | 'topic_preference'
    | 'behavior_rule'
    | 'personal_info'
    | 'work_context'
    | 'schedule_preference'
    | 'communication_style'
    | 'learning'
    | 'explicit_instruction'
    | 'correction'
    | 'other';
  instruction: string;
  priority: number;
  source: 'explicit' | 'inferred' | 'correction' | 'preference' | 'pattern';
  confidence: number;
  tags: string[];
}

// Quick pattern-based detection for common instruction types
const INSTRUCTION_PATTERNS = [
  // Explicit instructions
  { 
    patterns: [
      /(?:always|never|don'?t)\s+(?:call me|address me|say|tell|ask|remind|forget)/i,
      /(?:from now on|going forward|remember that)\s+/i,
      /(?:i want you to|i need you to|please always|please never)/i,
      /(?:can you|could you)\s+(?:always|never|stop|start)/i,
      /(?:stop|start|begin|quit)\s+(?:calling|saying|asking|telling)/i,
    ],
    category: 'explicit_instruction' as const,
    source: 'explicit' as const,
    priority: 9,
  },
  // Address preferences
  {
    patterns: [
      /(?:call me|my name is|i'?m called|address me as|refer to me as)\s+(\w+)/i,
      /(?:don'?t call me|stop calling me|i hate being called)\s+(\w+)/i,
      /(?:i prefer|please use)\s+(?:my|the name)\s+(\w+)/i,
    ],
    category: 'address_preference' as const,
    source: 'explicit' as const,
    priority: 10,
  },
  // Response style
  {
    patterns: [
      /(?:be more|be less)\s+(?:formal|casual|brief|detailed|funny|serious)/i,
      /(?:shorter|longer|more detailed|less wordy)\s+(?:answers|responses|replies)/i,
      /(?:don'?t|stop)\s+(?:be so|being so)\s+(?:formal|verbose|wordy|brief)/i,
      /(?:i like|i prefer)\s+(?:short|long|detailed|brief)\s+(?:answers|responses)/i,
    ],
    category: 'response_style' as const,
    source: 'preference' as const,
    priority: 8,
  },
  // Corrections
  {
    patterns: [
      /(?:no|that'?s wrong|incorrect|not like that|i said)/i,
      /(?:i didn'?t|that'?s not what i)\s+(?:mean|say|want|ask)/i,
      /(?:stop doing that|don'?t do that|quit it)/i,
    ],
    category: 'correction' as const,
    source: 'correction' as const,
    priority: 8,
  },
  // Personal info
  {
    patterns: [
      /(?:i work|i'?m a|my job is|i do)\s+(?:at|as|in)\s+/i,
      /(?:i live|i'?m from|i'?m based|my home is)\s+(?:in|at)\s+/i,
      /(?:my (?:wife|husband|partner|girlfriend|boyfriend|family|kids?|children|mom|dad|brother|sister))/i,
      /(?:i have|i'?ve got)\s+(?:a|two|three|\d+)\s+(?:kids?|children|dogs?|cats?)/i,
    ],
    category: 'personal_info' as const,
    source: 'inferred' as const,
    priority: 6,
  },
  // Schedule preferences
  {
    patterns: [
      /(?:i'?m a|i'?m more of a)\s+(?:morning|night|early|late)\s+(?:person|bird|owl)/i,
      /(?:i usually|i normally|i typically)\s+(?:wake|sleep|work|eat)\s+(?:at|around)/i,
      /(?:don'?t|never)\s+(?:disturb|bother|remind|call)\s+me\s+(?:before|after|in the)/i,
    ],
    category: 'schedule_preference' as const,
    source: 'preference' as const,
    priority: 7,
  },
  // Topic preferences
  {
    patterns: [
      /(?:i love|i hate|i'?m interested in|i don'?t care about)\s+/i,
      /(?:don'?t talk|stop talking|let'?s not discuss)\s+(?:about|to me about)/i,
      /(?:i'?m passionate about|my hobby is|i enjoy)\s+/i,
    ],
    category: 'topic_preference' as const,
    source: 'preference' as const,
    priority: 5,
  },
  // Communication style
  {
    patterns: [
      /(?:i prefer|i like)\s+(?:texting|calling|voice|chat)/i,
      /(?:speak|talk)\s+(?:to me|with me)\s+(?:like|as if)/i,
      /(?:use|don'?t use)\s+(?:emojis?|slang|technical|jargon)/i,
    ],
    category: 'communication_style' as const,
    source: 'preference' as const,
    priority: 7,
  },
];

/**
 * Quick pattern-based detection (fast, no API call)
 */
export function quickDetectInstructions(text: string): DetectedInstruction[] {
  const detected: DetectedInstruction[] = [];
  const lowerText = text.toLowerCase();
  
  for (const rule of INSTRUCTION_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        detected.push({
          category: rule.category,
          instruction: text.trim(),
          priority: rule.priority,
          source: rule.source,
          confidence: 0.7,
          tags: [rule.category],
        });
        break; // Only match once per rule
      }
    }
  }
  
  return detected;
}

/**
 * Deep AI-based detection (slower, more accurate)
 * Use this for important messages or when quick detection finds something
 */
export async function deepDetectInstructions(
  userMessage: string,
  miraResponse?: string,
  conversationContext?: string
): Promise<DetectedInstruction[]> {
  try {
    const prompt = `Analyze this conversation for user instructions, preferences, or customizations that should be remembered.

USER MESSAGE: "${userMessage}"
${miraResponse ? `MIRA'S RESPONSE: "${miraResponse}"` : ''}
${conversationContext ? `CONTEXT: ${conversationContext}` : ''}

Extract ANY of the following if present:
1. explicit_instruction: Direct commands ("always do X", "never say Y", "remember that Z")
2. address_preference: How to address the user (name, nickname, title)
3. response_style: How they want responses (formal/casual, long/short, etc.)
4. behavior_rule: Specific rules for behavior
5. personal_info: Personal facts (job, family, location)
6. work_context: Work-related info (company, role, projects)
7. schedule_preference: Time preferences (morning person, don't disturb before X)
8. communication_style: How they like to communicate
9. topic_preference: Topics they like/dislike
10. correction: Corrections to MIRA's behavior
11. learning: Inferred preferences from how they communicate

Return JSON array of detected instructions (empty array if none):
[{
  "category": "category_name",
  "instruction": "clear, actionable instruction for MIRA to follow",
  "priority": 1-10,
  "source": "explicit|inferred|correction|preference|pattern",
  "confidence": 0.0-1.0,
  "tags": ["relevant", "tags"]
}]

ONLY extract real, actionable instructions. Don't make things up.
Be strict - if nothing is instructional, return [].`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '[]';
    
    try {
      const parsed = JSON.parse(content);
      const instructions = Array.isArray(parsed) ? parsed : (parsed.instructions || []);
      return instructions.filter((i: any) => 
        i.category && i.instruction && i.confidence >= 0.5
      );
    } catch {
      console.warn('[Instruction Detection] Failed to parse response:', content);
      return [];
    }
  } catch (error) {
    console.error('[Instruction Detection] AI detection error:', error);
    return [];
  }
}

/**
 * Detect if a message is likely an instruction (fast check)
 */
export function isLikelyInstruction(text: string): boolean {
  const lowerText = text.toLowerCase();
  
  const instructionIndicators = [
    'always', 'never', 'don\'t', 'do not', 'stop', 'start',
    'remember', 'from now on', 'going forward', 'i want you to',
    'i need you to', 'please always', 'please never', 'call me',
    'address me', 'my name is', 'i prefer', 'i like', 'i hate',
    'be more', 'be less', 'shorter', 'longer', 'that\'s wrong',
    'not like that', 'i didn\'t mean', 'i work', 'i live',
    'i\'m a', 'my job', 'my wife', 'my husband', 'my family',
  ];
  
  return instructionIndicators.some(indicator => lowerText.includes(indicator));
}

/**
 * Process a conversation turn and extract instructions
 */
export async function processConversationForInstructions(
  userMessage: string,
  miraResponse?: string,
  options: {
    useDeepDetection?: boolean;
    conversationContext?: string;
  } = {}
): Promise<DetectedInstruction[]> {
  // First, quick pattern check
  const quickResults = quickDetectInstructions(userMessage);
  
  // If quick detection found something or message seems instructional, do deep detection
  if (options.useDeepDetection || quickResults.length > 0 || isLikelyInstruction(userMessage)) {
    try {
      const deepResults = await deepDetectInstructions(
        userMessage,
        miraResponse,
        options.conversationContext
      );
      
      // Merge results, preferring deep detection for duplicates
      const merged = new Map<string, DetectedInstruction>();
      
      for (const inst of quickResults) {
        merged.set(inst.category + ':' + inst.instruction.substring(0, 30), inst);
      }
      
      for (const inst of deepResults) {
        const key = inst.category + ':' + inst.instruction.substring(0, 30);
        if (!merged.has(key) || (merged.get(key)?.confidence || 0) < inst.confidence) {
          merged.set(key, inst);
        }
      }
      
      return Array.from(merged.values());
    } catch {
      return quickResults;
    }
  }
  
  return quickResults;
}
