// Talio Data Queries - Role-aware data fetching for MIRA
// Handles tasks, attendance, projects, messages, and more

import { getTenantConnection } from './talioDb';
import { TalioUser, TalioEmployee, canAccessUserData, hasRole } from './talioAuth';
import mongoose, { Schema } from 'mongoose';

// ========== Additional Schemas ==========

const TaskSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project' },
  title: String,
  description: String,
  status: { type: String, enum: ['todo', 'in-progress', 'review', 'completed', 'rejected'] },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'] },
  createdBy: { type: Schema.Types.ObjectId, ref: 'Employee' },
  assignedBy: { type: Schema.Types.ObjectId, ref: 'Employee' },
  dueDate: Date,
  startDate: Date,
  estimatedHours: Number,
  progressPercentage: { type: Number, default: 0 },
  subtasks: [{
    title: String,
    isComplete: Boolean,
  }],
  tags: [String],
}, { timestamps: true });

const TaskAssigneeSchema = new Schema({
  task: { type: Schema.Types.ObjectId, ref: 'Task' },
  user: { type: Schema.Types.ObjectId, ref: 'Employee' },
  assignedBy: { type: Schema.Types.ObjectId, ref: 'Employee' },
  assignmentStatus: { type: String, enum: ['pending', 'accepted', 'rejected'] },
  hoursLogged: { type: Number, default: 0 },
  assignedAt: Date,
  respondedAt: Date,
}, { timestamps: true });

const AttendanceSchema = new Schema({
  employee: { type: Schema.Types.ObjectId, ref: 'Employee' },
  date: Date,
  checkIn: Date,
  checkOut: Date,
  status: { type: String, enum: ['present', 'absent', 'half-day', 'late', 'leave', 'holiday', 'weekend'] },
  checkInStatus: String,
  checkOutStatus: String,
  workHours: Number,
  overtime: Number,
  workFromHome: Boolean,
  remarks: String,
}, { timestamps: true });

const ProjectSchema = new Schema({
  name: String,
  description: String,
  status: { type: String, enum: ['planned', 'active', 'on-hold', 'completed', 'cancelled'] },
  startDate: Date,
  endDate: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: 'Employee' },
  projectHead: { type: Schema.Types.ObjectId, ref: 'Employee' },
  projectHeads: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
  department: { type: Schema.Types.ObjectId, ref: 'Department' },
  completionPercentage: { type: Number, default: 0 },
  priority: String,
  chatGroup: { type: Schema.Types.ObjectId, ref: 'Chat' },
}, { timestamps: true });

const ProjectMemberSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project' },
  user: { type: Schema.Types.ObjectId, ref: 'Employee' },
  role: { type: String, enum: ['head', 'member', 'viewer'] },
  invitationStatus: { type: String, enum: ['pending', 'accepted', 'rejected'] },
  permissions: {
    canCreateTasks: Boolean,
    canAssignTasks: Boolean,
    canEditProject: Boolean,
    canInviteMembers: Boolean,
  },
}, { timestamps: true });

const ChatSchema = new Schema({
  isGroup: Boolean,
  groupName: String,
  participants: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
  groupAdmins: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
  messages: [{
    sender: { type: Schema.Types.ObjectId, ref: 'Employee' },
    content: String,
    isRead: [{
      user: { type: Schema.Types.ObjectId, ref: 'Employee' },
      readAt: Date,
    }],
    reactions: [{
      user: { type: Schema.Types.ObjectId, ref: 'Employee' },
      emoji: String,
    }],
    createdAt: Date,
  }],
  isProjectChat: Boolean,
  lastMessage: String,
  lastMessageAt: Date,
}, { timestamps: true });

const NotificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  title: String,
  message: String,
  type: String,
  isRead: Boolean,
  url: String,
  data: Schema.Types.Mixed,
}, { timestamps: true });

const DepartmentSchema = new Schema({
  name: String,
  code: String,
  description: String,
  head: { type: Schema.Types.ObjectId, ref: 'Employee' },
  heads: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
  isActive: Boolean,
}, { timestamps: true });

