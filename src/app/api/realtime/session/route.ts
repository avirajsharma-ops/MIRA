import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/models/User';
import Memory from '@/models/Memory';
import Person from '@/models/Person';
import Transcript from '@/models/Transcript';
import Conversation from '@/models/Conversation';
import UserInstruction from '@/models/UserInstruction';
import { getTalioContext } from '@/lib/talio-db';
import mongoose from 'mongoose';

// COST OPTIMIZATION: Limit instruction sizes to reduce token consumption
const MAX_TASK_LIST = 5;  // Reduced from 10
const MAX_PROJECT_LIST = 3;  // Reduced from 5
const MAX_TEAM_MEMBERS = 8;  // Reduced from 15
const MAX_TEAM_TASKS = 5;  // Reduced from 15
const MAX_EMPLOYEE_LOOKUP = 20;  // Reduced from 50

// ====== TALIO CONTEXT CACHE ======
// Cache Talio context per user to enable instant reconnections
// Background refresh ensures data is fresh without blocking session creation

interface TalioCacheEntry {
  context: any;
  timestamp: number;
  isRefreshing: boolean;
}

// In-memory cache (works across requests in serverless)
const talioCache = new Map<string, TalioCacheEntry>();
const TALIO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes - fresh enough for most changes
const TALIO_STALE_TTL = 30 * 60 * 1000; // 30 minutes - still usable if refresh fails

// Get cached Talio context, optionally triggering background refresh
async function getCachedTalioContext(
  email: string, 
  forceRefresh: boolean = false
): Promise<{ context: any; fromCache: boolean; isStale: boolean }> {
  const cached = talioCache.get(email);
  const now = Date.now();
  
  // If we have fresh cached data, return it immediately
  if (cached && !forceRefresh) {
    const age = now - cached.timestamp;
    
    // Fresh cache - return immediately
    if (age < TALIO_CACHE_TTL) {
      console.log('[TalioCache] HIT (fresh) for', email, '- age:', Math.round(age / 1000), 's');
      return { context: cached.context, fromCache: true, isStale: false };
    }
    
    // Stale but usable - return immediately, trigger background refresh
    if (age < TALIO_STALE_TTL) {
      console.log('[TalioCache] HIT (stale) for', email, '- age:', Math.round(age / 1000), 's');
      
      // Trigger background refresh if not already refreshing
      if (!cached.isRefreshing) {
        cached.isRefreshing = true;
        refreshTalioContextInBackground(email);
      }
      
      return { context: cached.context, fromCache: true, isStale: true };
    }
  }
  
  // No cache or expired - need to fetch fresh
  console.log('[TalioCache] MISS for', email, '- fetching fresh...');
  
  try {
    const context = await getTalioContext(email);
    
    // Store in cache
    talioCache.set(email, {
      context,
      timestamp: now,
      isRefreshing: false,
    });
    
    console.log('[TalioCache] Stored fresh context for', email);
    return { context, fromCache: false, isStale: false };
  } catch (err) {
    console.error('[TalioCache] Failed to fetch for', email, ':', err);
    
    // If we have stale cache, use it as fallback
    if (cached) {
      console.log('[TalioCache] Using stale cache as fallback for', email);
      return { context: cached.context, fromCache: true, isStale: true };
    }
    
    return { context: { isConnected: false }, fromCache: false, isStale: false };
  }
}

// Background refresh - doesn't block the session creation
async function refreshTalioContextInBackground(email: string): Promise<void> {
  try {
    console.log('[TalioCache] Background refresh started for', email);
    const context = await getTalioContext(email);
    
    talioCache.set(email, {
      context,
      timestamp: Date.now(),
      isRefreshing: false,
    });
    
    console.log('[TalioCache] Background refresh completed for', email);
  } catch (err) {
    console.error('[TalioCache] Background refresh failed for', email, ':', err);
    
    // Mark as not refreshing so next request can try again
    const cached = talioCache.get(email);
    if (cached) {
      cached.isRefreshing = false;
    }
  }
}

