// Talio MIRA Integration - Natural Language Query Handler
// Interprets user questions and fetches relevant data from Talio HRMS

import { 
  TalioUser, 
  TalioEmployee, 
  TalioTenantInfo,
  getTalioUserInfo,
  hasRole 
} from './talioAuth';
import {
  getUserTasks,
  getProjectTasks,
  getUserAttendance,
  getAttendanceSummary,
  getUserProjects,
  getUnreadMessages,
  getUnreadNotifications,
  getTeamMembers,
  getDepartmentAttendance,
  getDashboardOverview,
  TaskInfo,
  AttendanceInfo,
  ProjectInfo,
  MessageSummary,
} from './talioQueries';
import { getTenantConnection } from './talioDb';

// ========== Interfaces ==========

export interface TalioContext {
  user: TalioUser;
  employee: TalioEmployee;
  tenant: TalioTenantInfo;
  isConnected: boolean;
}

export interface TalioQueryResult {
  success: boolean;
  type: string;
  data: any;
  summary: string;
  suggestions?: string[];
}

// Interface for MIRA integration (used by chat route)
export interface TalioMiraUser {
  email: string;
  talioUserId: string;
  tenantDatabase: string;
  role: 'admin' | 'manager' | 'employee' | 'dept_head';
  employeeId?: string;
  department?: string;
}

// Result from handleTalioQuery
export interface TalioQueryResponse {
  success: boolean;
  message: string;
  data: any;
  queryType: string;
}

// ========== Talio Session Cache ==========

// Cache Talio context per MIRA user
const talioContextCache = new Map<string, TalioContext>();

/**
 * Initialize Talio context for a MIRA user
 * Call this after MIRA authentication to check if user has Talio access
 */
export async function initializeTalioContext(miraUserEmail: string): Promise<TalioContext | null> {
  try {
    // Check if already cached
    const cached = talioContextCache.get(miraUserEmail.toLowerCase());
    if (cached?.isConnected) {
      return cached;
    }

    // Look up user in Talio
    const result = await getTalioUserInfo(miraUserEmail);
    
    if (!result.success || !result.user || !result.employee || !result.tenant) {
      console.log(`[TalioMira] User ${miraUserEmail} not found in Talio HRMS`);
      return null;
    }

    const context: TalioContext = {
      user: result.user,
      employee: result.employee,
      tenant: result.tenant,
      isConnected: true,
    };

    talioContextCache.set(miraUserEmail.toLowerCase(), context);
    console.log(`[TalioMira] Initialized Talio context for ${miraUserEmail} (${result.tenant.companyName})`);
    
    return context;
  } catch (error) {
    console.error('[TalioMira] Error initializing context:', error);
    return null;
  }
}

/**
 * Get cached Talio context for a user
 */
export function getTalioContext(miraUserEmail: string): TalioContext | null {
  return talioContextCache.get(miraUserEmail.toLowerCase()) || null;
}

/**
 * Clear Talio context (on logout)
 */
export function clearTalioContext(miraUserEmail: string): void {
  talioContextCache.delete(miraUserEmail.toLowerCase());
}

// ========== Query Intent Detection ==========

interface QueryIntent {
  type: 'tasks' | 'attendance' | 'projects' | 'messages' | 'notifications' | 'team' | 'dashboard' | 'help' | 'unknown';
  subtype?: string;
  target?: 'self' | 'team' | 'department' | 'specific';
  targetName?: string;
  timeframe?: 'today' | 'week' | 'month' | 'all';
  projectName?: string;
}

/**
 * Detect what the user is asking about
 */
