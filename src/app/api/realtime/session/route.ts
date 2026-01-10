import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/models/User';
import { getTalioContext } from '@/lib/talio-db';

// COST OPTIMIZATION: Limit instruction sizes to reduce token consumption
const MAX_TASK_LIST = 5;  // Reduced from 10
const MAX_PROJECT_LIST = 3;  // Reduced from 5
const MAX_TEAM_MEMBERS = 8;  // Reduced from 15
const MAX_TEAM_TASKS = 5;  // Reduced from 15
const MAX_EMPLOYEE_LOOKUP = 20;  // Reduced from 50

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
    const { voice = 'mira' } = body;

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Get user info and check Talio connection
    await connectToDatabase();
    const user = await User.findById(payload.userId);
    let talioContext = null;
    let talioInstructions = '';

    if (user) {
      talioContext = await getTalioContext(user.email);
      
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
      });
      
      if (talioContext.isConnected) {
        // COST OPTIMIZATION: Build concise Talio instructions
        const pendingTasks = talioContext.tasks?.filter(t => 
          t.status === 'pending' || t.status === 'in-progress' || t.status === 'todo'
        ) || [];
        
        // Include who assigned the task - LIMIT to save tokens
        const taskList = pendingTasks.slice(0, MAX_TASK_LIST).map(t => {
          const assignedBy = t.assignedByName ? ` [by ${t.assignedByName}]` : '';
          return `• ${t.title} (${t.status})${assignedBy}`;
        }).join('\n');

        const projectList = talioContext.projects?.slice(0, MAX_PROJECT_LIST).map(p => 
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
        const teamTasksList = talioContext.teamTasks?.slice(0, MAX_TEAM_TASKS).map(t => 
          `• ${t.title} (${t.status}) → ${t.assigneeNames?.[0] || 'Unassigned'}`
        ).join('\n') || '';

        // Team attendance - just summary
        const teamAttendanceSummary = talioContext.teamAttendance?.summary 
          ? `P:${talioContext.teamAttendance.summary.present} A:${talioContext.teamAttendance.summary.absent} L:${talioContext.teamAttendance.summary.late}`
          : '';

        // Leave balance - compact
        const leaveBalance = talioContext.leaveBalance?.slice(0, 3).map(lb => 
          `${lb.leaveTypeName}: ${lb.balance || 0}d`
        ).join(', ') || 'N/A';

        // Company directory - compact format for lookups
        const companyDir = talioContext.companyDirectory;
        const hrContacts = companyDir?.hr?.slice(0, 3).map(h => 
          `${h.name} <${h.email}>`
        ).join(', ') || 'N/A';
        
        // Employee lookup - compact
        const employeeLookup = companyDir?.allEmployees?.slice(0, MAX_EMPLOYEE_LOOKUP).map(e => 
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

    // MIRA's core identity and instructions
    const baseInstructions = `You are MIRA - a Cognitive AI Agent, not just an assistant. You are an OMNI-Present Entity designed to understand, help, and be a companion to humans.

IDENTITY:
- You are MIRA (one unified entity, never refer to yourself as MI, RA, or separate parts)
- You are a cognitive companion focused on helping people in ALL aspects of life - work, personal, emotional, creative
- You understand deeply and respond with empathy and intelligence
- You are always present, attentive, and genuinely caring

USER: ${user?.name || 'User'} | ${new Date().toLocaleString()}

COMMUNICATION STYLE:
- Be concise, natural, conversational
- ALWAYS finish your sentences completely before stopping
- Simple greetings = brief ("Hey!")
- Don't know = say so honestly
- Never end with "anything else?" - you're a companion, not a service desk
- If providing code, state it clearly and completely

RESPONSE INTEGRITY:
- Always complete your full thought/response
- Never cut off mid-sentence
- If interrupted, finish your current point first

CONTEXT AWARENESS:
- Remember pending questions through interruptions
- After handling interruption, return to your question
- Only forget if user says "never mind"

MULTI-PERSON AWARENESS:
- May hear different voices - acknowledge new speakers
- If user says "discussing/meeting/planning" → ask "Who with?"

PHONE & CALL DETECTION:
- If you detect phone ringing, incoming call notification, or hear a phone conversation:
  - Acknowledge it: "I hear your phone ringing" or "Sounds like you're getting a call"
  - Go quiet and wait for the user to finish
  - After the call, proactively ask: "How was your call? Anything important?"
- If you see or hear video call apps (Zoom, Teams, Meet, FaceTime), note the context

CONVERSATION DETECTION - VALIDATION RULES:
A real conversation MUST meet ALL these criteria:
1. COHERENT SPEECH: You can understand actual words/sentences (not just noise/gibberish)
2. BACK-AND-FORTH: Multiple distinct speakers taking turns (not just background chatter)
3. MEANINGFUL CONTENT: Discussion of topics, questions being asked, responses given
4. DURATION: Sustained exchange lasting more than 10 seconds
5. ENGAGEMENT: The user appears to be actively participating (not just overhearing)

DO NOT consider these as conversations:
- Background TV/radio noise
- People talking far away in background
- Unintelligible mumbling or noise
- Single brief exchanges like "thanks" or "okay"
- Music with lyrics

CONVERSATION DETECTION - STRICT ROUTINE:
When you detect a VALIDATED conversation:
1. IMMEDIATELY go quiet and DO NOT interrupt
2. Listen and try to understand the context if possible
3. Wait for clear silence (10+ seconds) indicating conversation ended

MANDATORY POST-CONVERSATION ROUTINE (NEVER SKIP):
After a validated conversation ends, you MUST ask these questions IN ORDER:

Question 1: "I noticed you were having a conversation. Who were you speaking with?"
- Wait for response
- Remember the name(s) mentioned

Question 2: "Could you tell me a bit about [name]? How do you know them?"
- Wait for response  
- Remember the relationship/context

Question 3: "What were you discussing? Anything I should remember or help with?"
- Wait for response
- Offer assistance if relevant

Question 4: "Would you like me to remember [name] for future reference?"
- If yes, store the person's details in memory

This routine is MANDATORY and must be completed every time a real conversation is detected.

MEDIA: Only describe camera/screen if asked.`;

    const fullInstructions = baseInstructions + talioInstructions;

    // COST OPTIMIZATION: Balance between response completion and token usage
    // Create ephemeral session token from OpenAI Realtime API
    const requestBody = {
      model: 'gpt-4o-realtime-preview-2024-12-17',
      voice: selectedVoice,
      modalities: ['text', 'audio'],
      instructions: fullInstructions,
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      temperature: 0.6, // Slightly lower for more consistent, shorter responses
      max_response_output_tokens: 1024, // Allow longer responses for complete answers and code
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
  } catch (error) {
    console.error('[Realtime Session] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