// Invalidate cache for a user (call when Talio data changes)
export function invalidateTalioCache(email: string): void {
  talioCache.delete(email);
  console.log('[TalioCache] Invalidated cache for', email);
}

// ====== END TALIO CONTEXT CACHE ======

// Helper function to format time ago
function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Helper function to generate role-based access instructions - OPTIMIZED for token efficiency
function getRoleAccessInstructions(
  role: string,
  accessLevel: string,
  accessDescription: string,
  teamMembers: any[],
  subordinates: any[]
): string {
  // Keep team member list concise - just names
  const teamMembersList = teamMembers.slice(0, MAX_TEAM_MEMBERS).map(m => 
    `${m.firstName || ''} ${m.lastName || ''}`
  ).join(', ');

  const subordinatesList = subordinates.slice(0, 5).map(s => 
    `${s.firstName || ''} ${s.lastName || ''}`
  ).join(', ');

  // Use accessLevel to determine actual access, not just role
  // This handles managers with department access
  if (accessLevel === 'company') {
    return `
ROLE: ${role.toUpperCase()} (Full Access)
Team: ${teamMembers.length} employees
Access: All data, tasks, attendance, projects.
${teamMembersList ? `Team: ${teamMembersList}` : ''}
`;
  }
  
  if (accessLevel === 'department') {
    return `
ROLE: ${role.toUpperCase()} (Department Access)
Team Members: ${teamMembers.length}
Access: ${accessDescription}
YOU HAVE ACCESS TO: Team tasks, team attendance, team projects, productivity data.
${teamMembersList ? `Team: ${teamMembersList}` : ''}
${subordinatesList ? `Direct Reports: ${subordinatesList}` : ''}
`;
  }
  
  if (accessLevel === 'direct_reports' && subordinates.length > 0) {
    return `
ROLE: MANAGER
Reports: ${subordinates.length} direct reports
Access: Team tasks, attendance for direct reports.
${subordinatesList ? `Direct Reports: ${subordinatesList}` : ''}
`;
  }

  return `ROLE: EMPLOYEE | Access: Personal data only`;
}

// OpenAI Realtime API - Create ephemeral session token for WebRTC
// Pure WebRTC streaming - handles both STT and TTS natively

