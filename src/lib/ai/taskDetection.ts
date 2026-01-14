/**
 * Task Detection Module
 * Extracts tasks, deadlines, and commitments from speech/text
 */

export interface DetectedTask {
  title: string;
  description?: string;
  dueDate?: Date;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  confidence: number; // 0-1
  source: 'direct' | 'commitment' | 'meeting' | 'reminder_request' | 'deadline';
  originalText: string;
  isDirectedAtMira: boolean;
}

export interface TaskDetectionResult {
  isDirectedAtMira: boolean;
  shouldRespond: boolean;
  tasks: DetectedTask[];
  isPhoneCall: boolean;
  isPassiveConversation: boolean;
  conversationType: 'direct' | 'passive' | 'meeting' | 'call' | 'commitment';
}

// Wake word detection - English + Hindi/Hinglish
const MIRA_WAKE_WORDS = new Set([
  'mira', 'meera', 'myra', 'mera', 'maya', 'mia', 'miri',
  // Hindi variations
  'मीरा', 'मिरा', 'मायरा', 'मेरा',
]);

const MIRA_PREFIXES = [
  'hey mira', 'hi mira', 'hello mira', 'ok mira', 'okay mira',
  'mira can you', 'mira please', 'mira could you', 'mira would you',
  'mira remind me', 'mira set', 'mira add', 'mira create', 'mira schedule',
  // Hindi prefixes
  'मीरा', 'हाय मीरा', 'हेलो मीरा',
];

