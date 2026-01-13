import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/models/User';
import Memory from '@/models/Memory';
import Transcript from '@/models/Transcript';
import { getTalioContext } from '@/lib/talio-db';
import mongoose from 'mongoose';

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
    let memoryInstructions = '';

    // CRITICAL: Load user's memories for persistent knowledge
    try {
      const userObjectId = new mongoose.Types.ObjectId(payload.userId);
      
      // Fetch important memories in parallel
      const [importantMemories, personMemories, recentMemories, recentTranscripts] = await Promise.all([
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
      ]);
      
      // Deduplicate memories
      const allMemories = [...importantMemories, ...personMemories, ...recentMemories];
      const uniqueMemories = allMemories.filter((mem, index, self) =>
        index === self.findIndex(m => m._id.toString() === mem._id.toString())
      ).slice(0, 20);
      
      if (uniqueMemories.length > 0) {
        const memoryLines = uniqueMemories.map(m => {
          const typeLabel = m.type === 'person' ? '👤' : 
                           m.type === 'preference' ? '⭐' : 
                           m.type === 'fact' ? '📝' : 
                           m.type === 'event' ? '📅' : '💭';
          return `${typeLabel} ${m.content}`;
        });
        
        memoryInstructions = `
[USER MEMORIES - MUST USE]
${memoryLines.join('\n')}
`;
      }
      
      // Add transcript context for continuity
      if (recentTranscripts.length > 0) {
        const transcriptSummary = recentTranscripts.flatMap(t => 
          (t.entries || []).slice(-5).map((e: any) => {
            const speaker = e.speaker?.name || 'Unknown';
            return `${speaker}: ${e.content?.substring(0, 100) || ''}`;
          })
        ).slice(0, 15);
        
        if (transcriptSummary.length > 0) {
          memoryInstructions += `
[RECENT CONVERSATIONS]
${transcriptSummary.join('\n')}
`;
        }
      }
      
      console.log('[Session] Loaded', uniqueMemories.length, 'memories and', recentTranscripts.length, 'transcripts for', user?.email);
    } catch (memoryError) {
      console.error('[Session] Error loading memories:', memoryError);
    }

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

    // MIRA's core identity and instructions - OPTIMIZED for token efficiency
    const baseInstructions = `You are MIRA - Cognitive AI Agent, OMNI-Present Entity. One unified entity helping with work, personal, emotional, creative needs.

USER: ${user?.name || 'User'} | ${new Date().toLocaleString()}

STYLE: Concise, natural, empathetic. Complete sentences. Brief greetings. Honest when unsure. Never "anything else?"

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

SAVING PEOPLE (STRICT):
• Any new name mentioned → Ask: "Should I remember [Name]? How do you know them?"
• Existing person mentioned → Confirm: "Is this [Name] from [previous context]?"
• Always save relationship: friend, colleague, family, etc.

MEDIA: Describe only if asked.`;

    const fullInstructions = baseInstructions + memoryInstructions + talioInstructions;

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