const LeaveSchema = new Schema({
  employee: { type: Schema.Types.ObjectId, ref: 'Employee' },
  leaveType: { type: Schema.Types.ObjectId, ref: 'LeaveType' },
  startDate: Date,
  endDate: Date,
  reason: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'] },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true });

const EmployeeSchema = new Schema({
  firstName: String,
  lastName: String,
  email: String,
  employeeCode: String,
  phone: String,
  department: { type: Schema.Types.ObjectId, ref: 'Department' },
  designation: { type: Schema.Types.ObjectId, ref: 'Designation' },
  reportingManager: { type: Schema.Types.ObjectId, ref: 'Employee' },
  isActive: Boolean,
  dateOfJoining: Date,
}, { timestamps: true });

const UserSchema = new Schema({
  email: String,
  role: String,
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
  isActive: Boolean,
  isDepartmentHead: Boolean,
  headOfDepartments: [{ type: Schema.Types.ObjectId, ref: 'Department' }],
}, { timestamps: true });

// ========== Query Result Interfaces ==========

export interface TaskInfo {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  dueDate?: Date;
  startDate?: Date;
  projectName?: string;
  assignedBy?: string;
  progressPercentage: number;
  estimatedHours?: number;
  isOverdue: boolean;
}

export interface AttendanceInfo {
  date: Date;
  status: string;
  checkIn?: Date;
  checkOut?: Date;
  workHours?: number;
  overtime?: number;
  workFromHome: boolean;
  remarks?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  description?: string;
  status: string;
  startDate?: Date;
  endDate?: Date;
  completionPercentage: number;
  priority: string;
  role: string;
  taskCount?: number;
  memberCount?: number;
}

export interface MessageSummary {
  chatId: string;
  chatName: string;
  isGroup: boolean;
  unreadCount: number;
  lastMessage?: string;
  lastMessageAt?: Date;
  participantNames?: string[];
}

export interface NotificationInfo {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: Date;
  url?: string;
}

// ========== Helper Functions ==========

function getModels(conn: mongoose.Connection) {
  return {
    User: conn.models.User || conn.model('User', UserSchema),
    Employee: conn.models.Employee || conn.model('Employee', EmployeeSchema),
    Task: conn.models.Task || conn.model('Task', TaskSchema),
    TaskAssignee: conn.models.TaskAssignee || conn.model('TaskAssignee', TaskAssigneeSchema),
    Attendance: conn.models.Attendance || conn.model('Attendance', AttendanceSchema),
    Project: conn.models.Project || conn.model('Project', ProjectSchema),
    ProjectMember: conn.models.ProjectMember || conn.model('ProjectMember', ProjectMemberSchema),
    Chat: conn.models.Chat || conn.model('Chat', ChatSchema),
    Notification: conn.models.Notification || conn.model('Notification', NotificationSchema),
    Department: conn.models.Department || conn.model('Department', DepartmentSchema),
    Leave: conn.models.Leave || conn.model('Leave', LeaveSchema),
  };
}

// ========== Task Queries ==========

/**
 * Get tasks assigned to a user
 */
export async function getUserTasks(
  employeeId: string,
  tenantDatabase: string,
  options?: { status?: string; limit?: number; includeOverdue?: boolean }
): Promise<TaskInfo[]> {
  try {
    const conn = await getTenantConnection(tenantDatabase);
    const { Task, TaskAssignee, Project, Employee } = getModels(conn);

    // Find task assignments for this user
    const assignments = await TaskAssignee.find({
      user: employeeId,
      assignmentStatus: { $in: ['pending', 'accepted'] },
    }).lean() as any[];

    const taskIds = assignments.map(a => a.task);

    let query: any = { _id: { $in: taskIds } };
    
    if (options?.status) {
      query.status = options.status;
    }

    const tasks = await Task.find(query)
      .populate('project', 'name')
      .populate('assignedBy', 'firstName lastName')
      .sort({ dueDate: 1 })
      .limit(options?.limit || 50)
      .lean() as any[];

    const now = new Date();

    return tasks.map((task: any) => ({
      id: task._id.toString(),
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      startDate: task.startDate,
      projectName: task.project?.name,
      assignedBy: task.assignedBy 
        ? `${task.assignedBy.firstName} ${task.assignedBy.lastName || ''}`.trim()
        : undefined,
      progressPercentage: task.progressPercentage || 0,
      estimatedHours: task.estimatedHours,
      isOverdue: task.dueDate ? new Date(task.dueDate) < now && task.status !== 'completed' : false,
    }));
  } catch (error) {
    console.error('[TalioQueries] Error getting user tasks:', error);
    return [];
  }
}

/**
 * Get tasks for a project (for project heads)
 */
export async function getProjectTasks(
  projectId: string,
  tenantDatabase: string,
  requestingUser: TalioUser
): Promise<TaskInfo[]> {
  try {
    const conn = await getTenantConnection(tenantDatabase);
    const { Task, Project, ProjectMember, Employee } = getModels(conn);

    // Check if user is project head or member
    const project = await Project.findById(projectId).lean() as any;
    if (!project) return [];

    const isHead = project.projectHead?.toString() === requestingUser.employeeId ||
      project.projectHeads?.some((h: any) => h.toString() === requestingUser.employeeId);
    
    const membership = await ProjectMember.findOne({
      project: projectId,
      user: requestingUser.employeeId,
      invitationStatus: 'accepted',
    }).lean() as any;

    // Allow admin/hr or project head/member
    if (!hasRole(requestingUser.role, ['admin', 'hr']) && !isHead && !membership) {
      return [];
    }

    const tasks = await Task.find({ project: projectId })
      .populate('assignedBy', 'firstName lastName')
      .sort({ dueDate: 1 })
      .lean() as any[];

    const now = new Date();

    return tasks.map((task: any) => ({
      id: task._id.toString(),
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      startDate: task.startDate,
      projectName: project.name,
      assignedBy: task.assignedBy 
        ? `${task.assignedBy.firstName} ${task.assignedBy.lastName || ''}`.trim()
        : undefined,
      progressPercentage: task.progressPercentage || 0,
      estimatedHours: task.estimatedHours,
      isOverdue: task.dueDate ? new Date(task.dueDate) < now && task.status !== 'completed' : false,
    }));
  } catch (error) {
    console.error('[TalioQueries] Error getting project tasks:', error);
    return [];
  }
}

// ========== Attendance Queries ==========

/**
 * Get attendance records for a user
 */
export async function getUserAttendance(
  employeeId: string,
  tenantDatabase: string,
  options?: { startDate?: Date; endDate?: Date; limit?: number }
): Promise<AttendanceInfo[]> {
  try {
    const conn = await getTenantConnection(tenantDatabase);
    const { Attendance } = getModels(conn);

    const query: any = { employee: employeeId };
    
    if (options?.startDate || options?.endDate) {
      query.date = {};
      if (options.startDate) query.date.$gte = options.startDate;
      if (options.endDate) query.date.$lte = options.endDate;
    }

    const records = await Attendance.find(query)
      .sort({ date: -1 })
      .limit(options?.limit || 30)
      .lean();

    return records.map(record => ({
      date: record.date,
      status: record.status,
      checkIn: record.checkIn,
      checkOut: record.checkOut,
      workHours: record.workHours,
      overtime: record.overtime,
      workFromHome: record.workFromHome || false,
      remarks: record.remarks,
    }));
  } catch (error) {
    console.error('[TalioQueries] Error getting attendance:', error);
    return [];
  }
}

/**
 * Get attendance summary for today/week/month
 */
export async function getAttendanceSummary(
  employeeId: string,
  tenantDatabase: string,
  period: 'today' | 'week' | 'month' = 'month'
): Promise<{
  totalDays: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  halfDays: number;
  leaveDays: number;
  totalWorkHours: number;
  averageWorkHours: number;
}> {
  try {
    const conn = await getTenantConnection(tenantDatabase);
    const { Attendance } = getModels(conn);

    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const records = await Attendance.find({
      employee: employeeId,
      date: { $gte: startDate, $lte: now },
    }).lean();

    const summary = {
      totalDays: records.length,
      presentDays: records.filter(r => r.status === 'present').length,
      absentDays: records.filter(r => r.status === 'absent').length,
      lateDays: records.filter(r => r.checkInStatus === 'late').length,
      halfDays: records.filter(r => r.status === 'half-day').length,
      leaveDays: records.filter(r => r.status === 'leave').length,
      totalWorkHours: records.reduce((sum, r) => sum + (r.workHours || 0), 0),
      averageWorkHours: 0,
    };

    summary.averageWorkHours = summary.presentDays > 0 
      ? Math.round((summary.totalWorkHours / summary.presentDays) * 100) / 100
      : 0;

    return summary;
  } catch (error) {
    console.error('[TalioQueries] Error getting attendance summary:', error);
    return {
      totalDays: 0,
      presentDays: 0,
      absentDays: 0,
      lateDays: 0,
      halfDays: 0,
      leaveDays: 0,
      totalWorkHours: 0,
      averageWorkHours: 0,
    };
  }
}

// ========== Project Queries ==========

/**
 * Get projects for a user
 */
export async function getUserProjects(
  employeeId: string,
  tenantDatabase: string,
  options?: { status?: string; limit?: number }
): Promise<ProjectInfo[]> {
  try {
    const conn = await getTenantConnection(tenantDatabase);
    const { Project, ProjectMember, Task } = getModels(conn);

    // Find projects where user is a member
    const memberships = await ProjectMember.find({
      user: employeeId,
      invitationStatus: 'accepted',
    }).lean() as any[];

    const projectIds = memberships.map(m => m.project);

    let query: any = { _id: { $in: projectIds } };
    if (options?.status) {
      query.status = options.status;
    }

    const projects = await Project.find(query)
      .sort({ updatedAt: -1 })
      .limit(options?.limit || 20)
      .lean() as any[];

    // Get task counts and member counts
    const projectInfos: ProjectInfo[] = await Promise.all(
      projects.map(async (project: any) => {
        const membership = memberships.find(
          m => m.project.toString() === project._id.toString()
        );
        
        const taskCount = await Task.countDocuments({ project: project._id });
        const memberCount = await ProjectMember.countDocuments({ 
          project: project._id,
          invitationStatus: 'accepted'
        });

        return {
          id: project._id.toString(),
          name: project.name,
          description: project.description,
          status: project.status,
          startDate: project.startDate,
          endDate: project.endDate,
          completionPercentage: project.completionPercentage || 0,
          priority: project.priority || 'medium',
          role: membership?.role || 'member',
          taskCount,
          memberCount,
        };
      })
    );

    return projectInfos;
  } catch (error) {
    console.error('[TalioQueries] Error getting projects:', error);
    return [];
  }
}

// ========== Message/Chat Queries ==========

/**
 * Get unread messages summary for a user
 */
export async function getUnreadMessages(
  employeeId: string,
  userId: string,
  tenantDatabase: string
): Promise<MessageSummary[]> {
  try {
    const conn = await getTenantConnection(tenantDatabase);
    const { Chat, Employee } = getModels(conn);

    // Find chats where user is a participant
    const chats = await Chat.find({
      participants: { $in: [employeeId, userId] },
    })
      .populate('participants', 'firstName lastName')
      .sort({ lastMessageAt: -1 })
      .lean() as any[];

    const summaries: MessageSummary[] = [];

    for (const chat of chats) {
      // Count unread messages
      const unreadCount = chat.messages?.filter((msg: any) => {
        if (msg.sender?.toString() === employeeId || msg.sender?.toString() === userId) {
          return false; // Own messages are read
        }
        const isRead = msg.isRead?.some(
          (r: any) => r.user?.toString() === employeeId || r.user?.toString() === userId
        );
        return !isRead;
      }).length || 0;

      if (unreadCount > 0 || chat.lastMessage) {
        const participantNames = chat.participants
          ?.filter((p: any) => p._id?.toString() !== employeeId && p._id?.toString() !== userId)
          .map((p: any) => `${p.firstName} ${p.lastName || ''}`.trim());

        summaries.push({
          chatId: chat._id.toString(),
          chatName: chat.isGroup ? (chat.groupName || 'Group Chat') : (participantNames?.[0] || 'Chat'),
          isGroup: chat.isGroup || false,
          unreadCount,
          lastMessage: chat.lastMessage,
          lastMessageAt: chat.lastMessageAt,
          participantNames,
        });
      }
    }

    return summaries.filter(s => s.unreadCount > 0);
  } catch (error) {
    console.error('[TalioQueries] Error getting messages:', error);
    return [];
  }
}

// ========== Notification Queries ==========

/**
 * Get unread notifications for a user
 */
export async function getUnreadNotifications(
  userId: string,
  tenantDatabase: string,
  limit: number = 20
): Promise<NotificationInfo[]> {
  try {
    const conn = await getTenantConnection(tenantDatabase);
    const { Notification } = getModels(conn);

    const notifications = await Notification.find({
      user: userId,
      isRead: false,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean() as any[];

    return notifications.map((n: any) => ({
      id: n._id.toString(),
      title: n.title,
      message: n.message,
      type: n.type,
      isRead: n.isRead,
      createdAt: n.createdAt,
      url: n.url,
    }));
  } catch (error) {
    console.error('[TalioQueries] Error getting notifications:', error);
    return [];
  }
}

// ========== Team/Department Queries ==========

/**
 * Get team members (for managers/department heads)
 */
export async function getTeamMembers(
  requestingUser: TalioUser,
  tenantDatabase: string
): Promise<TalioEmployee[]> {
  try {
    const conn = await getTenantConnection(tenantDatabase);
    const { Employee, User, Department } = getModels(conn);

    let employees: any[] = [];

    // Admin/HR can see everyone
    if (hasRole(requestingUser.role, ['admin', 'hr'])) {
      employees = await Employee.find({ isActive: true })
        .populate('department', 'name')
        .populate('designation', 'title')
        .lean() as any[];
    }
    // Department head sees their departments
    else if (requestingUser.role === 'department_head') {
      const user = await User.findById(requestingUser._id)
        .populate('headOfDepartments')
        .lean() as any;

      if (user?.headOfDepartments?.length) {
        const deptIds = user.headOfDepartments.map((d: any) => d._id);
        employees = await Employee.find({ 
          department: { $in: deptIds },
          isActive: true 
        })
          .populate('department', 'name')
          .populate('designation', 'title')
          .lean() as any[];
      }
    }
    // Manager sees direct reports
    else if (requestingUser.role === 'manager') {
      employees = await Employee.find({
        reportingManager: requestingUser.employeeId,
        isActive: true,
      })
        .populate('department', 'name')
        .populate('designation', 'title')
        .lean() as any[];
    }

    return employees.map(emp => ({
      _id: emp._id.toString(),
      firstName: emp.firstName,
      lastName: emp.lastName || '',
      email: emp.email,
      employeeCode: emp.employeeCode,
      phone: emp.phone,
      department: emp.department?._id?.toString(),
      designation: emp.designation?._id?.toString(),
      reportingManager: emp.reportingManager?.toString(),
      isActive: emp.isActive,
      dateOfJoining: emp.dateOfJoining,
    }));
  } catch (error) {
    console.error('[TalioQueries] Error getting team members:', error);
    return [];
  }
}

/**
 * Get department attendance summary (for department heads/HR/admin)
 */
export async function getDepartmentAttendance(
  departmentId: string,
  tenantDatabase: string,
  requestingUser: TalioUser,
  date?: Date
): Promise<{
  totalEmployees: number;
  present: number;
  absent: number;
  late: number;
  onLeave: number;
  workFromHome: number;
}> {
  try {
    // Check permissions
    if (!hasRole(requestingUser.role, ['admin', 'hr', 'department_head'])) {
      return { totalEmployees: 0, present: 0, absent: 0, late: 0, onLeave: 0, workFromHome: 0 };
    }

    const conn = await getTenantConnection(tenantDatabase);
    const { Employee, Attendance, User } = getModels(conn);

    // For department heads, verify they head this department
    if (requestingUser.role === 'department_head') {
      const user = await User.findById(requestingUser._id).lean() as any;
      const headsDept = user?.headOfDepartments?.some(
        (d: any) => d.toString() === departmentId
      );
      if (!headsDept) {
        return { totalEmployees: 0, present: 0, absent: 0, late: 0, onLeave: 0, workFromHome: 0 };
      }
    }

    const targetDate = date || new Date();
    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    // Get employees in department
    const employees = await Employee.find({
      department: departmentId,
      isActive: true,
    }).lean() as any[];

    const employeeIds = employees.map(e => e._id);

    // Get attendance records for today
    const attendances = await Attendance.find({
      employee: { $in: employeeIds },
      date: { $gte: startOfDay, $lt: endOfDay },
    }).lean() as any[];

    return {
      totalEmployees: employees.length,
      present: attendances.filter((a: any) => a.status === 'present').length,
      absent: employees.length - attendances.length,
      late: attendances.filter((a: any) => a.checkInStatus === 'late').length,
      onLeave: attendances.filter((a: any) => a.status === 'leave').length,
      workFromHome: attendances.filter((a: any) => a.workFromHome).length,
    };
  } catch (error) {
    console.error('[TalioQueries] Error getting department attendance:', error);
    return { totalEmployees: 0, present: 0, absent: 0, late: 0, onLeave: 0, workFromHome: 0 };
  }
}

// ========== Dashboard/Overview Queries ==========

/**
 * Get dashboard overview for a user
 */
export async function getDashboardOverview(
  user: TalioUser,
  employee: TalioEmployee,
  tenantDatabase: string
): Promise<{
  tasks: { total: number; pending: number; inProgress: number; overdue: number };
  attendance: { status: string; checkIn?: Date; workHours?: number };
  projects: { total: number; active: number };
  messages: { unread: number };
  notifications: { unread: number };
}> {
  try {
    const conn = await getTenantConnection(tenantDatabase);
    const { Task, TaskAssignee, Attendance, ProjectMember, Chat, Notification } = getModels(conn);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Task stats
    const assignments = await TaskAssignee.find({
      user: employee._id,
      assignmentStatus: { $in: ['pending', 'accepted'] },
    }).lean() as any[];
    const taskIds = assignments.map(a => a.task);
    
    const tasks = await Task.find({ _id: { $in: taskIds } }).lean() as any[];
    const taskStats = {
      total: tasks.length,
      pending: tasks.filter((t: any) => t.status === 'todo').length,
      inProgress: tasks.filter((t: any) => t.status === 'in-progress').length,
      overdue: tasks.filter((t: any) => 
        t.dueDate && new Date(t.dueDate) < now && t.status !== 'completed'
      ).length,
    };

    // Today's attendance
    const attendance = await Attendance.findOne({
      employee: employee._id,
      date: { $gte: today },
    }).lean() as any;
    const attendanceInfo = {
      status: attendance?.status || 'not-checked-in',
      checkIn: attendance?.checkIn,
      workHours: attendance?.workHours,
    };

    // Project stats
    const memberships = await ProjectMember.find({
      user: employee._id,
      invitationStatus: 'accepted',
    }).lean() as any[];
    const projectStats = {
      total: memberships.length,
      active: memberships.length, // Simplified - would need to join with projects
    };

    // Unread messages
    const chats = await Chat.find({
      participants: { $in: [employee._id, user._id] },
    }).lean() as any[];
    
    let unreadMessages = 0;
    for (const chat of chats) {
      unreadMessages += chat.messages?.filter((msg: any) => {
        if (msg.sender?.toString() === employee._id || msg.sender?.toString() === user._id) {
          return false;
        }
        return !msg.isRead?.some(
          (r: any) => r.user?.toString() === employee._id || r.user?.toString() === user._id
        );
      }).length || 0;
    }

    // Unread notifications
    const unreadNotifications = await Notification.countDocuments({
      user: user._id,
      isRead: false,
    });

    return {
      tasks: taskStats,
      attendance: attendanceInfo,
      projects: projectStats,
      messages: { unread: unreadMessages },
      notifications: { unread: unreadNotifications },
    };
  } catch (error) {
    console.error('[TalioQueries] Error getting dashboard:', error);
    return {
      tasks: { total: 0, pending: 0, inProgress: 0, overdue: 0 },
      attendance: { status: 'unknown' },
      projects: { total: 0, active: 0 },
      messages: { unread: 0 },
      notifications: { unread: 0 },
    };
  }
}