// Patterns that indicate user is NOT talking to MIRA
const PASSIVE_CONVERSATION_PATTERNS = [
  /\b(he said|she said|they said|I told him|I told her|I told them)\b/i,
  /\b(we were talking|I was telling|she was saying)\b/i,
  /\b(yeah|uh huh|mmhmm|right|exactly|totally)\b/i,
  /\b(nice to meet you|how are you doing|what's up)\b(?!.*mira)/i,
  /\b(see you|talk to you later|bye|goodbye|take care)\b(?!.*mira)/i,
];

// Patterns that indicate user IS talking to MIRA
const DIRECT_ADDRESS_PATTERNS = [
  /^(?:hey |hi |hello |ok |okay )?mira\b/i,
  /\bmira[,!?\s]+(?:can|could|would|please|I need|remind|set|add|schedule)/i,
  /\bremind me\b/i,
  /\bset (?:a |an )?(?:reminder|alarm|timer)\b/i,
  /\badd (?:a |an )?(?:task|reminder|event|meeting|to-?do)\b/i,
  /\bschedule (?:a |an )?(?:meeting|call|appointment)\b/i,
  /\bwhat (?:time|day|date) is it\b/i,
  /\bwhat's (?:the weather|my schedule|on my calendar)\b/i,
  // TODO/Task list specific patterns
  /\badd (?:this |these )?(?:to|in) (?:my )?(?:to-?do|task|reminder)/i,
  /\bmy (?:to-?do|task|reminder)s?(?:\s+(?:list|are|is))?/i,
  /\bcreate (?:a |an )?(?:task|reminder|to-?do)/i,
  /\bput (?:this |that )?(?:in|on) (?:my )?(?:to-?do|task|reminder)/i,
  /\bsave (?:this |that )?(?:as )?(?:a )?(?:task|reminder|to-?do)/i,
  // Hindi/Hinglish patterns
  /^मीरा/,
  /मीरा.*(?:याद|रिमाइंड|बता|remind)/i,
  /(?:याद दिला|remind कर|याद रख)/i,
  /(?:मुझे|मेरा|मेरे).*(?:इंटरव्यू|मीटिंग|कॉल|meeting|interview|call)/i,
];

// Task-related patterns to extract tasks from speech
const TASK_PATTERNS = {
  // Direct task requests to MIRA - FLEXIBLE PATTERNS
  reminderRequest: [
    // CRITICAL: "remind me in X minutes/hours to [task]" - extract task AFTER the time
    /remind me in (?:the )?(?:next )?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|a|an) (?:minutes?|hours?|days?) (?:to |about )?(.+)/i,
    
    // Standard reminder patterns - task comes BEFORE time
    /remind me (?:to |about )?(.+?)(?:\s+(?:at|by|on|in|tomorrow|next|this)\s+(.+))?$/i,
    /set (?:a |an )?reminder (?:to |for |about )?(.+?)(?:\s+(?:at|by|on|in)\s+(.+))?$/i,
    /add (?:a |an )?(?:task|reminder) (?:to |for |about )?(.+?)(?:\s+(?:at|by|on|in)\s+(.+))?$/i,
    /don't let me forget (?:to |about )?(.+)/i,
    /I need to remember (?:to )?(.+)/i,
    
    // TODO LIST patterns - more flexible
    /add (?:this )?(?:to |in )?(?:my )?(?:to-?do|task|reminder)(?:s)?(?: list)?[:.\s]+(.+)/i,
    /(?:put|create|make|save) (?:a )?(?:task|reminder|todo)(?:s)?(?: for)?[:.\s]+(.+)/i,
    /(?:my )?(?:to-?do|task)(?:s)?(?:are|is|:)\s*(.+)/i,
    /(?:add|create) (?:these |this )?(?:task|reminder|todo)s?[:.\s]+(.+)/i,
    
    // Task description patterns - when user lists tasks
    /(?:first|1st)(?:,|:)?\s*(.+?)(?:(?:,|\.|second|2nd|and)|$)/i,
    /(?:one|1)[.:)]\s*(.+?)(?:(?:,|\.|two|2)|$)/i,
    
    // Interview/meeting specific (from user's example)
    /(?:I have|there'?s|got) (?:an? )?(.+?)\s+(?:interview|meeting|call)(?:\s+(?:at|on|tomorrow|today))?/i,
    /(.+?)\s+(?:interview|meeting|call)\s+(?:at|on|tomorrow|today|scheduled)/i,
    
    // === HINDI/HINGLISH PATTERNS ===
    // "मुझे इंटरव्यू लेना है" - I have to take an interview
    /(?:मुझे|मेरा|मेरे).+?(इंटरव्यू|मीटिंग|कॉल|interview|meeting|call)/i,
    // "कल X बजे interview है" - Tomorrow at X interview
    /(?:कल|आज|परसों).+?(\d+|एक|दो|तीन|चार|पांच|छह|सात|आठ|नौ|दस|ग्यारह|बारह).+?(?:बजे)?.+?(इंटरव्यू|मीटिंग|कॉल|interview|meeting|call)/i,
    // Generic Hindi task with time
    /(इंटरव्यू|मीटिंग|कॉल).+?(?:कल|आज|परसों|tomorrow|today)/i,
  ],
  
  // Meeting/scheduling patterns
  meeting: [
    /(?:schedule|set up|arrange|plan) (?:a |an )?(?:meeting|call|appointment) (?:with |for )?(.+?)(?:\s+(?:at|on|for)\s+(.+))?$/i,
    /(?:meeting|call|appointment) (?:with |for )(.+?) (?:at|on|for) (.+)/i,
    /(?:I have|there's|got) (?:a |an )?(?:meeting|call|appointment) (?:with |for )?(.+?) (?:at|on) (.+)/i,
    // Hindi patterns
    /(?:मुझे|मेरी|मेरा).+?(मीटिंग|इंटरव्यू|कॉल).+?(?:है|हैं)/i,
    /(मीटिंग|इंटरव्यू|कॉल).+?(\d+|एक|दो|तीन).+?बजे/i,
  ],
  
  // Commitment patterns (user promises to do something)
  commitment: [
    /I (?:will|'ll|need to|have to|should|must|gotta|got to) (.+?)(?:\s+(?:by|before|tomorrow|next|this)\s+(.+))?$/i,
    /I (?:promised|committed|agreed) to (.+)/i,
    /I'm (?:going to|gonna) (.+)/i,
    /(?:make sure|don't forget) (?:I |to )(.+)/i,
  ],
  
  // Deadline patterns
  deadline: [
    /(.+?) (?:is |are )?due (?:by |on |at )?(.+)/i,
    /deadline (?:for |is )?(.+?) (?:is )?(.+)/i,
    /(?:have to|need to|must) (?:finish|complete|submit|send) (.+?) (?:by|before) (.+)/i,
  ],
  
  // Other person commitment (overheard in conversation)
  otherCommitment: [
    /(?:he|she|they) (?:will|'ll|promised to|said (?:he|she|they) would) (.+)/i,
    /(?:he|she|they) (?:need|needs) to (.+)/i,
  ],
};

// Time parsing patterns
const TIME_PATTERNS = {
  relativeTime: [
    // Support both digit and word numbers: "in 5 minutes" or "in five minutes"
    { pattern: /in (?:the )?(?:next )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty) minutes?/i, getDate: (m: RegExpMatchArray) => addMinutes(new Date(), parseWordNumber(m[1])) },
    { pattern: /in (?:the )?(?:next )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty) hours?/i, getDate: (m: RegExpMatchArray) => addHours(new Date(), parseWordNumber(m[1])) },
    { pattern: /in (?:the )?(?:next )?(\d+|one|two|three|four|five|six|seven) days?/i, getDate: (m: RegExpMatchArray) => addDays(new Date(), parseWordNumber(m[1])) },
    { pattern: /in (?:the )?(?:next )?(\d+|one|two|three|four) weeks?/i, getDate: (m: RegExpMatchArray) => addDays(new Date(), parseWordNumber(m[1]) * 7) },
    // Also match "next X minutes/hours"
    { pattern: /(?:the )?next (\d+|one|two|three|four|five|ten|fifteen|twenty|thirty) minutes?/i, getDate: (m: RegExpMatchArray) => addMinutes(new Date(), parseWordNumber(m[1])) },
  ],
  absoluteTime: [
    { pattern: /at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i, getDate: parseTimeOfDay },
    { pattern: /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i, getDate: parseTimeOfDay },
    // Hindi: "तीन बजे" (3 o'clock), "3 बजे"
    { pattern: /(\d{1,2}|एक|दो|तीन|चार|पांच|छह|सात|आठ|नौ|दस|ग्यारह|बारह)\s*बजे/i, getDate: (m: RegExpMatchArray) => parseHindiTimeOfDay(m) },
  ],
  relativeDay: [
    { pattern: /tomorrow/i, getDate: () => addDays(setTimeToMorning(new Date()), 1) },
    { pattern: /today/i, getDate: () => new Date() },
    { pattern: /tonight/i, getDate: () => setTimeToEvening(new Date()) },
    { pattern: /this evening/i, getDate: () => setTimeToEvening(new Date()) },
    { pattern: /this afternoon/i, getDate: () => setTimeToAfternoon(new Date()) },
    { pattern: /this morning/i, getDate: () => setTimeToMorning(new Date()) },
    { pattern: /next week/i, getDate: () => addDays(new Date(), 7) },
    { pattern: /next month/i, getDate: () => addMonths(new Date(), 1) },
    // Hindi relative days
    { pattern: /कल/i, getDate: () => addDays(setTimeToMorning(new Date()), 1) }, // tomorrow
    { pattern: /आज/i, getDate: () => new Date() }, // today
    { pattern: /परसों/i, getDate: () => addDays(setTimeToMorning(new Date()), 2) }, // day after tomorrow
  ],
  hindiTimeOfDay: [
    // "दुपहर में" (in the afternoon), "सुबह" (morning), "शाम को" (in the evening), "रात को" (at night)
    { pattern: /दुपहर(?:\s*में)?/i, getDate: () => setTimeToAfternoon(new Date()) },
    { pattern: /सुबह(?:\s*में)?/i, getDate: () => setTimeToMorning(new Date()) },
    { pattern: /शाम(?:\s*को|\s*में)?/i, getDate: () => setTimeToEvening(new Date()) },
    { pattern: /रात(?:\s*को|\s*में)?/i, getDate: () => setTimeToNight(new Date()) },
  ],
  weekday: [
    { pattern: /(?:next |this )?monday/i, getDate: () => getNextWeekday(1) },
    { pattern: /(?:next |this )?tuesday/i, getDate: () => getNextWeekday(2) },
    { pattern: /(?:next |this )?wednesday/i, getDate: () => getNextWeekday(3) },
    { pattern: /(?:next |this )?thursday/i, getDate: () => getNextWeekday(4) },
    { pattern: /(?:next |this )?friday/i, getDate: () => getNextWeekday(5) },
    { pattern: /(?:next |this )?saturday/i, getDate: () => getNextWeekday(6) },
    { pattern: /(?:next |this )?sunday/i, getDate: () => getNextWeekday(0) },
  ],
};

// Helper functions for date manipulation
function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Parse word numbers to integers (e.g., "one" -> 1, "five" -> 5)
 * Supports both English and Hindi numbers
 */
function parseWordNumber(word: string): number {
  const wordMap: Record<string, number> = {
    // English
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
    'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60,
    'a': 1, 'an': 1, // "in a minute" = 1 minute
    // Hindi numbers
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5,
    'छह': 6, 'छ:': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
    'ग्यारह': 11, 'बारह': 12, 'तेरह': 13, 'चौदह': 14, 'पंद्रह': 15,
    'सोलह': 16, 'सत्रह': 17, 'अठारह': 18, 'उन्नीस': 19, 'बीस': 20,
    'तीस': 30, 'चालीस': 40, 'पचास': 50, 'साठ': 60,
  };
  
  const lower = word.toLowerCase().trim();
  if (wordMap[lower] !== undefined) {
    return wordMap[lower];
  }
  
  // Check Hindi numbers (they won't be lowercased)
  if (wordMap[word.trim()] !== undefined) {
    return wordMap[word.trim()];
  }
  
  // Try parsing as number
  const num = parseInt(lower);
  return isNaN(num) ? 1 : num;
}

/**
 * Parse Hindi time of day (e.g., "तीन बजे" -> 3 o'clock)
 */
function parseHindiTimeOfDay(match: RegExpMatchArray): Date {
  const now = new Date();
  const hourWord = match[1];
  let hours = parseWordNumber(hourWord);
  
  // Check if there's context for AM/PM (दुपहर, सुबह, शाम, रात)
  const fullText = match.input || '';
  if (/दुपहर|afternoon/i.test(fullText)) {
    // Afternoon: 12-4 PM
    if (hours >= 1 && hours <= 4) hours += 12;
  } else if (/शाम|evening/i.test(fullText)) {
    // Evening: 5-8 PM
    if (hours >= 1 && hours <= 8) hours += 12;
  } else if (/रात|night/i.test(fullText)) {
    // Night: 8-11 PM
    if (hours >= 1 && hours <= 11) hours += 12;
  } else if (/सुबह|morning/i.test(fullText)) {
    // Morning: keep as-is (1-11 AM)
  } else {
    // Default: if hour is 1-6, assume afternoon/evening
    if (hours >= 1 && hours <= 6) hours += 12;
  }
  
  now.setHours(hours, 0, 0, 0);
  
  // If time has passed today, assume tomorrow
  if (now.getTime() < Date.now()) {
    return addDays(now, 1);
  }
  
  return now;
}

function setTimeToMorning(date: Date): Date {
  const result = new Date(date);
  result.setHours(9, 0, 0, 0);
  return result;
}

function setTimeToAfternoon(date: Date): Date {
  const result = new Date(date);
  result.setHours(14, 0, 0, 0);
  return result;
}

function setTimeToEvening(date: Date): Date {
  const result = new Date(date);
  result.setHours(18, 0, 0, 0);
  return result;
}

function setTimeToNight(date: Date): Date {
  const result = new Date(date);
  result.setHours(21, 0, 0, 0);
  return result;
}

function getNextWeekday(targetDay: number): Date {
  const now = new Date();
  const currentDay = now.getDay();
  let daysUntil = targetDay - currentDay;
  if (daysUntil <= 0) daysUntil += 7;
  return addDays(setTimeToMorning(now), daysUntil);
}

function parseTimeOfDay(match: RegExpMatchArray): Date {
  const now = new Date();
  let hours = parseInt(match[1]);
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  
  // If no meridiem and hour is small, assume PM for afternoon/evening
  if (!meridiem && hours >= 1 && hours <= 6) hours += 12;
  
  now.setHours(hours, minutes, 0, 0);
  
  // If time has passed today, assume tomorrow
  if (now.getTime() < Date.now()) {
    return addDays(now, 1);
  }
  
  return now;
}

/**
 * Parse a time string into a Date object
 */
function parseTimeString(timeStr: string): Date | undefined {
  if (!timeStr) return undefined;
  
  // Try each pattern category
  for (const patterns of Object.values(TIME_PATTERNS)) {
    for (const { pattern, getDate } of patterns) {
      const match = timeStr.match(pattern);
      if (match) {
        return getDate(match);
      }
    }
  }
  
  // Try parsing as a raw time
  const simpleTime = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
  if (simpleTime) {
    return parseTimeOfDay(simpleTime);
  }
  
  return undefined;
}

/**
 * Extract time from the full text when pattern matching doesn't capture it separately
 * This handles cases like "remind me in one minute to fill water"
 */
function extractTimeFromFullText(text: string): Date | undefined {
  // Try each TIME_PATTERN against the full text
  for (const patterns of Object.values(TIME_PATTERNS)) {
    for (const { pattern, getDate } of patterns) {
      const match = text.match(pattern);
      if (match) {
        return getDate(match);
      }
    }
  }
  
  return undefined;
}

/**
 * Determine if speech is directed at MIRA
 */
export function isDirectedAtMira(text: string): boolean {
  const lower = text.toLowerCase().trim();
  
  // Check direct address patterns
  for (const pattern of DIRECT_ADDRESS_PATTERNS) {
    if (pattern.test(lower)) return true;
  }
  
  // Check wake words at start
  for (const prefix of MIRA_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  
  // Check for MIRA name anywhere with context
  const words = lower.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[.,!?'"]/g, '');
    if (MIRA_WAKE_WORDS.has(word)) {
      // Check if it's followed by a request/question indicator
      const nextWords = words.slice(i + 1, i + 4).join(' ');
      if (/^(can|could|would|please|I need|what|when|where|how|remind|set|add)/i.test(nextWords)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if this looks like passive conversation (not directed at MIRA)
 */
function isPassiveConversation(text: string): boolean {
  for (const pattern of PASSIVE_CONVERSATION_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

/**
 * Extract priority from text
 */
function extractPriority(text: string): 'low' | 'medium' | 'high' | 'urgent' {
  const lower = text.toLowerCase();
  
  if (/\b(urgent|asap|immediately|right now|critical|emergency)\b/i.test(lower)) {
    return 'urgent';
  }
  if (/\b(important|high priority|must|crucial)\b/i.test(lower)) {
    return 'high';
  }
  if (/\b(low priority|when you can|no rush|whenever)\b/i.test(lower)) {
    return 'low';
  }
  
  return 'medium';
}

/**
 * Main task detection function
 */
export function detectTasks(text: string): TaskDetectionResult {
  const directed = isDirectedAtMira(text);
  const passive = isPassiveConversation(text);
  const tasks: DetectedTask[] = [];
  
  // Determine conversation type
  let conversationType: TaskDetectionResult['conversationType'] = 'passive';
  if (directed) {
    conversationType = 'direct';
  } else if (/\b(phone|call|calling|ringing)\b/i.test(text)) {
    conversationType = 'call';
  } else if (/\b(meeting|conference|appointment)\b/i.test(text)) {
    conversationType = 'meeting';
  } else if (/\b(I will|I'll|I promised|I have to|I need to)\b/i.test(text)) {
    conversationType = 'commitment';
  }
  
  // Try to extract tasks from various patterns
  
  // 1. Direct reminder requests (highest confidence when directed at MIRA)
  for (const pattern of TASK_PATTERNS.reminderRequest) {
    const match = text.match(pattern);
    if (match) {
      const taskTitle = match[1]?.trim();
      const timeStr = match[2]?.trim();
      
      if (taskTitle && taskTitle.length > 2) {
        // Parse time from either the captured time group OR from the full text
        let dueDate = parseTimeString(timeStr);
        if (!dueDate) {
          // Try to extract time from the full text (for patterns like "in one minute to X")
          dueDate = extractTimeFromFullText(text);
        }
        
        tasks.push({
          title: capitalizeFirst(taskTitle),
          dueDate,
          priority: extractPriority(text),
          confidence: directed ? 0.95 : 0.6,
          source: 'reminder_request',
          originalText: text,
          isDirectedAtMira: directed,
        });
      }
    }
  }
  
  // 2. Meeting/scheduling patterns
  for (const pattern of TASK_PATTERNS.meeting) {
    const match = text.match(pattern);
    if (match) {
      const meetingWith = match[1]?.trim();
      const timeStr = match[2]?.trim();
      
      if (meetingWith && meetingWith.length > 1) {
        tasks.push({
          title: `Meeting with ${capitalizeFirst(meetingWith)}`,
          dueDate: parseTimeString(timeStr),
          priority: 'medium',
          confidence: directed ? 0.9 : 0.7,
          source: 'meeting',
          originalText: text,
          isDirectedAtMira: directed,
        });
      }
    }
  }
  
  // 3. Personal commitments
  for (const pattern of TASK_PATTERNS.commitment) {
    const match = text.match(pattern);
    if (match) {
      const commitment = match[1]?.trim();
      const timeStr = match[2]?.trim();
      
      // Filter out very short or common phrases
      if (commitment && commitment.length > 5 && !/^(do it|be there|go|come)$/i.test(commitment)) {
        tasks.push({
          title: capitalizeFirst(commitment),
          dueDate: parseTimeString(timeStr),
          priority: extractPriority(text),
          confidence: directed ? 0.85 : 0.5,
          source: 'commitment',
          originalText: text,
          isDirectedAtMira: directed,
        });
      }
    }
  }
  
  // 4. Deadline mentions
  for (const pattern of TASK_PATTERNS.deadline) {
    const match = text.match(pattern);
    if (match) {
      const task = match[1]?.trim();
      const timeStr = match[2]?.trim();
      
      if (task && task.length > 3) {
        tasks.push({
          title: capitalizeFirst(task),
          dueDate: parseTimeString(timeStr),
          priority: 'high', // Deadlines are usually important
          confidence: 0.8,
          source: 'deadline',
          originalText: text,
          isDirectedAtMira: directed,
        });
      }
    }
  }
  
  // 5. SPECIAL: Extract multiple meetings/interviews with times
  // e.g., "I have three meetings at 3, 3:30, and 4 PM"
  if (/(?:meeting|interview|appointment|call)s?/i.test(text) && tasks.length === 0) {
    const multipleMeetingTasks = extractMultipleMeetingsFromText(text, directed);
    tasks.push(...multipleMeetingTasks);
  }
  
  // 6. HINDI TASK EXTRACTION - Special handling for Hindi speech
  // e.g., "मीरा कल दुपहर में तीन बजे मुझे एक इंटरव्यू लेना है"
  if (tasks.length === 0 && /[\u0900-\u097F]/.test(text)) {
    const hindiTask = extractHindiTask(text, directed);
    if (hindiTask) {
      tasks.push(hindiTask);
    }
  }
  
  // Deduplicate tasks by similar titles
  const uniqueTasks = deduplicateTasks(tasks);
  
  // Determine if MIRA should respond
  // Respond if: directed at MIRA, or high-confidence task detected, or explicit request
  const shouldRespond = directed || 
    uniqueTasks.some(t => t.confidence > 0.85 && t.isDirectedAtMira) ||
    /\b(remind|schedule|set|add|create)\b/i.test(text);
  
  return {
    isDirectedAtMira: directed,
    shouldRespond,
    tasks: uniqueTasks,
    isPhoneCall: /\b(phone|calling|ringing|call)\b/i.test(text),
    isPassiveConversation: passive && !directed,
    conversationType,
  };
}

/**
 * Extract task from Hindi speech
 * e.g., "मीरा कल दुपहर में तीन बजे मुझे एक इंटरव्यू लेना है"
 */
function extractHindiTask(text: string, directed: boolean): DetectedTask | null {
  // Hindi task keywords
  const taskKeywords = {
    'इंटरव्यू': 'Interview',
    'मीटिंग': 'Meeting',
    'कॉल': 'Call',
    'काम': 'Work',
    'बैठक': 'Meeting',
    'appointment': 'Appointment',
    'interview': 'Interview',
    'meeting': 'Meeting',
    'call': 'Call',
  };
  
  let taskTitle = '';
  
  // Find task type
  for (const [hindi, english] of Object.entries(taskKeywords)) {
    if (text.includes(hindi)) {
      taskTitle = english;
      break;
    }
  }
  
  if (!taskTitle) return null;
  
  // Extract additional context
  // "इंटरव्यू लेना" (take interview) - could be giving an interview or conducting one
  if (/इंटरव्यू\s*(?:लेना|देना|है)/i.test(text)) {
    taskTitle = 'Interview';
  }
  
  // Try to extract time
  let dueDate: Date | undefined;
  
  // Check for "कल" (tomorrow), "आज" (today), "परसों" (day after tomorrow)
  const dayMatch = text.match(/(?:कल|आज|परसों)/);
  if (dayMatch) {
    if (dayMatch[0] === 'कल') {
      dueDate = addDays(new Date(), 1);
    } else if (dayMatch[0] === 'आज') {
      dueDate = new Date();
    } else if (dayMatch[0] === 'परसों') {
      dueDate = addDays(new Date(), 2);
    }
  }
  
  // Check for time "X बजे" (X o'clock)
  const timeMatch = text.match(/(\d+|एक|दो|तीन|चार|पांच|छह|सात|आठ|नौ|दस|ग्यारह|बारह)\s*बजे/);
  if (timeMatch) {
    const hour = parseWordNumber(timeMatch[1]);
    
    // Determine AM/PM based on context
    let adjustedHour = hour;
    if (/दुपहर|afternoon/i.test(text) && hour >= 1 && hour <= 4) {
      adjustedHour = hour + 12;
    } else if (/शाम|evening/i.test(text) && hour >= 1 && hour <= 8) {
      adjustedHour = hour + 12;
    } else if (/रात|night/i.test(text) && hour >= 1 && hour <= 11) {
      adjustedHour = hour + 12;
    } else if (!/सुबह|morning/i.test(text) && hour >= 1 && hour <= 6) {
      // Default: assume afternoon/evening for small hours
      adjustedHour = hour + 12;
    }
    
    if (dueDate) {
      dueDate.setHours(adjustedHour, 0, 0, 0);
    } else {
      dueDate = new Date();
      dueDate.setHours(adjustedHour, 0, 0, 0);
      // If time has passed today, assume tomorrow
      if (dueDate.getTime() < Date.now()) {
        dueDate = addDays(dueDate, 1);
      }
    }
  }
  
  // Also check for time of day words without specific hour
  if (!timeMatch) {
    if (/दुपहर/i.test(text) && dueDate) {
      dueDate.setHours(14, 0, 0, 0);
    } else if (/सुबह/i.test(text) && dueDate) {
      dueDate.setHours(9, 0, 0, 0);
    } else if (/शाम/i.test(text) && dueDate) {
      dueDate.setHours(18, 0, 0, 0);
    } else if (/रात/i.test(text) && dueDate) {
      dueDate.setHours(21, 0, 0, 0);
    }
  }
  
  console.log('[TaskDetection] Extracted Hindi task:', { taskTitle, dueDate, text });
  
  return {
    title: taskTitle,
    dueDate,
    priority: 'medium',
    confidence: directed ? 0.9 : 0.7,
    source: 'reminder_request',
    originalText: text,
    isDirectedAtMira: directed,
  };
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Deduplicate tasks by similar titles
 */
function deduplicateTasks(tasks: DetectedTask[]): DetectedTask[] {
  const seen = new Map<string, DetectedTask>();
  
  for (const task of tasks) {
    const key = task.title.toLowerCase().replace(/\s+/g, ' ').trim();
    const existing = seen.get(key);
    
    // Keep the one with higher confidence
    if (!existing || task.confidence > existing.confidence) {
      seen.set(key, task);
    }
  }
  
  return Array.from(seen.values());
}

/**
 * Check if task should be auto-created (more aggressive for direct requests)
 */
export function shouldAutoCreateReminder(task: DetectedTask): boolean {
  // ALWAYS auto-create if directed at MIRA with clear task intent
  if (task.isDirectedAtMira) {
    // Very low threshold for direct requests - user clearly wants this saved
    if (task.confidence >= 0.5) return true;
    // Any reminder request source should be saved
    if (task.source === 'reminder_request') return true;
    if (task.source === 'meeting') return true;
    if (task.source === 'deadline') return true;
  }
  
  // For passive/overheard - still use higher thresholds
  if (task.confidence >= 0.85) return true;
  if (task.source === 'reminder_request' && task.confidence >= 0.7) return true;
  if (task.source === 'meeting' && task.confidence >= 0.75) return true;
  
  return false;
}

/**
 * Parse MIRA's response to extract tasks she mentioned creating
 * This is a fallback to ensure reminders are actually created when MIRA says she added them
 */
export function extractTasksFromMiraResponse(miraResponse: string): DetectedTask[] {
  const tasks: DetectedTask[] = [];
  const lower = miraResponse.toLowerCase();
  
  // Check if MIRA is confirming task/reminder creation
  const confirmationPatterns = [
    /(?:i'?ve |i have |i'?ll |i will )?(?:added|created|set|saved|scheduled|noted|recorded)\s+(?:a |an |the |three |two |four |five |\d+ )?(?:reminder|task|todo|to-do|event|meeting|appointment)/i,
    /(?:reminder|task|todo|meeting)s? (?:added|created|set|saved|scheduled)/i,
    /(?:adding|creating|setting|saving|scheduling) (?:a |an |the )?(?:reminder|task|todo)/i,
  ];
  
  const isConfirming = confirmationPatterns.some(p => p.test(lower));
  if (!isConfirming) return tasks;
  
  // === EXTRACT NUMBERED LISTS (e.g., "1. Meeting at 3:00 PM") ===
  const numberedListPattern = /(?:^|\n)\s*(?:\d+[.):]|[-•])\s*(.+?)(?=\n|$)/gm;
  let match;
  while ((match = numberedListPattern.exec(miraResponse)) !== null) {
    const taskTitle = match[1]?.trim();
    if (taskTitle && taskTitle.length > 3 && taskTitle.length < 200) {
      // Clean up the title
      const cleanTitle = taskTitle
        .replace(/^\s*[-•]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (cleanTitle && !tasks.some(t => t.title.toLowerCase() === cleanTitle.toLowerCase())) {
        // Try to extract time from the task
        const timeMatch = cleanTitle.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i);
        let dueDate: Date | undefined;
        if (timeMatch) {
          dueDate = parseTimeFromString(timeMatch[1]);
        }
        
        tasks.push({
          title: capitalizeFirst(cleanTitle),
          dueDate,
          priority: 'medium',
          confidence: 0.9,
          source: 'reminder_request',
          originalText: miraResponse,
          isDirectedAtMira: true,
        });
      }
    }
  }
  
  // === EXTRACT MEETING TIMES (e.g., "meetings at 3:00, 3:30, and 4:00") ===
  const timeListPattern = /(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)/gi;
  const times: string[] = [];
  while ((match = timeListPattern.exec(miraResponse)) !== null) {
    times.push(match[1]);
  }
  
  // If we found times but no numbered list tasks, create tasks for each time
  if (times.length > 0 && tasks.length === 0) {
    // Check if it's about meetings/interviews
    const isMeetingContext = /meeting|interview|appointment|call/i.test(miraResponse);
    const contextWord = /interview/i.test(miraResponse) ? 'Interview' : 'Meeting';
    
    for (const time of times) {
      const normalizedTime = time.toUpperCase().replace(/\s+/g, ' ');
      const title = `${contextWord} at ${normalizedTime}`;
      
      if (!tasks.some(t => t.title.toLowerCase() === title.toLowerCase())) {
        tasks.push({
          title,
          dueDate: parseTimeFromString(time),
          priority: 'medium',
          confidence: 0.85,
          source: isMeetingContext ? 'meeting' : 'reminder_request',
          originalText: miraResponse,
          isDirectedAtMira: true,
        });
      }
    }
  }
  
  // === FALLBACK: Extract quoted or colon-separated tasks ===
  if (tasks.length === 0) {
    const extractPatterns = [
      /(?:added|created|set|saved)(?:[^:]+)?:\s*["']?([^"'\n.]+)["']?/gi,
      /(?:reminder|task|todo) (?:for|to|about)\s+["']?([^"'\n.]+)["']?/gi,
      /["']([^"']+)["']\s+(?:has been |was )?(?:added|created|saved)/gi,
    ];
    
    for (const pattern of extractPatterns) {
      while ((match = pattern.exec(miraResponse)) !== null) {
        const taskTitle = match[1]?.trim();
        if (taskTitle && taskTitle.length > 3 && taskTitle.length < 200) {
          if (!tasks.some(t => t.title.toLowerCase() === taskTitle.toLowerCase())) {
            tasks.push({
              title: capitalizeFirst(taskTitle),
              priority: 'medium',
              confidence: 0.8,
              source: 'reminder_request',
              originalText: miraResponse,
              isDirectedAtMira: true,
            });
          }
        }
      }
    }
  }
  
  return tasks;
}

/**
 * Parse time from a string like "3:00 PM" or "3pm"
 */
function parseTimeFromString(timeStr: string): Date | undefined {
  if (!timeStr) return undefined;
  
  const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return undefined;
  
  let hours = parseInt(match[1]);
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  // If no meridiem and hour is 1-6, assume PM
  if (!meridiem && hours >= 1 && hours <= 6) hours += 12;
  
  const now = new Date();
  const result = new Date(now);
  result.setHours(hours, minutes, 0, 0);
  
  // If time has passed today, set for tomorrow
  if (result.getTime() < now.getTime()) {
    result.setDate(result.getDate() + 1);
  }
  
  return result;
}

/**
 * Extract multiple meetings/interviews with times from text
 * e.g., "I have three meetings at 3, 3:30, and 4 PM" or "meetings scheduled tomorrow"
 */
function extractMultipleMeetingsFromText(text: string, isDirected: boolean): DetectedTask[] {
  const tasks: DetectedTask[] = [];
  
  // Determine context word (meeting vs interview)
  const contextWord = /interview/i.test(text) ? 'Interview' : 'Meeting';
  
  // Extract all time mentions from the text
  // Matches: 3:00 PM, 3pm, 3:30, 4 PM, etc.
  const timePattern = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?/g;
  const times: { raw: string; hours: number; minutes: number; meridiem?: string }[] = [];
  let match;
  
  // Also find the last meridiem (AM/PM) to apply to times without one
  const lastMeridiem = text.match(/(am|pm)/gi)?.pop()?.toLowerCase();
  
  while ((match = timePattern.exec(text)) !== null) {
    const hours = parseInt(match[1]);
    const minutes = match[2] ? parseInt(match[2]) : 0;
    const meridiem = match[3]?.toLowerCase() || lastMeridiem;
    
    // Skip if it looks like a quantity rather than time (e.g., "three meetings")
    // Times typically have : or am/pm, or are between 1-12
    if (hours >= 1 && hours <= 12) {
      times.push({
        raw: match[0],
        hours,
        minutes,
        meridiem,
      });
    }
  }
  
  // If we found times, create tasks for each
  if (times.length > 0) {
    for (const time of times) {
      let hours = time.hours;
      const minutes = time.minutes;
      
      // Apply meridiem
      if (time.meridiem === 'pm' && hours < 12) hours += 12;
      if (time.meridiem === 'am' && hours === 12) hours = 0;
      // Default: if no meridiem and hour is 1-6, assume PM (afternoon)
      if (!time.meridiem && hours >= 1 && hours <= 6) hours += 12;
      
      const now = new Date();
      const dueDate = new Date(now);
      dueDate.setHours(hours, minutes, 0, 0);
      
      // If time has passed today, set for tomorrow
      if (dueDate.getTime() < now.getTime()) {
        dueDate.setDate(dueDate.getDate() + 1);
      }
      
      // Format time for title
      const formattedTime = dueDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      
      const title = `${contextWord} at ${formattedTime}`;
      
      // Avoid duplicates
      if (!tasks.some(t => t.title === title)) {
        tasks.push({
          title,
          dueDate,
          priority: 'medium',
          confidence: isDirected ? 0.9 : 0.7,
          source: 'meeting',
          originalText: text,
          isDirectedAtMira: isDirected,
        });
      }
    }
  }
  
  return tasks;
}