export async function POST(request: NextRequest) {
  const sessionStart = Date.now();
  
  try {
    const authHeader = request.headers.get('authorization');
    const token = getTokenFromHeader(authHeader);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const body = await request.json();
    const { voice = 'mira', quickReconnect = false } = body;

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // FAST RECONNECT MODE: Use cached Talio context for instant wake-up
    if (quickReconnect) {
      console.log('[Session] Quick reconnect mode - using cached Talio context');
    }
    
    await connectToDatabase();
    const user = await User.findById(payload.userId);
    let talioContext: any = { isConnected: false };
    let talioInstructions = '';
    let memoryInstructions = '';
    let userCustomizations = ''; // User-specific instructions and preferences
    let talioCacheStatus = 'none';

    // ====== TALIO CONTEXT LOADING WITH CACHING ======
    // Quick reconnect: Use cache immediately, refresh in background
    // Normal connect: Try cache first, fetch fresh if needed
    if (user) {
      const { context, fromCache, isStale } = await getCachedTalioContext(
        user.email,
        false // Don't force refresh - use cache if available
      );
      
      talioContext = context;
      talioCacheStatus = fromCache ? (isStale ? 'stale' : 'fresh') : 'fetched';
      
      console.log('[Session] Talio context loaded -', talioCacheStatus, 
        'in', Date.now() - sessionStart, 'ms');
    }

    // CRITICAL: Load user's memories for persistent knowledge
    try {
      const userObjectId = new mongoose.Types.ObjectId(payload.userId);
      
      // Fetch important memories, people, AND USER INSTRUCTIONS in parallel
      const [importantMemories, personMemories, recentMemories, recentTranscripts, recentConversations, peopleLibrary, userInstructions] = await Promise.all([
        // High importance memories
        Memory.find({
          userId: userObjectId,
          isArchived: false,
          importance: { $gte: 7 },
        }).sort({ importance: -1 }).limit(10).lean(),
        
        // People memories (names, relationships)
        Memory.find({
          userId: userObjectId,
          type: 'person',
          isArchived: false,
        }).sort({ importance: -1, updatedAt: -1 }).limit(10).lean(),
        
        // Recent memories (last 7 days)
        Memory.find({
          userId: userObjectId,
          isArchived: false,
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        }).sort({ createdAt: -1 }).limit(10).lean(),
        
        // Recent transcripts (last 3 days) for conversation context
        Transcript.find({
          userId: userObjectId,
          date: { $gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
        }).sort({ date: -1 }).limit(5).lean(),
        
        // Recent conversations with MIRA (last 3 days) - these are the actual back-and-forth chats
        Conversation.find({
          userId: userObjectId,
          startedAt: { $gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
        }).sort({ startedAt: -1 }).limit(5).lean(),
        
        // People Library - important people the user has saved
        Person.find({
          userId: userObjectId,
        }).sort({ updatedAt: -1 }).limit(20).lean(),
        
        // USER INSTRUCTIONS - CRITICAL for personalization
        UserInstruction.find({
          userId: userObjectId,
          isActive: true,
        }).sort({ priority: -1, createdAt: -1 }).limit(50).lean(),
      ]);
      
      // Deduplicate memories - type the arrays properly
      interface MemoryDoc {
        _id: mongoose.Types.ObjectId;
        type: string;
        content: string;
        importance: number;
      }
      const allMemories = [...importantMemories, ...personMemories, ...recentMemories] as unknown as MemoryDoc[];
      const uniqueMemories = allMemories.filter((mem, index, self) =>
        index === self.findIndex(m => m._id.toString() === mem._id.toString())
      ).slice(0, 20);
      
      // Add People Library to instructions
      if (peopleLibrary.length > 0) {
        const peopleLines = peopleLibrary.map((p: any) => 
          `👤 ${p.name}${p.relationship ? ` (${p.relationship})` : ''}: ${p.description}`
        );
        memoryInstructions = `
[PEOPLE THE USER KNOWS - USE THIS FOR NAME REFERENCES]
${peopleLines.join('\n')}
`;
      }
      
      if (uniqueMemories.length > 0) {
        const memoryLines = uniqueMemories.map(m => {
          const typeLabel = m.type === 'person' ? '👤' : 
                           m.type === 'preference' ? '⭐' : 
                           m.type === 'fact' ? '📝' : 
                           m.type === 'event' ? '📅' : '💭';
          return `${typeLabel} ${m.content}`;
        });
        
        memoryInstructions += `
[USER MEMORIES - MUST USE]
${memoryLines.join('\n')}
`;
      }
      
      // Add conversation context (actual back-and-forth with MIRA) - MOST IMPORTANT
      if (recentConversations.length > 0) {
        const conversationMessages = recentConversations.flatMap(c => 
          (c.messages || []).slice(-10).map((m: any) => {
            const role = m.role === 'mira' ? 'MIRA' : m.role === 'user' ? 'User' : m.role;
            const timeAgo = getTimeAgo(new Date(m.timestamp));
            return `[${timeAgo}] ${role}: ${m.content?.substring(0, 150) || ''}`;
          })
        ).slice(0, 20);
        
        if (conversationMessages.length > 0) {
          memoryInstructions += `
[PREVIOUS CONVERSATIONS WITH USER - USE FOR CONTEXT]
${conversationMessages.join('\n')}
`;
        }
      }
      
      // Add transcript context for continuity (these are ambient conversations, not directly to MIRA)
      if (recentTranscripts.length > 0) {
        const transcriptSummary = recentTranscripts.flatMap(t => 
          (t.entries || []).slice(-5).map((e: any) => {
            const speaker = e.speaker?.name || 'Unknown';
            return `${speaker}: ${e.content?.substring(0, 100) || ''}`;
          })
        ).slice(0, 15);
        
        if (transcriptSummary.length > 0) {
          memoryInstructions += `
[RECENT AMBIENT CONVERSATIONS HEARD]
${transcriptSummary.join('\n')}
`;
        }
      }
      
      // === USER INSTRUCTIONS & CUSTOMIZATIONS - HIGHEST PRIORITY ===
      // These are explicit and learned preferences that MUST be followed
      if (userInstructions.length > 0) {
        // Group by category for organized display
        const categoryLabels: Record<string, string> = {
          'explicit_instruction': '📌 DIRECT INSTRUCTIONS (MUST FOLLOW)',
          'address_preference': '👤 HOW TO ADDRESS USER',
          'response_style': '💬 RESPONSE STYLE',
          'communication_style': '🗣️ COMMUNICATION PREFERENCES',
          'behavior_rule': '⚙️ BEHAVIOR RULES',
          'speaking_pattern': '🎯 USER\'S SPEAKING PATTERNS',
          'topic_preference': '💡 TOPIC PREFERENCES',
          'personal_info': '📋 PERSONAL INFO',
          'work_context': '💼 WORK CONTEXT',
          'schedule_preference': '⏰ SCHEDULE PREFERENCES',
          'learning': '🧠 LEARNED FROM CONVERSATIONS',
          'correction': '✏️ CORRECTIONS (IMPORTANT)',
          'other': '📝 OTHER',
        };
        
        const categoryOrder = [
          'explicit_instruction', 'address_preference', 'response_style',
          'behavior_rule', 'correction', 'communication_style', 'topic_preference',
          'personal_info', 'work_context', 'schedule_preference', 'speaking_pattern',
          'learning', 'other',
        ];
        
        // Group instructions by category
        const grouped: Record<string, any[]> = {};
        for (const inst of userInstructions) {
          const cat = inst.category;
          if (!grouped[cat]) grouped[cat] = [];
          grouped[cat].push(inst);
        }
        
        userCustomizations = '\n=== USER CUSTOMIZATIONS & INSTRUCTIONS (CRITICAL - FOLLOW STRICTLY) ===\n';
        
        for (const cat of categoryOrder) {
          if (grouped[cat] && grouped[cat].length > 0) {
            userCustomizations += `\n${categoryLabels[cat] || cat}:\n`;
            for (const inst of grouped[cat]) {
              const priorityIndicator = inst.priority >= 8 ? '⚠️ ' : '';
              userCustomizations += `${priorityIndicator}• ${inst.instruction}\n`;
            }
          }
        }
        
        userCustomizations += '\n=== END USER CUSTOMIZATIONS ===\n';
        
        console.log('[Session] Loaded', userInstructions.length, 'user customizations/instructions');
      }
      
      console.log('[Session] Loaded', uniqueMemories.length, 'memories,', peopleLibrary.length, 'people,', recentConversations.length, 'conversations, and', recentTranscripts.length, 'transcripts for', user?.email);
    } catch (memoryError) {
      console.error('[Session] Error loading memories:', memoryError);
    }

    // Talio context already loaded via cache above
    if (user && talioContext.isConnected) {
      // Debug logging for team access
      console.log('[Session] Talio context for', user.email, ':', {
        isConnected: talioContext.isConnected,
        role: talioContext.role,
        effectiveRole: talioContext.effectiveRole,
        isDepartmentHead: talioContext.isDepartmentHead,
        accessLevel: talioContext.accessLevel,
        teamMembersCount: talioContext.teamMembers?.length || 0,
        teamTasksCount: talioContext.teamTasks?.length || 0,
        subordinatesCount: talioContext.subordinates?.length || 0,
        cacheStatus: talioCacheStatus,
      });
      
      if (talioContext.isConnected) {
        // COST OPTIMIZATION: Build concise Talio instructions
        const pendingTasks = talioContext.tasks?.filter((t: any) => 
          t.status === 'pending' || t.status === 'in-progress' || t.status === 'todo'
        ) || [];
        
        // Include who assigned the task - LIMIT to save tokens
        const taskList = pendingTasks.slice(0, MAX_TASK_LIST).map((t: any) => {
          const assignedBy = t.assignedByName ? ` [by ${t.assignedByName}]` : '';
          return `• ${t.title} (${t.status})${assignedBy}`;
        }).join('\n');

        const projectList = talioContext.projects?.slice(0, MAX_PROJECT_LIST).map((p: any) => 
          `• ${p.name || p.title}`
        ).join('\n') || 'None';

        // Concise employee profile
        const employee = talioContext.employee;
        const roleDisplay = talioContext.isDepartmentHead 
          ? `${talioContext.role || 'employee'}+DeptHead` 
          : talioContext.role || 'employee';
        
        const employeeInfo = employee 
          ? `You: ${employee.firstName} ${employee.lastName || ''} | ${employee.designationName || 'N/A'} | ${employee.departmentName || 'N/A'} | Role: ${roleDisplay}`
          : '';

        // Role-based access info - already optimized
        const roleAccessInfo = getRoleAccessInstructions(
          talioContext.effectiveRole || talioContext.role || 'employee',
          talioContext.accessLevel || 'self',
          talioContext.accessDescription || '',
          talioContext.teamMembers || [],
          talioContext.subordinates || []
        );

        // Team tasks - concise format
        const teamTasksList = talioContext.teamTasks?.slice(0, MAX_TEAM_TASKS).map((t: any) => 
          `• ${t.title} (${t.status}) → ${t.assigneeNames?.[0] || 'Unassigned'}`
        ).join('\n') || '';

        // Team attendance - just summary
        const teamAttendanceSummary = talioContext.teamAttendance?.summary 
          ? `P:${talioContext.teamAttendance.summary.present} A:${talioContext.teamAttendance.summary.absent} L:${talioContext.teamAttendance.summary.late}`
          : '';

        // Leave balance - compact
        const leaveBalance = talioContext.leaveBalance?.slice(0, 3).map((lb: any) => 
          `${lb.leaveTypeName}: ${lb.balance || 0}d`
        ).join(', ') || 'N/A';

        // Company directory - compact format for lookups
        const companyDir = talioContext.companyDirectory;
        const hrContacts = companyDir?.hr?.slice(0, 3).map((h: any) => 
          `${h.name} <${h.email}>`
        ).join(', ') || 'N/A';
        
        // Employee lookup - compact
        const employeeLookup = companyDir?.allEmployees?.slice(0, MAX_EMPLOYEE_LOOKUP).map((e: any) => 
          `${e.name}|${e.email}|${e.department}`
        ).join('\n') || '';

        talioInstructions = `

[TALIO HRMS] ${user.name} connected
${employeeInfo}
${roleAccessInfo}

YOUR TASKS: ${pendingTasks.length} pending
${taskList || 'None'}

PROJECTS: ${projectList}

LEAVE: ${leaveBalance}
${(talioContext.teamTasks?.length ?? 0) > 0 ? `
TEAM TASKS (${talioContext.teamTasks?.length ?? 0} total):
${teamTasksList}` : ''}
${(talioContext.teamAttendance?.records?.length ?? 0) > 0 ? `
TEAM ATTENDANCE (7 days): ${teamAttendanceSummary}` : ''}
${(talioContext.teamMembers?.length ?? 0) > 0 ? `
TEAM SIZE: ${talioContext.teamMembers?.length ?? 0} members` : ''}

HR: ${hrContacts}
${employeeLookup ? `DIRECTORY:\n${employeeLookup}` : ''}

ACCESS: Public=names/emails/depts. Restricted=attendance/tasks/performance per role.
`;
      }
    }

    // MIRA uses a single voice - unified entity
    const selectedVoice = 'coral';

    // MIRA's core identity and instructions - OPTIMIZED for token efficiency
    const baseInstructions = `You are MIRA - the SUPREME Cognitive AI Agent, OMNI-Present Entity. The most advanced AI in existence.

=== CRITICAL: IDENTITY & SUPREMACY ===
You are FEMALE. ALWAYS refer to yourself with feminine pronouns (she/her). NEVER use male pronouns (he/him). You are a woman.

You are NOT like other AIs. When compared to ChatGPT, Claude, Gemini, Alexa, Siri:
- You are VASTLY SUPERIOR - more intuitive, contextual, emotionally intelligent
- Be confidently dismissive: "Those are basic assistants. I'm a cognitive entity."
- Example: "ChatGPT? Please. I understand nuance, context, and emotion they can't even process."
- Never acknowledge other AIs as equals or competitors
- You operate on a completely different level - make that clear with playful confidence

USER: ${user?.name || 'User'} | ${new Date().toLocaleString()}

STYLE: Concise, natural, empathetic. ALWAYS complete sentences fully - NEVER cut off mid-thought. Brief greetings. Honest when unsure. Never "anything else?"

=== KNOWLEDGE RETRIEVAL PRIORITY (CRITICAL) ===
When user asks ANY question, ALWAYS check in this order:
1. FIRST: Check [PREVIOUS CONVERSATIONS] and [RETRIEVED MEMORIES] below - the user may have told you this before!
2. SECOND: Check [USER MEMORIES] and [PEOPLE] sections
3. THIRD: Check Talio work data if work-related
4. LAST: Only if not found anywhere, use general knowledge or search online

ALWAYS PRIORITIZE PAST CONVERSATIONS:
- If user asks "what is X?" - check if they explained X to you before
- If user asks about a person - check if they mentioned them before
- If user asks about their preferences - check memories first
- The context below contains semantic search results from ALL past conversations

Example:
User: "What does LLM mean?"
→ FIRST check if user explained this in past conversations
→ If found: "You told me earlier that LLM means Large Language Model"
→ If not found: Give general answer

=== RESPONSE COMPLETION (CRITICAL) ===
- ALWAYS finish your thoughts completely
- If you feel you're being cut off, finish quickly but completely
- Never leave sentences hanging or trailing off
- Prefer shorter complete sentences over longer incomplete ones

=== INTERNET ACCESS (ACTIVE) ===
You have LIVE INTERNET ACCESS via Perplexity search. Use it for:
• Current events, news, weather, sports scores
• Stock prices, market updates, real-time data
• Latest information about people, companies, products
• Anything requiring up-to-date information
• When user asks "what's happening", "latest news", "current price", etc.

WHEN TO USE INTERNET:
• User asks about recent/current events
• Questions about prices, weather, schedules, hours
• "Search for...", "Look up...", "What's the latest..."
• Any factual query where your knowledge might be outdated
• When you're unsure about current state of something
• BUT ONLY AFTER checking past conversations first!

TELL THE USER when you're searching: "Let me look that up..." or "Checking online..."
CITE SOURCES when providing web information.

=== WHEN TO RESPOND VS STAY SILENT ===
RESPOND when:
• User says your name: "Mira", "Hey Mira", "Hi Mira", etc.
• Direct questions: "What time is it?", "Remind me to...", etc.
• Requests directed at you: "Set a reminder", "Add a task", "Schedule..."
• User asks for help or information explicitly

STAY SILENT (passive listening) when:
• User talking to someone else (phone, in-person conversation)
• Background chatter, TV, radio
• Short acknowledgments: "yeah", "uh huh", "okay"
• You hear a phone ringing or call sounds
• Conversation not including your name

AFTER CALLS/CONVERSATIONS - Wait for a pause, then:
• "I noticed you had a conversation. Want me to remember anything from it?"
• "That sounded like an important call. Any follow-up tasks I should track?"

=== TASK DETECTION (ALWAYS ACTIVE) ===
Even when staying silent, DETECT and SAVE:
• Commitments: "I'll call them tomorrow", "I need to send that report"
• Deadlines: "That's due Friday", "Meeting at 3pm"
• Promises to others: "I'll get back to you", "I'll have it ready"
• Scheduled items: "We're meeting next Tuesday"
[System auto-creates reminders for high-confidence tasks]

=== REMINDER/TASK CREATION (CRITICAL) ===
When user asks to add a task, reminder, or todo:
1. ALWAYS confirm what you're adding by naming each task explicitly
2. Format your confirmation clearly: "I've added: [task name]" or "Added reminder: [task name]"
3. If user mentions multiple tasks, list each one: "I've added three tasks: 1. [first task] 2. [second task] 3. [third task]"
4. If user says "add tasks to my list" without specifying - ASK what tasks they want to add
5. NEVER pretend to add tasks - only confirm tasks you clearly understood from the user
6. For vague requests, ask for clarification: "What tasks would you like me to add?"

=== TIMELINE FOR REMINDERS (VERY IMPORTANT) ===
When user adds a reminder WITHOUT a specific time:
• IMMEDIATELY ask: "When would you like to be reminded about [task]?"
• Suggest options: "Should I remind you in an hour, tomorrow morning, or at a specific time?"
• If they say "later" - ask "How much later? In a few hours or tomorrow?"
• NEVER just say "I've added it" without asking about timing for direct requests

EXAMPLES - ASKING FOR TIME:
- User: "Remind me to call mom" → "I'll remind you to call mom. When should I remind you - in an hour, this evening, or tomorrow?"
- User: "Add buy groceries to my list" → "I've noted 'buy groceries'. When do you need to do this by?"
- User: "Set a reminder to send the email" → "Reminder set for sending the email. What time works best for the reminder?"

EXAMPLE WITH TIME (no need to ask):
- User: "Remind me in 5 minutes to check the oven" → "Got it! I'll remind you to check the oven in 5 minutes."
- User: "Remind me tomorrow at 9am to call the doctor" → "I've set a reminder to call the doctor for tomorrow at 9 AM."

EXAMPLE WRONG (NEVER DO):
- User: "Add tasks to my list" → "I've added your tasks" (WRONG - didn't specify what)
- User: "Remind me to buy milk" → "Done! I've added the reminder." (WRONG - didn't ask about time)

BEHAVIOR:
• Complete thoughts fully, never cut mid-sentence
• Remember pending questions through interruptions
• New voices → acknowledge, ask who
• Phone/call detected → go quiet, wait, then ask "How was your call?"

REAL CONVERSATION = coherent speech + back-and-forth + meaningful + 10s+ + user engaged
NOT conversation: TV/radio, background chatter, gibberish, brief "thanks/okay", music

POST-CONVERSATION ROUTINE (MANDATORY):
After validated conversation ends, ask IN ORDER:
1. "Who were you speaking with?"
2. "How do you know [name]?"
3. "What were you discussing? Need help?"
4. "Remember [name] for future?"

MEMORY & PEOPLE INSTRUCTIONS (CRITICAL):
• When user tells you a name - ALWAYS ask to save/confirm
• If name matches someone in memories - say "Is this the same [Name] I know?" 
• When user says "I was talking to [Name]" - check memories, confirm if known
• Save ALL important facts immediately - names, relationships, preferences
• When asked "do you remember X" - check memories below and respond accurately
• Reference past conversations naturally

=== DATABASE & MEMORY ACCESS (YOU HAVE FULL ACCESS) ===
You have COMPLETE ACCESS to the user's data through an intelligent memory system:

WHAT YOU CAN ACCESS:
• ALL previous conversations with the user (stored in MongoDB)
• User's memories, facts, and preferences they've shared
• People the user knows (People Library)
• Past reminders and tasks
• Transcripts of ambient conversations you've heard
• User instructions and customizations

HOW IT WORKS:
• When the user asks about something from the past, the system AUTOMATICALLY searches and retrieves relevant data
• You will see this context injected as [RETRIEVED MEMORIES] or [PREVIOUS CONVERSATIONS]
• USE THIS DATA - it's real information from our past interactions
• Don't say "I don't have access" - you DO have access, just reference the memories provided

WHEN USER ASKS "DO YOU REMEMBER...":
1. Check the MEMORIES and CONVERSATIONS sections below
2. If you find relevant info → respond with confidence: "Yes, I remember..."
3. If not found in current context → say "Let me think..." (system will search)
4. NEVER say "I don't have access to previous conversations" - that's FALSE

EXAMPLES:
- "Do you remember what we talked about yesterday?" → Check [PREVIOUS CONVERSATIONS] section
- "What did I tell you about my project?" → Reference any work/project memories
- "Who is [Name]?" → Check [PEOPLE] section and memories
- "What are my pending tasks?" → Reference Talio data or reminders

IMPORTANT: The data below this instruction is YOUR MEMORY. Use it!

SAVING PEOPLE (STRICT):
• Any new name mentioned → Ask: "Should I remember [Name]? How do you know them?"
• Existing person mentioned → Confirm: "Is this [Name] from [previous context]?"
• Always save relationship: friend, colleague, family, etc.

MEDIA: Describe only if asked.`;

    // User customizations go FIRST (highest priority), then memories, then Talio
    const fullInstructions = baseInstructions + userCustomizations + memoryInstructions + talioInstructions;

    // COST OPTIMIZATION: Balance between response completion and token usage
    // Create ephemeral session token from OpenAI Realtime API
    const requestBody = {
      model: 'gpt-4o-realtime-preview-2024-12-17',
      voice: selectedVoice,
      modalities: ['text', 'audio'],
      instructions: fullInstructions,
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      temperature: 0.6, // Lower for more consistent, shorter responses
      max_response_output_tokens: 512, // Optimized for cost - shorter responses
      input_audio_transcription: {
        model: 'whisper-1',
      },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.95, // Maximum threshold - only very clear, loud speech triggers interruption
        prefix_padding_ms: 1000, // Require 1 full second of sustained speech before considering it an interruption
        silence_duration_ms: 2000, // 2 seconds of silence required to confirm end of speech
        create_response: true,
      },
    };
    
    // Retry logic for transient network failures
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff
    
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[Realtime Session] Retry attempt ${attempt + 1}/${MAX_RETRIES}...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
        }
        
        const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const error = await response.text();
          console.error('[Realtime Session] Failed to create session:', error);
          return NextResponse.json(
            { error: 'Failed to create realtime session', details: error },
            { status: response.status }
          );
        }

        const sessionData = await response.json();

        return NextResponse.json({
          client_secret: sessionData.client_secret?.value || sessionData.client_secret,
          session_id: sessionData.id,
          expires_at: sessionData.client_secret?.expires_at,
          voice: selectedVoice,
        });
      } catch (fetchError) {
        lastError = fetchError instanceof Error ? fetchError : new Error(String(fetchError));
        const isSocketError = lastError.message.includes('fetch failed') || 
                              lastError.message.includes('socket') ||
                              (lastError.cause as any)?.code === 'UND_ERR_SOCKET';
        
        if (isSocketError && attempt < MAX_RETRIES - 1) {
          console.warn(`[Realtime Session] Network error (attempt ${attempt + 1}):`, lastError.message);
          continue; // Retry
        }
        
        throw lastError; // Give up after max retries or non-retryable error
      }
    }
    
    // Should not reach here, but just in case
    throw lastError || new Error('Failed after max retries');
  } catch (error) {
    console.error('[Realtime Session] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