export function detectTalioQueryIntent(message: string): QueryIntent {
  const lower = message.toLowerCase();
  
  // Task-related queries
  if (/\b(task|tasks|todo|to-do|assignment|work items?)\b/i.test(lower)) {
    let intent: QueryIntent = { type: 'tasks' };
    
    if (/\b(overdue|late|pending|urgent)\b/i.test(lower)) {
      intent.subtype = 'overdue';
    } else if (/\b(today|today'?s)\b/i.test(lower)) {
      intent.timeframe = 'today';
    } else if (/\b(this week|weekly)\b/i.test(lower)) {
      intent.timeframe = 'week';
    }
    
    // Check if asking about team/others
    if (/\b(team|my team|team'?s|members?)\b/i.test(lower)) {
      intent.target = 'team';
    } else if (/\b(department|dept)\b/i.test(lower)) {
      intent.target = 'department';
    }
    
    return intent;
  }
  
  // Attendance-related queries
  if (/\b(attendance|check[- ]?in|check[- ]?out|present|absent|leave|work hours?|working hours?)\b/i.test(lower)) {
    let intent: QueryIntent = { type: 'attendance' };
    
    if (/\b(today|today'?s)\b/i.test(lower)) {
      intent.timeframe = 'today';
    } else if (/\b(this week|weekly)\b/i.test(lower)) {
      intent.timeframe = 'week';
    } else if (/\b(this month|monthly)\b/i.test(lower)) {
      intent.timeframe = 'month';
    }
    
    if (/\b(team|department|everyone|all)\b/i.test(lower)) {
      intent.target = 'team';
    }
    
    return intent;
  }
  
  // Project-related queries
  if (/\b(project|projects?|progress|milestone|deadline)\b/i.test(lower)) {
    let intent: QueryIntent = { type: 'projects' };
    
    // Extract project name if mentioned
    const projectMatch = lower.match(/project\s+["']?([^"']+)["']?/i);
    if (projectMatch) {
      intent.projectName = projectMatch[1].trim();
    }
    
    if (/\b(task|tasks|progress|status)\b/i.test(lower) && intent.projectName) {
      intent.subtype = 'tasks';
    }
    
    return intent;
  }
  
  // Message-related queries
  if (/\b(message|messages|chat|unread|inbox|dm|conversation)\b/i.test(lower)) {
    return { type: 'messages' };
  }
  
  // Notification-related queries
  if (/\b(notification|notifications?|alert|alerts?|updates?)\b/i.test(lower)) {
    return { type: 'notifications' };
  }
  
  // Team-related queries
  if (/\b(team|team members?|my team|direct reports?|employees?|who'?s|who is)\b/i.test(lower)) {
    return { type: 'team' };
  }
  
  // Dashboard/overview queries
  if (/\b(dashboard|overview|summary|status|how'?s (my|things?)|what'?s (up|happening|pending))\b/i.test(lower)) {
    return { type: 'dashboard' };
  }
  
  // Help queries
  if (/\b(help|what can you|how do i|capabilities|features)\b/i.test(lower) && /\b(talio|hrms|work|office)\b/i.test(lower)) {
    return { type: 'help' };
  }
  
  return { type: 'unknown' };
}

// ========== Main Query Handler ==========

/**
 * Process a Talio-related query from the user
 */
export async function processTalioQuery(
  message: string,
  context: TalioContext
): Promise<TalioQueryResult> {
  const intent = detectTalioQueryIntent(message);
  
  try {
    switch (intent.type) {
      case 'tasks':
        return await handleTaskQuery(context, intent);
      
      case 'attendance':
        return await handleAttendanceQuery(context, intent);
      
      case 'projects':
        return await handleProjectQuery(context, intent);
      
      case 'messages':
        return await handleMessageQuery(context);
      
      case 'notifications':
        return await handleNotificationQuery(context);
      
      case 'team':
        return await handleTeamQuery(context);
      
      case 'dashboard':
        return await handleDashboardQuery(context);
      
      case 'help':
        return getTalioHelpResponse(context);
      
      default:
        return {
          success: false,
          type: 'unknown',
          data: null,
          summary: "I'm not sure what you're asking about. You can ask me about your tasks, attendance, projects, messages, or get a dashboard overview.",
          suggestions: [
            "What are my tasks for today?",
            "Show my attendance this month",
            "What's my dashboard status?",
            "Do I have any unread messages?",
          ],
        };
    }
  } catch (error) {
    console.error('[TalioMira] Query error:', error);
    return {
      success: false,
      type: intent.type,
      data: null,
      summary: "Sorry, I encountered an error while fetching your data. Please try again.",
    };
  }
}

// ========== Query Handlers ==========

async function handleTaskQuery(
  context: TalioContext,
  intent: QueryIntent
): Promise<TalioQueryResult> {
  const { user, employee, tenant } = context;
  
  // Check if asking about team (requires manager+ role)
  if (intent.target === 'team' || intent.target === 'department') {
    if (!hasRole(user.role, ['manager', 'department_head', 'hr', 'admin'])) {
      return {
        success: false,
        type: 'tasks',
        data: null,
        summary: "You don't have permission to view team tasks. You can only see your own tasks.",
      };
    }
    
    // Get team members' tasks - simplified for now
    const teamMembers = await getTeamMembers(user, tenant.databaseName);
    let allTasks: TaskInfo[] = [];
    
    for (const member of teamMembers.slice(0, 10)) { // Limit to 10 members
      const memberTasks = await getUserTasks(member._id, tenant.databaseName, { limit: 10 });
      allTasks.push(...memberTasks);
    }
    
    const overdueTasks = allTasks.filter(t => t.isOverdue);
    const inProgressTasks = allTasks.filter(t => t.status === 'in-progress');
    
    return {
      success: true,
      type: 'tasks',
      data: { tasks: allTasks, teamMembers: teamMembers.length },
      summary: `Your team of ${teamMembers.length} members has ${allTasks.length} total tasks. ${overdueTasks.length} are overdue and ${inProgressTasks.length} are in progress.`,
      suggestions: [
        "Show me overdue tasks",
        "Who has the most pending tasks?",
        "Show tasks by priority",
      ],
    };
  }
  
  // Get user's own tasks
  const tasks = await getUserTasks(employee._id, tenant.databaseName, {
    limit: 20,
  });
  
  const overdueTasks = tasks.filter(t => t.isOverdue);
  const pendingTasks = tasks.filter(t => t.status === 'todo');
  const inProgressTasks = tasks.filter(t => t.status === 'in-progress');
  
  let summary = `You have ${tasks.length} tasks. `;
  
  if (overdueTasks.length > 0) {
    summary += `⚠️ ${overdueTasks.length} are overdue! `;
  }
  
  summary += `${pendingTasks.length} pending, ${inProgressTasks.length} in progress.`;
  
  if (tasks.length > 0) {
    const topTask = overdueTasks[0] || pendingTasks[0] || tasks[0];
    summary += ` Your most urgent task is "${topTask.title}" (${topTask.priority} priority).`;
  }
  
  return {
    success: true,
    type: 'tasks',
    data: { tasks, overdue: overdueTasks, pending: pendingTasks, inProgress: inProgressTasks },
    summary,
    suggestions: overdueTasks.length > 0 
      ? ["Show me overdue tasks", "Help me prioritize"]
      : ["Show my projects", "What's on my dashboard?"],
  };
}

async function handleAttendanceQuery(
  context: TalioContext,
  intent: QueryIntent
): Promise<TalioQueryResult> {
  const { user, employee, tenant } = context;
  
  // Team/department attendance (requires permissions)
  if (intent.target === 'team') {
    if (!hasRole(user.role, ['hr', 'admin', 'department_head'])) {
      return {
        success: false,
        type: 'attendance',
        data: null,
        summary: "You don't have permission to view team attendance.",
      };
    }
    
    // For department heads, get their department attendance
    // Simplified - would need to look up their departments
    return {
      success: true,
      type: 'attendance',
      data: null,
      summary: "Team attendance overview requires department context. Please specify which department.",
      suggestions: ["Show HR department attendance", "Who's absent today?"],
    };
  }
  
  // Get personal attendance
  const period = intent.timeframe === 'all' ? 'month' : (intent.timeframe || 'month');
  const summary = await getAttendanceSummary(employee._id, tenant.databaseName, period);
  const recentAttendance = await getUserAttendance(employee._id, tenant.databaseName, { limit: 10 });
  
  const todayRecord = recentAttendance.find(a => {
    const recordDate = new Date(a.date);
    const today = new Date();
    return recordDate.toDateString() === today.toDateString();
  });
  
  let summaryText = '';
  
  if (period === 'today' || intent.timeframe === 'today') {
    if (todayRecord) {
      summaryText = `Today you're marked as ${todayRecord.status}. `;
      if (todayRecord.checkIn) {
        summaryText += `Checked in at ${new Date(todayRecord.checkIn).toLocaleTimeString()}. `;
      }
      if (todayRecord.workHours) {
        summaryText += `${todayRecord.workHours.toFixed(1)} hours logged.`;
      }
    } else {
      summaryText = "You haven't checked in today yet.";
    }
  } else {
    summaryText = `This ${period}: ${summary.presentDays} days present out of ${summary.totalDays}. `;
    summaryText += `${summary.lateDays} late arrivals, ${summary.leaveDays} leave days. `;
    summaryText += `Average ${summary.averageWorkHours} hours/day.`;
  }
  
  return {
    success: true,
    type: 'attendance',
    data: { summary, recent: recentAttendance, today: todayRecord },
    summary: summaryText,
    suggestions: [
      "Show my attendance this week",
      "When was I late this month?",
      "How many leaves do I have left?",
    ],
  };
}

async function handleProjectQuery(
  context: TalioContext,
  intent: QueryIntent
): Promise<TalioQueryResult> {
  const { user, employee, tenant } = context;
  
  const projects = await getUserProjects(employee._id, tenant.databaseName);
  
  if (projects.length === 0) {
    return {
      success: true,
      type: 'projects',
      data: { projects: [] },
      summary: "You're not currently assigned to any projects.",
    };
  }
  
  // If asking about specific project
  if (intent.projectName) {
    const project = projects.find(p => 
      p.name.toLowerCase().includes(intent.projectName!.toLowerCase())
    );
    
    if (!project) {
      return {
        success: false,
        type: 'projects',
        data: null,
        summary: `I couldn't find a project matching "${intent.projectName}".`,
      };
    }
    
    // Get project tasks if requested
    if (intent.subtype === 'tasks') {
      const tasks = await getProjectTasks(project.id, tenant.databaseName, user);
      const overdue = tasks.filter(t => t.isOverdue);
      const inProgress = tasks.filter(t => t.status === 'in-progress');
      
      return {
        success: true,
        type: 'projects',
        data: { project, tasks },
        summary: `"${project.name}" has ${tasks.length} tasks: ${overdue.length} overdue, ${inProgress.length} in progress. Completion: ${project.completionPercentage}%.`,
      };
    }
    
    return {
      success: true,
      type: 'projects',
      data: { project },
      summary: `"${project.name}" is ${project.status}. ${project.completionPercentage}% complete with ${project.taskCount || 0} tasks.`,
      suggestions: [
        `Show tasks for ${project.name}`,
        "Who's on this project?",
      ],
    };
  }
  
  // Overview of all projects
  const activeProjects = projects.filter(p => p.status === 'active' || p.status === 'planned');
  const headProjects = projects.filter(p => p.role === 'head');
  
  let summaryText = `You're on ${projects.length} projects (${activeProjects.length} active). `;
  if (headProjects.length > 0) {
    summaryText += `You're leading ${headProjects.length} of them. `;
  }
  
  const topProject = projects[0];
  summaryText += `Most recent: "${topProject.name}" (${topProject.completionPercentage}% complete).`;
  
  return {
    success: true,
    type: 'projects',
    data: { projects },
    summary: summaryText,
    suggestions: projects.slice(0, 3).map(p => `Show details for "${p.name}"`),
  };
}

async function handleMessageQuery(context: TalioContext): Promise<TalioQueryResult> {
  const { user, employee, tenant } = context;
  
  const unreadChats = await getUnreadMessages(employee._id, user._id, tenant.databaseName);
  
  if (unreadChats.length === 0) {
    return {
      success: true,
      type: 'messages',
      data: { chats: [] },
      summary: "You have no unread messages. All caught up! 🎉",
    };
  }
  
  const totalUnread = unreadChats.reduce((sum, c) => sum + c.unreadCount, 0);
  
  let summaryText = `You have ${totalUnread} unread messages in ${unreadChats.length} conversations. `;
  
  // Highlight top unread
  const topChat = unreadChats[0];
  summaryText += `Most recent from ${topChat.chatName}: "${topChat.lastMessage?.substring(0, 50)}${topChat.lastMessage && topChat.lastMessage.length > 50 ? '...' : ''}"`;
  
  return {
    success: true,
    type: 'messages',
    data: { chats: unreadChats, totalUnread },
    summary: summaryText,
    suggestions: ["Show all messages", "Reply to " + topChat.chatName],
  };
}

async function handleNotificationQuery(context: TalioContext): Promise<TalioQueryResult> {
  const { user, tenant } = context;
  
  const notifications = await getUnreadNotifications(user._id, tenant.databaseName, 10);
  
  if (notifications.length === 0) {
    return {
      success: true,
      type: 'notifications',
      data: { notifications: [] },
      summary: "You have no unread notifications.",
    };
  }
  
  const topNotif = notifications[0];
  const summaryText = `You have ${notifications.length} unread notifications. Latest: "${topNotif.title}"`;
  
  return {
    success: true,
    type: 'notifications',
    data: { notifications },
    summary: summaryText,
  };
}

async function handleTeamQuery(context: TalioContext): Promise<TalioQueryResult> {
  const { user, tenant } = context;
  
  if (!hasRole(user.role, ['manager', 'department_head', 'hr', 'admin'])) {
    return {
      success: false,
      type: 'team',
      data: null,
      summary: "You don't have team management permissions. Contact HR for team information.",
    };
  }
  
  const teamMembers = await getTeamMembers(user, tenant.databaseName);
  
  if (teamMembers.length === 0) {
    return {
      success: true,
      type: 'team',
      data: { members: [] },
      summary: "You don't have any direct reports or team members assigned.",
    };
  }
  
  const summaryText = `You have ${teamMembers.length} team members. ` +
    teamMembers.slice(0, 5).map(m => `${m.firstName} ${m.lastName}`).join(', ') +
    (teamMembers.length > 5 ? ` and ${teamMembers.length - 5} more.` : '.');
  
  return {
    success: true,
    type: 'team',
    data: { members: teamMembers },
    summary: summaryText,
    suggestions: [
      "Show team attendance today",
      "Show team task progress",
      "Who's on leave?",
    ],
  };
}

async function handleDashboardQuery(context: TalioContext): Promise<TalioQueryResult> {
  const { user, employee, tenant } = context;
  
  const dashboard = await getDashboardOverview(user, employee, tenant.databaseName);
  
  let summaryText = `📊 Dashboard for ${employee.firstName}:\n`;
  
  // Attendance
  if (dashboard.attendance.status === 'present') {
    summaryText += `✅ Checked in (${dashboard.attendance.workHours?.toFixed(1) || 0}h logged)\n`;
  } else if (dashboard.attendance.status === 'not-checked-in') {
    summaryText += `⏰ Not checked in yet today\n`;
  } else {
    summaryText += `📅 Today: ${dashboard.attendance.status}\n`;
  }
  
  // Tasks
  summaryText += `📋 ${dashboard.tasks.total} tasks`;
  if (dashboard.tasks.overdue > 0) {
    summaryText += ` (⚠️ ${dashboard.tasks.overdue} overdue!)`;
  }
  summaryText += `\n`;
  
  // Projects
  summaryText += `📁 ${dashboard.projects.total} active projects\n`;
  
  // Messages & notifications
  if (dashboard.messages.unread > 0 || dashboard.notifications.unread > 0) {
    summaryText += `📬 ${dashboard.messages.unread} unread messages, ${dashboard.notifications.unread} notifications`;
  } else {
    summaryText += `✨ No pending messages or notifications`;
  }
  
  return {
    success: true,
    type: 'dashboard',
    data: dashboard,
    summary: summaryText,
    suggestions: [
      "Show my overdue tasks",
      "Who messaged me?",
      "Show project details",
    ],
  };
}

function getTalioHelpResponse(context: TalioContext): TalioQueryResult {
  const { user, employee, tenant } = context;
  
  let helpText = `Hi ${employee.firstName}! I can help you with your ${tenant.companyName} HRMS data:\n\n`;
  
  helpText += `📋 **Tasks**: "What are my tasks?", "Show overdue tasks"\n`;
  helpText += `📅 **Attendance**: "Show my attendance this month", "Am I checked in?"\n`;
  helpText += `📁 **Projects**: "What projects am I on?", "Show project Talio progress"\n`;
  helpText += `💬 **Messages**: "Do I have unread messages?"\n`;
  helpText += `🔔 **Notifications**: "Show my notifications"\n`;
  helpText += `📊 **Dashboard**: "What's my status?", "Give me an overview"\n`;
  
  if (hasRole(user.role, ['manager', 'department_head', 'hr', 'admin'])) {
    helpText += `\n👥 **Team** (${user.role}): "Show my team", "Team attendance today"`;
  }
  
  return {
    success: true,
    type: 'help',
    data: null,
    summary: helpText,
  };
}

// ========== Proactive Insights ==========

/**
 * Get proactive insights for a user (for MIRA to mention unprompted)
 */
export async function getProactiveInsights(context: TalioContext): Promise<{
  hasUrgentItems: boolean;
  insights: string[];
}> {
  const { user, employee, tenant } = context;
  const insights: string[] = [];
  
  try {
    // Check for overdue tasks
    const tasks = await getUserTasks(employee._id, tenant.databaseName, { limit: 20 });
    const overdueTasks = tasks.filter(t => t.isOverdue);
    if (overdueTasks.length > 0) {
      insights.push(`⚠️ You have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}`);
    }
    
    // Check for unread messages
    const unreadChats = await getUnreadMessages(employee._id, user._id, tenant.databaseName);
    const totalUnread = unreadChats.reduce((sum, c) => sum + c.unreadCount, 0);
    if (totalUnread > 5) {
      insights.push(`📬 ${totalUnread} unread messages waiting for you`);
    }
    
    // Check attendance (if not checked in after 10am on weekday)
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    
    if (day >= 1 && day <= 5 && hour >= 10) { // Weekday after 10am
      const attendance = await getUserAttendance(employee._id, tenant.databaseName, { limit: 1 });
      const todayRecord = attendance.find(a => 
        new Date(a.date).toDateString() === now.toDateString()
      );
      
      if (!todayRecord || todayRecord.status === 'not-checked-in') {
        insights.push(`⏰ You haven't checked in today yet`);
      }
    }
    
    return {
      hasUrgentItems: insights.length > 0,
      insights,
    };
  } catch (error) {
    console.error('[TalioMira] Error getting proactive insights:', error);
    return { hasUrgentItems: false, insights: [] };
  }
}

// ========== Direct API Functions for MIRA Chat Integration ==========

/**
 * Check if a message appears to be a Talio HRMS related query
 * Used by chat route to decide whether to fetch Talio data
 */
export function isTalioQuery(message: string): boolean {
  const lower = message.toLowerCase();
  
  // Work/HRMS related keywords
  const workKeywords = [
    // Tasks
    'task', 'tasks', 'todo', 'to-do', 'assignment', 'work item',
    // Attendance
    'attendance', 'check in', 'check-in', 'checkin', 'check out', 'check-out', 'checkout',
    'present', 'absent', 'leave', 'work hours', 'working hours', 'late', 'overtime',
    // Projects
    'project', 'projects', 'milestone', 'deadline', 'progress',
    // Messages
    'message', 'messages', 'unread', 'inbox', 'notification', 'notifications',
    // Team
    'team', 'team member', 'coworker', 'colleague', 'manager', 'department', 'employee',
    // Dashboard
    'dashboard', 'overview', 'summary', 'work status', 'office',
    // General work
    'hr', 'hrms', 'talio', 'work', 'pending', 'overdue', 'assigned',
  ];
  
  // Check for any work-related keyword
  return workKeywords.some(keyword => lower.includes(keyword));
}

/**
 * Handle a Talio query from MIRA chat
 * This is the main entry point used by the chat API route
 */
export async function handleTalioQuery(
  message: string,
  user: TalioMiraUser
): Promise<TalioQueryResponse> {
  try {
    // First, check if we have a cached context or need to build one
    let context = getTalioContext(user.email);
    
    if (!context) {
      // Initialize context from the user info we have
      const userInfo = await getTalioUserInfo(user.email);
      
      if (!userInfo.success || !userInfo.user || !userInfo.employee || !userInfo.tenant) {
        return {
          success: false,
          message: "I couldn't find your Talio HRMS account. Please make sure your email is linked to Talio.",
          data: null,
          queryType: 'error',
        };
      }
      
      context = {
        user: userInfo.user,
        employee: userInfo.employee,
        tenant: userInfo.tenant,
        isConnected: true,
      };
      
      // Cache for future use
      talioContextCache.set(user.email.toLowerCase(), context);
    }
    
    // Process the query
    const result = await processTalioQuery(message, context);
    
    return {
      success: result.success,
      message: result.summary,
      data: result.data,
      queryType: result.type,
    };
    
  } catch (error) {
    console.error('[TalioMira] handleTalioQuery error:', error);
    return {
      success: false,
      message: "Sorry, I encountered an error while accessing your work data. Please try again.",
      data: null,
      queryType: 'error',
    };
  }
}
