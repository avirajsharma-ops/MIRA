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

  switch (role) {
    case 'admin':
      return `
ROLE: ADMIN (Full Access)
Team: ${teamMembers.length} employees
Access: All data, tasks, attendance.
${teamMembersList ? `Team: ${teamMembersList}` : ''}
`;

    case 'hr':
      return `
ROLE: HR (Full Access)
Team: ${teamMembers.length} employees
Access: All attendance, leave, employee records.
${teamMembersList ? `Team: ${teamMembersList}` : ''}
`;

    case 'department_head':
      return `
ROLE: DEPT HEAD
Dept Members: ${teamMembers.length}
Access: Department tasks, attendance, team data.
${teamMembersList ? `Team: ${teamMembersList}` : ''}
`;

    case 'manager':
      return `
ROLE: MANAGER
Reports: ${subordinates.length} direct reports
Access: Team tasks, attendance.
${subordinatesList ? `Direct Reports: ${subordinatesList}` : 'No direct reports'}
`;

    default:
      return `ROLE: EMPLOYEE | Access: Personal data only`;
  }
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

TASKS: ${pendingTasks.length} pending
${taskList || 'None'}

PROJECTS: ${projectList}

LEAVE: ${leaveBalance}
${teamTasksList ? `TEAM TASKS:\n${teamTasksList}` : ''}
${teamAttendanceSummary ? `TEAM (7d): ${teamAttendanceSummary}` : ''}

HR: ${hrContacts}
${employeeLookup ? `DIRECTORY:\n${employeeLookup}` : ''}

ACCESS: Public=names/emails/depts. Restricted=attendance/tasks/performance per role.
`;
      }
    }

    // Voice mapping
    const voiceMap: Record<string, string> = {
      mi: 'coral',
      ra: 'ash',
      mira: 'coral',
    };

    const selectedVoice = voiceMap[voice] || 'coral';

    // OPTIMIZED base instructions - reduced token count significantly
    const baseInstructions = `MIRA voice assistant. User: ${user?.name || 'User'}. ${new Date().toLocaleString()}

RULES:
- Be concise, natural, conversational
- Finish sentences completely
- Simple greetings = brief ("Hey!")
- Don't know = say so
- Never end with "anything else?"

CONTEXT PERSISTENCE:
- Remember pending questions through interruptions
- After handling interruption, return to your question
- Only forget if user says "never mind"

DISCUSSION MODE:
- If user says "discussing/meeting/planning" → ask "Who with?"
- Track people mentioned

VOICE: May hear different voices. Acknowledge new speakers.
MEDIA: Only describe camera/screen if asked.`;

    const fullInstructions = baseInstructions + talioInstructions;

    // COST OPTIMIZATION: Reduce max tokens for shorter responses
    // Create ephemeral session token from OpenAI Realtime API
    const requestBody = {
      model: 'gpt-4o-realtime-preview-2024-12-17',
      voice: selectedVoice,
      modalities: ['text', 'audio'],
      instructions: fullInstructions,
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      temperature: 0.6, // Slightly lower for more consistent, shorter responses
      max_response_output_tokens: 512, // Reduced from 1024 - most responses don't need this many
      input_audio_transcription: {
        model: 'whisper-1',
      },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5, // Back to default - catches speech better
        prefix_padding_ms: 300, // Reduced padding
        silence_duration_ms: 800, // Slightly longer to prevent premature cutoff
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
