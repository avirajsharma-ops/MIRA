import mongoose from 'mongoose';

const TALIO_MONGODB_URI = process.env.TALIO_MONGODB_URI;

// Database name for the company
const TALIO_DB_NAME = process.env.TALIO_DB_NAME || 'talio_company_mushroom_world_group';

interface TalioCache {
  conn: mongoose.Connection | null;
  promise: Promise<mongoose.Connection> | null;
  db: any | null;
}

declare global {
  var talioMongoose: TalioCache | undefined;
}

let cached: TalioCache = global.talioMongoose || { conn: null, promise: null, db: null };

if (!global.talioMongoose) {
  global.talioMongoose = cached;
}

// Get the correct Talio database connection
export async function connectToTalioDB(): Promise<mongoose.Connection | null> {
  if (!TALIO_MONGODB_URI) {
    console.warn('[Talio] TALIO_MONGODB_URI not configured');
    return null;
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose.createConnection(TALIO_MONGODB_URI, {
      bufferCommands: false,
    }).asPromise();
  }

  try {
    cached.conn = await cached.promise;
    console.log('[Talio] Connected to Talio database');
  } catch (e) {
    cached.promise = null;
    console.error('[Talio] Failed to connect:', e);
    return null;
  }

  return cached.conn;
}

// Get the specific database (talio_company_mushroom_world_group)
export async function getTalioDB() {
  const conn = await connectToTalioDB();
  if (!conn) return null;
  
  // Use the correct database name
  return conn.useDb(TALIO_DB_NAME).db;
}

// Check if a user email exists in Talio DB and get their full info
export async function checkTalioUser(email: string): Promise<{ 
  exists: boolean; 
  userId?: string; 
  employeeId?: string;
  companyId?: string;
  role?: string;
  isDepartmentHead?: boolean;
  headOfDepartments?: string[];
  employee?: any;
}> {
  try {
    const db = await getTalioDB();
    if (!db) {
      return { exists: false };
    }

    // Find user in Talio's users collection
    const usersCollection = db.collection('users');
    const user = await usersCollection.findOne({ 
      $or: [
        { email: email },
        { email: email.toLowerCase() },
      ]
    });

    if (!user) {
      console.log('[Talio] User not found for email:', email);
      return { exists: false };
    }

    console.log('[Talio] Found user:', user._id.toString(), 'employeeId:', user.employeeId?.toString(), 'role:', user.role, 'isDepartmentHead:', user.isDepartmentHead);

    // Get employee details for hierarchy info
    let employee = null;
    if (user.employeeId) {
      const employeesCollection = db.collection('employees');
      employee = await employeesCollection.findOne({ _id: user.employeeId });
    }

    return {
      exists: true,
      userId: user._id.toString(),
      employeeId: user.employeeId?.toString(),
      companyId: user.company?.toString(),
      role: user.role,
      isDepartmentHead: user.isDepartmentHead || false,
      headOfDepartments: user.headOfDepartments?.map((d: any) => d.toString()) || [],
      employee,
    };
  } catch (error) {
    console.error('[Talio] Error checking user:', error);
    return { exists: false };
  }
}

// Get user's tasks from Talio - using taskassignees for assignments
// Now includes assignedBy information
export async function getTalioTasks(userId: string, employeeId?: string, limit = 20): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const employeeObjectId = employeeId ? new mongoose.Types.ObjectId(employeeId) : null;
    
    // First, get task assignments for this user from taskassignees
    // The taskassignees collection uses 'user' field which stores employeeId
    const taskAssigneesCollection = db.collection('taskassignees');
    
    // Try both userId and employeeId since the field is called 'user' but stores employeeId
    const assigneeQuery = employeeObjectId 
      ? { $or: [{ user: userObjectId }, { user: employeeObjectId }] }
      : { user: userObjectId };
    
    const taskAssignments = await taskAssigneesCollection
      .find(assigneeQuery)
      .toArray();
    
    // Create a map of taskId -> assignedBy for quick lookup
    const assignmentMap = new Map<string, { assignedBy: any, assignedAt: Date, assignmentStatus: string }>();
    for (const ta of taskAssignments) {
      assignmentMap.set(ta.task?.toString(), {
        assignedBy: ta.assignedBy,
        assignedAt: ta.assignedAt,
        assignmentStatus: ta.assignmentStatus,
      });
    }
    
    const assignedIds = taskAssignments.map(ta => ta.task);
    console.log('[Talio] Found', assignedIds.length, 'task assignments for user');

    // Get tasks where user is creator OR assigned
    const tasksCollection = db.collection('tasks');
    
    // Build query conditions
    const queryConditions: any[] = [
      { createdBy: userObjectId },
      { assignedBy: userObjectId },
      { _id: { $in: assignedIds } },
    ];
    
    // Also check with employeeId
    if (employeeObjectId) {
      queryConditions.push({ createdBy: employeeObjectId });
      queryConditions.push({ assignedBy: employeeObjectId });
    }
    
    const tasks = await tasksCollection
      .find({ $or: queryConditions })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(limit)
      .toArray();

    // Enrich tasks with assignedBy name and other info
    const employeesCollection = db.collection('employees');
    for (const task of tasks) {
      // Get assignment info from taskassignees
      const assignment = assignmentMap.get(task._id?.toString());
      if (assignment) {
        task.assignedByEmployeeId = assignment.assignedBy?.toString();
        task.assignedAt = assignment.assignedAt;
        task.assignmentStatus = assignment.assignmentStatus;
        
        // Get assignedBy name
        if (assignment.assignedBy) {
          const assigner = await employeesCollection.findOne({ _id: assignment.assignedBy });
          task.assignedByName = assigner ? `${assigner.firstName} ${assigner.lastName || ''}`.trim() : 'Unknown';
        }
      }
      
      // Also get createdBy name
      if (task.createdBy) {
        const creator = await employeesCollection.findOne({ _id: task.createdBy });
        task.createdByName = creator ? `${creator.firstName} ${creator.lastName || ''}`.trim() : 'Unknown';
      }
      
      // Get project name if available
      if (task.project) {
        const projectsCollection = db.collection('projects');
        const project = await projectsCollection.findOne({ _id: task.project });
        task.projectName = project?.name || 'Unknown Project';
      }
    }

    console.log('[Talio] Found', tasks.length, 'tasks for user');
    return tasks;
  } catch (error) {
    console.error('[Talio] Error fetching tasks:', error);
    return [];
  }
}

// Get tasks assigned to subordinates (for managers)
export async function getSubordinateTasks(employeeId: string, companyId: string, limit = 30): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    // Get the employee's department and check if they're a department head
    const employeesCollection = db.collection('employees');
    const employee = await employeesCollection.findOne({ _id: new mongoose.Types.ObjectId(employeeId) });
    
    if (!employee) return [];

    // Get all employees in the same department or subordinates
    const subordinates = await employeesCollection
      .find({
        company: new mongoose.Types.ObjectId(companyId),
        $or: [
          { reportingManager: new mongoose.Types.ObjectId(employeeId) },
          { department: employee.department },
        ]
      })
      .toArray();

    const subordinateEmployeeIds = subordinates.map(s => s._id);
    
    // Get tasks for subordinates - use 'user' field which stores employeeId
    const taskAssigneesCollection = db.collection('taskassignees');
    const assignedTaskIds = await taskAssigneesCollection
      .find({ user: { $in: subordinateEmployeeIds } })
      .toArray();
    
    const taskIds = assignedTaskIds.map(ta => ta.task);

    const tasksCollection = db.collection('tasks');
    const tasks = await tasksCollection
      .find({ _id: { $in: taskIds } })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();

    return tasks;
  } catch (error) {
    console.error('[Talio] Error fetching subordinate tasks:', error);
    return [];
  }
}

// Get user's projects from Talio
export async function getTalioProjects(userId: string, companyId?: string, employeeId?: string, limit = 20): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const employeeObjectId = employeeId ? new mongoose.Types.ObjectId(employeeId) : null;

    // Check project members collection - uses 'user' field which stores employeeId
    const projectMembersCollection = db.collection('projectmembers');
    
    const memberQuery = employeeObjectId
      ? { $or: [{ user: userObjectId }, { user: employeeObjectId }, { employee: userObjectId }, { employee: employeeObjectId }] }
      : { $or: [{ user: userObjectId }, { employee: userObjectId }] };
    
    const memberOf = await projectMembersCollection
      .find(memberQuery)
      .toArray();
    
    const memberProjectIds = memberOf.map(m => m.project);
    console.log('[Talio] Found', memberProjectIds.length, 'project memberships');

    // Build query conditions
    const queryConditions: any[] = [
      { createdBy: userObjectId },
      { projectHead: userObjectId },
      { projectHeads: userObjectId },
      { _id: { $in: memberProjectIds } },
    ];

    // Also check with employeeId
    if (employeeObjectId) {
      queryConditions.push({ createdBy: employeeObjectId });
      queryConditions.push({ projectHead: employeeObjectId });
      queryConditions.push({ projectHeads: employeeObjectId });
    }

    // Get projects where user is creator, head, or member
    const projectsCollection = db.collection('projects');
    const projects = await projectsCollection
      .find({ $or: queryConditions })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();

    console.log('[Talio] Found', projects.length, 'projects for user');
    return projects;
  } catch (error) {
    console.error('[Talio] Error fetching projects:', error);
    return [];
  }
}

// Get user's messages from Talio
export async function getTalioMessages(userId: string, limit = 50): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const messagesCollection = db.collection('messages');
    const messages = await messagesCollection
      .find({
        $or: [
          { sender: userObjectId },
          { recipient: userObjectId },
          { 'recipients': userObjectId },
        ]
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return messages;
  } catch (error) {
    console.error('[Talio] Error fetching messages:', error);
    return [];
  }
}

// Get attendance records from Talio
export async function getTalioAttendance(employeeId: string, days = 30): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const attendanceCollection = db.collection('attendances');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const attendance = await attendanceCollection
      .find({
        employee: new mongoose.Types.ObjectId(employeeId),
        date: { $gte: startDate }
      })
      .sort({ date: -1 })
      .toArray();

    return attendance;
  } catch (error) {
    console.error('[Talio] Error fetching attendance:', error);
    return [];
  }
}

// Get employee info including hierarchy
export async function getTalioEmployee(employeeId: string): Promise<any> {
  try {
    const db = await getTalioDB();
    if (!db) return null;

    const employeesCollection = db.collection('employees');
    const employee = await employeesCollection.findOne({ 
      _id: new mongoose.Types.ObjectId(employeeId) 
    });

    if (employee) {
      // Get designation (field is 'title' not 'name')
      if (employee.designation) {
        const designationsCollection = db.collection('designations');
        const designation = await designationsCollection.findOne({ 
          _id: employee.designation 
        });
        employee.designationName = designation?.title || designation?.name;
      }

      // Get department
      if (employee.department) {
        const departmentsCollection = db.collection('departments');
        const department = await departmentsCollection.findOne({ 
          _id: employee.department 
        });
        employee.departmentName = department?.name;
      }

      // Get reporting manager
      if (employee.reportingManager) {
        const manager = await employeesCollection.findOne({ 
          _id: employee.reportingManager 
        });
        employee.reportingManagerName = manager?.firstName + ' ' + manager?.lastName;
      }
    }

    return employee;
  } catch (error) {
    console.error('[Talio] Error fetching employee:', error);
    return null;
  }
}

// Get subordinates (people who report to this employee)
export async function getSubordinates(employeeId: string): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const employeesCollection = db.collection('employees');
    const subordinates = await employeesCollection
      .find({ reportingManager: new mongoose.Types.ObjectId(employeeId) })
      .toArray();

    return subordinates;
  } catch (error) {
    console.error('[Talio] Error fetching subordinates:', error);
    return [];
  }
}

// Role hierarchy levels
const ROLE_HIERARCHY: Record<string, number> = {
  admin: 5,
  hr: 4,
  department_head: 3,
  manager: 2,
  employee: 1,
};

// Get all employees accessible by a user based on their role AND department head status
export async function getAccessibleEmployees(
  userId: string,
  employeeId: string,
  role: string,
  companyId: string,
  departmentId?: string,
  isDepartmentHead?: boolean,
  headOfDepartments?: string[]
): Promise<{
  employees: any[];
  accessLevel: string;
  accessDescription: string;
  effectiveRole: string;
}> {
  try {
    const db = await getTalioDB();
    if (!db) return { employees: [], accessLevel: 'none', accessDescription: 'No database connection', effectiveRole: role };

    const employeesCollection = db.collection('employees');
    const usersCollection = db.collection('users');
    const departmentsCollection = db.collection('departments');
    
    let employees: any[] = [];
    let accessLevel = 'self';
    let accessDescription = 'You can only view your own data';
    
    // Check user document for isDepartmentHead if not provided
    const user = await usersCollection.findOne({ _id: new mongoose.Types.ObjectId(userId) });
    const actualIsDepartmentHead = isDepartmentHead ?? user?.isDepartmentHead ?? false;
    const actualHeadOfDepartments = headOfDepartments ?? user?.headOfDepartments?.map((d: any) => d.toString()) ?? [];

    // Determine effective role - department head status can elevate access
    let effectiveRole = role;
    if (actualIsDepartmentHead && ROLE_HIERARCHY[role] < ROLE_HIERARCHY['department_head']) {
      effectiveRole = 'department_head';
    }

    const roleLevel = ROLE_HIERARCHY[effectiveRole] || 1;

    // Admin: Access to ALL employees in the company
    if (effectiveRole === 'admin' || roleLevel >= 5) {
      employees = await employeesCollection
        .find({ company: new mongoose.Types.ObjectId(companyId), status: 'active' })
        .toArray();
      accessLevel = 'company';
      accessDescription = 'Full access to all employees in the company';
    }
    // HR: Access to ALL employees in the company
    else if (effectiveRole === 'hr' || roleLevel >= 4) {
      employees = await employeesCollection
        .find({ company: new mongoose.Types.ObjectId(companyId), status: 'active' })
        .toArray();
      accessLevel = 'company';
      accessDescription = 'HR access to all employees in the company';
    }
    // Department Head (by role OR by isDepartmentHead flag): Access to all employees in their department(s)
    else if (effectiveRole === 'department_head' || actualIsDepartmentHead) {
      // Get departments they head
      const departmentIds: any[] = [...actualHeadOfDepartments];
      
      // Also include the employee's own department if they're in one
      if (departmentId && !departmentIds.includes(departmentId)) {
        departmentIds.push(departmentId);
      }
      
      // For managers who are also dept heads, include direct reports + department members
      let directReports: any[] = [];
      if (role === 'manager') {
        directReports = await employeesCollection
          .find({ 
            reportingManager: new mongoose.Types.ObjectId(employeeId),
            status: 'active'
          })
          .toArray();
      }
      
      if (departmentIds.length > 0) {
        const deptEmployees = await employeesCollection
          .find({ 
            company: new mongoose.Types.ObjectId(companyId),
            department: { $in: departmentIds.map((d: any) => 
              typeof d === 'string' ? new mongoose.Types.ObjectId(d) : d
            ) },
            status: 'active'
          })
          .toArray();
        
        // Merge with direct reports (remove duplicates)
        const employeeIds = new Set(deptEmployees.map(e => e._id.toString()));
        for (const dr of directReports) {
          if (!employeeIds.has(dr._id.toString())) {
            deptEmployees.push(dr);
          }
        }
        employees = deptEmployees;
        
        // Get department names
        const depts = await departmentsCollection
          .find({ _id: { $in: departmentIds.map((d: any) => 
            typeof d === 'string' ? new mongoose.Types.ObjectId(d) : d
          ) } })
          .toArray();
        const deptNames = depts.map((d: any) => d.name).join(', ');
        
        accessLevel = 'department';
        accessDescription = `Department head${role === 'manager' ? ' + Manager' : ''} access to: ${deptNames || 'your department'}`;
      } else if (directReports.length > 0) {
        employees = directReports;
        accessLevel = 'direct_reports';
        accessDescription = `Manager access to ${directReports.length} direct reports`;
      }
    }
    // Manager: Access to direct reports only
    else if (effectiveRole === 'manager' || roleLevel >= 2) {
      employees = await employeesCollection
        .find({ 
          reportingManager: new mongoose.Types.ObjectId(employeeId),
          status: 'active'
        })
        .toArray();
      accessLevel = 'direct_reports';
      accessDescription = `Manager access to ${employees.length} direct reports`;
    }
    // Employee: Only self (already handled by default)
    else {
      const selfEmployee = await employeesCollection.findOne({ 
        _id: new mongoose.Types.ObjectId(employeeId) 
      });
      employees = selfEmployee ? [selfEmployee] : [];
      accessLevel = 'self';
      accessDescription = 'You can only view your own data';
    }

    // Enrich employee data with department and designation names
    for (const emp of employees) {
      if (emp.department) {
        const dept = await departmentsCollection.findOne({ _id: emp.department });
        emp.departmentName = dept?.name || 'Unknown';
      }
      if (emp.designation) {
        const designationsCollection = db.collection('designations');
        const desig = await designationsCollection.findOne({ _id: emp.designation });
        emp.designationName = desig?.title || desig?.name || 'Unknown';
      }
    }

    console.log(`[Talio] Role ${effectiveRole} (isDeptHead: ${actualIsDepartmentHead}) has ${accessLevel} access to ${employees.length} employees`);
    return { employees, accessLevel, accessDescription, effectiveRole };
  } catch (error) {
    console.error('[Talio] Error getting accessible employees:', error);
    return { employees: [], accessLevel: 'error', accessDescription: 'Error fetching employees', effectiveRole: role };
  }
}

// Get company directory - BASIC INFO accessible to ALL users
// This includes names, emails, roles, designations - public info within the company
export async function getCompanyDirectory(companyId: string): Promise<{
  hr: any[];
  admins: any[];
  departmentHeads: any[];
  managers: any[];
  allEmployees: any[];
}> {
  try {
    const db = await getTalioDB();
    if (!db) return { hr: [], admins: [], departmentHeads: [], managers: [], allEmployees: [] };

    const usersCollection = db.collection('users');
    const employeesCollection = db.collection('employees');
    const departmentsCollection = db.collection('departments');
    const designationsCollection = db.collection('designations');

    // Get all active employees with their user info
    const employees = await employeesCollection
      .find({ 
        company: new mongoose.Types.ObjectId(companyId),
        status: 'active'
      })
      .toArray();

    // Enrich with user roles and department/designation names
    const enrichedEmployees = [];
    for (const emp of employees) {
      // Get user record for role info
      const user = await usersCollection.findOne({ employeeId: emp._id });
      
      // Get department name
      let departmentName = 'Unknown';
      if (emp.department) {
        const deptId = typeof emp.department === 'string' 
          ? new mongoose.Types.ObjectId(emp.department) 
          : emp.department;
        const dept = await departmentsCollection.findOne({ _id: deptId });
        departmentName = dept?.name || 'Unknown';
      }
      
      // Get designation name (field is 'title' not 'name')
      let designationName = 'Unknown';
      if (emp.designation) {
        const desigId = typeof emp.designation === 'string' 
          ? new mongoose.Types.ObjectId(emp.designation) 
          : emp.designation;
        const desig = await designationsCollection.findOne({ _id: desigId });
        designationName = desig?.title || desig?.name || 'Unknown';
      }

      enrichedEmployees.push({
        id: emp._id?.toString(),
        name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: emp.email,
        phone: emp.phone,
        role: user?.role || 'employee',
        isDepartmentHead: user?.isDepartmentHead || false,
        department: departmentName,
        designation: designationName,
      });
    }

    // Categorize by role
    const hr = enrichedEmployees.filter(e => e.role === 'hr');
    const admins = enrichedEmployees.filter(e => e.role === 'admin');
    const departmentHeads = enrichedEmployees.filter(e => e.isDepartmentHead);
    const managers = enrichedEmployees.filter(e => e.role === 'manager');

    return { hr, admins, departmentHeads, managers, allEmployees: enrichedEmployees };
  } catch (error) {
    console.error('[Talio] Error getting company directory:', error);
    return { hr: [], admins: [], departmentHeads: [], managers: [], allEmployees: [] };
  }
}

// Get leave balance for an employee
export async function getLeaveBalance(employeeId: string): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const leaveBalancesCollection = db.collection('leavebalances');
    const leaveTypesCollection = db.collection('leavetypes');
    
    const balances = await leaveBalancesCollection
      .find({ employee: new mongoose.Types.ObjectId(employeeId) })
      .toArray();

    // Enrich with leave type names
    for (const balance of balances) {
      if (balance.leaveType) {
        const leaveType = await leaveTypesCollection.findOne({ _id: balance.leaveType });
        balance.leaveTypeName = leaveType?.name || 'Unknown';
        balance.leaveTypeColor = leaveType?.color;
      }
    }

    return balances;
  } catch (error) {
    console.error('[Talio] Error fetching leave balance:', error);
    return [];
  }
}

// Get upcoming holidays
export async function getUpcomingHolidays(companyId: string, days = 90): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const holidaysCollection = db.collection('holidays');
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + days);

    const holidays = await holidaysCollection
      .find({
        company: new mongoose.Types.ObjectId(companyId),
        date: { $gte: today, $lte: futureDate }
      })
      .sort({ date: 1 })
      .toArray();

    return holidays;
  } catch (error) {
    console.error('[Talio] Error fetching holidays:', error);
    return [];
  }
}

// Get suggestions/ideas (idea sandbox)
export async function getSuggestions(employeeId: string, companyId: string, limit = 20): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const suggestionsCollection = db.collection('suggestions');
    const employeesCollection = db.collection('employees');
    
    // Get suggestions created by user OR visible to all
    const suggestions = await suggestionsCollection
      .find({
        $or: [
          { createdBy: new mongoose.Types.ObjectId(employeeId) },
          { company: new mongoose.Types.ObjectId(companyId) }
        ]
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    // Enrich with creator names
    for (const suggestion of suggestions) {
      if (suggestion.createdBy) {
        const creator = await employeesCollection.findOne({ _id: suggestion.createdBy });
        suggestion.createdByName = creator ? `${creator.firstName} ${creator.lastName || ''}`.trim() : 'Unknown';
      }
    }

    return suggestions;
  } catch (error) {
    console.error('[Talio] Error fetching suggestions:', error);
    return [];
  }
}

// Get pending leaves for an employee
export async function getPendingLeaves(employeeId: string): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const leavesCollection = db.collection('leaves');
    const leaveTypesCollection = db.collection('leavetypes');
    
    const leaves = await leavesCollection
      .find({ 
        employee: new mongoose.Types.ObjectId(employeeId),
        $or: [
          { status: 'pending' },
          { startDate: { $gte: new Date() } }
        ]
      })
      .sort({ startDate: 1 })
      .toArray();

    // Enrich with leave type names
    for (const leave of leaves) {
      if (leave.leaveType) {
        const leaveType = await leaveTypesCollection.findOne({ _id: leave.leaveType });
        leave.leaveTypeName = leaveType?.name || 'Unknown';
      }
    }

    return leaves;
  } catch (error) {
    console.error('[Talio] Error fetching leaves:', error);
    return [];
  }
}

// Get announcements
export async function getAnnouncements(companyId: string, limit = 10): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const announcementsCollection = db.collection('announcements');
    const employeesCollection = db.collection('employees');
    
    const announcements = await announcementsCollection
      .find({ company: new mongoose.Types.ObjectId(companyId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    // Enrich with creator names
    for (const announcement of announcements) {
      if (announcement.createdBy) {
        const creator = await employeesCollection.findOne({ _id: announcement.createdBy });
        announcement.createdByName = creator ? `${creator.firstName} ${creator.lastName || ''}`.trim() : 'Unknown';
      }
    }

    return announcements;
  } catch (error) {
    console.error('[Talio] Error fetching announcements:', error);
    return [];
  }
}

// Get meetings for an employee
export async function getMeetings(employeeId: string, days = 14): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const meetingsCollection = db.collection('meetings');
    const employeesCollection = db.collection('employees');
    
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + days);

    const meetings = await meetingsCollection
      .find({
        $or: [
          { organizer: new mongoose.Types.ObjectId(employeeId) },
          { participants: new mongoose.Types.ObjectId(employeeId) }
        ],
        startTime: { $gte: today, $lte: futureDate }
      })
      .sort({ startTime: 1 })
      .toArray();

    // Enrich with organizer and participant names
    for (const meeting of meetings) {
      if (meeting.organizer) {
        const organizer = await employeesCollection.findOne({ _id: meeting.organizer });
        meeting.organizerName = organizer ? `${organizer.firstName} ${organizer.lastName || ''}`.trim() : 'Unknown';
      }
      if (meeting.participants?.length) {
        const participants = await employeesCollection
          .find({ _id: { $in: meeting.participants } })
          .toArray();
        meeting.participantNames = participants.map(p => `${p.firstName} ${p.lastName || ''}`.trim());
      }
    }

    return meetings;
  } catch (error) {
    console.error('[Talio] Error fetching meetings:', error);
    return [];
  }
}

// Get daily goals (personal todos)
export async function getDailyGoals(employeeId: string): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const dailyGoalsCollection = db.collection('dailygoals');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const goals = await dailyGoalsCollection
      .find({ 
        employee: new mongoose.Types.ObjectId(employeeId),
        $or: [
          { date: { $gte: today } },
          { isCompleted: false }
        ]
      })
      .sort({ date: 1 })
      .toArray();

    return goals;
  } catch (error) {
    console.error('[Talio] Error fetching daily goals:', error);
    return [];
  }
}

// Get personal todos
export async function getPersonalTodos(employeeId: string): Promise<any[]> {
  try {
    const db = await getTalioDB();
    if (!db) return [];

    const personalTodosCollection = db.collection('personaltodos');
    const todoCategoriesCollection = db.collection('todocategories');
    
    const todos = await personalTodosCollection
      .find({ 
        user: new mongoose.Types.ObjectId(employeeId),
        isCompleted: { $ne: true }
      })
      .sort({ createdAt: -1 })
      .toArray();

    // Enrich with category names
    for (const todo of todos) {
      if (todo.category) {
        const category = await todoCategoriesCollection.findOne({ _id: todo.category });
        todo.categoryName = category?.name || 'Uncategorized';
      }
    }

    return todos;
  } catch (error) {
    console.error('[Talio] Error fetching personal todos:', error);
    return [];
  }
}

// Get tasks for accessible employees based on role
export async function getTeamTasks(
  userId: string,
  employeeId: string,
  role: string,
  companyId: string,
  departmentId?: string,
  isDepartmentHead?: boolean,
  headOfDepartments?: string[],
  limit = 50
): Promise<any[]> {
  try {
    const { employees, accessLevel } = await getAccessibleEmployees(
      userId, employeeId, role, companyId, departmentId, isDepartmentHead, headOfDepartments
    );
    
    if (employees.length === 0) return [];

    const db = await getTalioDB();
    if (!db) return [];

    const employeeIds = employees.map(e => e._id);
    
    // Get task assignments for these employees
    const taskAssigneesCollection = db.collection('taskassignees');
    const assignments = await taskAssigneesCollection
      .find({ user: { $in: employeeIds } })
      .toArray();
    
    const taskIds = assignments.map(a => a.task);
    
    // Get the tasks
    const tasksCollection = db.collection('tasks');
    const tasks = await tasksCollection
      .find({ 
        $or: [
          { _id: { $in: taskIds } },
          { createdBy: { $in: employeeIds } },
        ]
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();

    // Enrich with assignee names
    const employeesCollection = db.collection('employees');
    for (const task of tasks) {
      // Get assignees for this task
      const taskAssignees = assignments.filter(
        a => a.task?.toString() === task._id?.toString()
      );
      const assigneeIds = taskAssignees.map(a => a.user);
      const assigneeEmployees = await employeesCollection
        .find({ _id: { $in: assigneeIds } })
        .toArray();
      task.assigneeNames = assigneeEmployees.map(
        e => `${e.firstName} ${e.lastName || ''}`.trim()
      );
      
      // Get creator name
      if (task.createdBy) {
        const creator = await employeesCollection.findOne({ _id: task.createdBy });
        task.createdByName = creator ? `${creator.firstName} ${creator.lastName || ''}`.trim() : 'Unknown';
      }
    }

    console.log(`[Talio] Found ${tasks.length} team tasks for ${accessLevel} access`);
    return tasks;
  } catch (error) {
    console.error('[Talio] Error fetching team tasks:', error);
    return [];
  }
}

// Get attendance summary for accessible employees
export async function getTeamAttendance(
  userId: string,
  employeeId: string,
  role: string,
  companyId: string,
  departmentId?: string,
  isDepartmentHead?: boolean,
  headOfDepartments?: string[],
  days = 7
): Promise<{
  summary: { present: number; absent: number; late: number; leave: number };
  records: any[];
}> {
  try {
    const { employees, accessLevel } = await getAccessibleEmployees(
      userId, employeeId, role, companyId, departmentId, isDepartmentHead, headOfDepartments
    );
    
    if (employees.length === 0) {
      return { summary: { present: 0, absent: 0, late: 0, leave: 0 }, records: [] };
    }

    const db = await getTalioDB();
    if (!db) return { summary: { present: 0, absent: 0, late: 0, leave: 0 }, records: [] };

    const employeeIds = employees.map(e => e._id);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const attendanceCollection = db.collection('attendances');
    const records = await attendanceCollection
      .find({
        employee: { $in: employeeIds },
        date: { $gte: startDate }
      })
      .sort({ date: -1 })
      .toArray();

    // Calculate summary
    const summary = {
      present: records.filter(r => r.status === 'present').length,
      absent: records.filter(r => r.status === 'absent').length,
      late: records.filter(r => r.status === 'late' || r.checkInStatus === 'late').length,
      leave: records.filter(r => r.status === 'leave').length,
    };

    // Enrich with employee names
    for (const record of records) {
      const emp = employees.find(e => e._id?.toString() === record.employee?.toString());
      record.employeeName = emp ? `${emp.firstName} ${emp.lastName || ''}`.trim() : 'Unknown';
    }

    console.log(`[Talio] Found ${records.length} attendance records for ${accessLevel} access`);
    return { summary, records };
  } catch (error) {
    console.error('[Talio] Error fetching team attendance:', error);
    return { summary: { present: 0, absent: 0, late: 0, leave: 0 }, records: [] };
  }
}

// Create a task in Talio
export async function createTalioTask(userId: string, taskData: {
  title: string;
  description?: string;
  priority?: string;
  dueDate?: Date;
  projectId?: string;
}): Promise<any> {
  try {
    const db = await getTalioDB();
    if (!db) throw new Error('Talio DB not connected');

    const tasksCollection = db.collection('tasks');
    const result = await tasksCollection.insertOne({
      ...taskData,
      createdBy: new mongoose.Types.ObjectId(userId),
      status: 'todo',
      progressPercentage: 0,
      subtasks: [],
      tags: [],
      attachments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { success: true, taskId: result.insertedId.toString() };
  } catch (error) {
    console.error('[Talio] Error creating task:', error);
    throw error;
  }
}

// Update task status in Talio
export async function updateTalioTaskStatus(taskId: string, status: string): Promise<boolean> {
  try {
    const db = await getTalioDB();
    if (!db) return false;

    const tasksCollection = db.collection('tasks');
    const result = await tasksCollection.updateOne(
      { _id: new mongoose.Types.ObjectId(taskId) },
      { 
        $set: { 
          status,
          updatedAt: new Date()
        } 
      }
    );

    return result.modifiedCount > 0;
  } catch (error) {
    console.error('[Talio] Error updating task:', error);
    return false;
  }
}

// Get comprehensive Talio context for MIRA
export async function getTalioContext(email: string): Promise<{
  isConnected: boolean;
  userId?: string;
  employeeId?: string;
  companyId?: string;
  role?: string;
  isDepartmentHead?: boolean;
  headOfDepartments?: string[];
  effectiveRole?: string;
  roleLevel?: number;
  accessLevel?: string;
  accessDescription?: string;
  employee?: any;
  subordinates?: any[];
  teamMembers?: any[];
  tasks?: any[];
  teamTasks?: any[];
  projects?: any[];
  recentMessages?: any[];
  attendance?: any[];
  teamAttendance?: { summary: any; records: any[] };
  leaveBalance?: any[];
  upcomingHolidays?: any[];
  pendingLeaves?: any[];
  announcements?: any[];
  meetings?: any[];
  dailyGoals?: any[];
  personalTodos?: any[];
  suggestions?: any[];
  companyDirectory?: {
    hr: any[];
    admins: any[];
    departmentHeads: any[];
    managers: any[];
    allEmployees: any[];
  };
  summary?: string;
}> {
  const userCheck = await checkTalioUser(email);
  
  if (!userCheck.exists || !userCheck.userId) {
    console.log('[Talio] User not connected for email:', email);
    return { isConnected: false };
  }

  console.log('[Talio] Getting context for user:', userCheck.userId, 'employeeId:', userCheck.employeeId, 'role:', userCheck.role, 'isDepartmentHead:', userCheck.isDepartmentHead);

  // Get employee details first (needed for department)
  const employee = userCheck.employeeId ? await getTalioEmployee(userCheck.employeeId) : null;
  const departmentId = employee?.department?.toString();

  // Fetch basic data in parallel
  const [tasks, projects, messages, subordinates] = await Promise.all([
    getTalioTasks(userCheck.userId, userCheck.employeeId, 15),
    getTalioProjects(userCheck.userId, userCheck.companyId, userCheck.employeeId, 10),
    getTalioMessages(userCheck.userId, 20),
    userCheck.employeeId ? getSubordinates(userCheck.employeeId) : Promise.resolve([]),
  ]);

  // Get role-based team access (with department head info)
  const { employees: teamMembers, accessLevel, accessDescription, effectiveRole } = userCheck.employeeId && userCheck.companyId
    ? await getAccessibleEmployees(
        userCheck.userId,
        userCheck.employeeId,
        userCheck.role || 'employee',
        userCheck.companyId,
        departmentId,
        userCheck.isDepartmentHead,
        userCheck.headOfDepartments
      )
    : { employees: [], accessLevel: 'none', accessDescription: 'No access', effectiveRole: userCheck.role || 'employee' };

  // Get team tasks if user has team access
  const teamTasks = (accessLevel !== 'self' && accessLevel !== 'none' && userCheck.employeeId && userCheck.companyId)
    ? await getTeamTasks(
        userCheck.userId,
        userCheck.employeeId,
        userCheck.role || 'employee',
        userCheck.companyId,
        departmentId,
        userCheck.isDepartmentHead,
        userCheck.headOfDepartments,
        30
      )
    : [];

  // Get team attendance if user has team access
  const teamAttendance = (accessLevel !== 'self' && accessLevel !== 'none' && userCheck.employeeId && userCheck.companyId)
    ? await getTeamAttendance(
        userCheck.userId,
        userCheck.employeeId,
        userCheck.role || 'employee',
        userCheck.companyId,
        departmentId,
        userCheck.isDepartmentHead,
        userCheck.headOfDepartments,
        7
      )
    : { summary: { present: 0, absent: 0, late: 0, leave: 0 }, records: [] };

  // Fetch additional data in parallel
  const [leaveBalance, upcomingHolidays, pendingLeaves, announcements, meetings, dailyGoals, personalTodos, suggestions, attendance, companyDirectory] = await Promise.all([
    userCheck.employeeId ? getLeaveBalance(userCheck.employeeId) : Promise.resolve([]),
    userCheck.companyId ? getUpcomingHolidays(userCheck.companyId, 90) : Promise.resolve([]),
    userCheck.employeeId ? getPendingLeaves(userCheck.employeeId) : Promise.resolve([]),
    userCheck.companyId ? getAnnouncements(userCheck.companyId, 10) : Promise.resolve([]),
    userCheck.employeeId ? getMeetings(userCheck.employeeId, 14) : Promise.resolve([]),
    userCheck.employeeId ? getDailyGoals(userCheck.employeeId) : Promise.resolve([]),
    userCheck.employeeId ? getPersonalTodos(userCheck.employeeId) : Promise.resolve([]),
    (userCheck.employeeId && userCheck.companyId) ? getSuggestions(userCheck.employeeId, userCheck.companyId, 10) : Promise.resolve([]),
    userCheck.employeeId ? getTalioAttendance(userCheck.employeeId, 7) : Promise.resolve([]),
    userCheck.companyId ? getCompanyDirectory(userCheck.companyId) : Promise.resolve({ hr: [], admins: [], departmentHeads: [], managers: [], allEmployees: [] }),
  ]);

  // Get role level
  const roleLevel = ROLE_HIERARCHY[effectiveRole] || 1;

  // Create a comprehensive summary for MIRA
  const todoTasks = tasks.filter(t => t.status === 'todo');
  const inProgressTasks = tasks.filter(t => t.status === 'in-progress');
  const completedTasks = tasks.filter(t => t.status === 'completed' || t.status === 'done');
  
  const teamTasksTodo = teamTasks.filter(t => t.status === 'todo');
  const teamTasksInProgress = teamTasks.filter(t => t.status === 'in-progress');
  
  // Build role summary based on effective role (considering isDepartmentHead)
  let roleSummary = '';
  const isDeptHead = userCheck.isDepartmentHead || effectiveRole === 'department_head';
  
  if (effectiveRole === 'admin') {
    roleSummary = `ADMIN ACCESS: Full access to all ${teamMembers.length} employees in the company. Can view and manage all tasks, attendance, and employee data.`;
  } else if (effectiveRole === 'hr') {
    roleSummary = `HR ACCESS: Full access to all ${teamMembers.length} employees in the company. Can view attendance, leave records, and employee information.`;
  } else if (isDeptHead && userCheck.role === 'manager') {
    roleSummary = `MANAGER + DEPARTMENT HEAD ACCESS: Access to ${teamMembers.length} employees (department members + ${subordinates.length} direct reports). Can view team tasks and attendance.`;
  } else if (isDeptHead) {
    roleSummary = `DEPARTMENT HEAD ACCESS: Access to ${teamMembers.length} employees in your department(s). Can view team tasks and attendance.`;
  } else if (effectiveRole === 'manager') {
    roleSummary = `MANAGER ACCESS: Access to ${subordinates.length} direct reports. Can view and assign tasks, check attendance.`;
  } else {
    roleSummary = `EMPLOYEE ACCESS: Can view your own tasks, attendance, and projects.`;
  }

  // Leave balance summary
  const leaveBalanceSummary = leaveBalance.map(lb => 
    `${lb.leaveTypeName || 'Leave'}: ${lb.balance || 0} days`
  ).join(', ');

  // Holiday summary
  const nextHoliday = upcomingHolidays[0];
  const holidaySummary = nextHoliday 
    ? `Next holiday: ${nextHoliday.name} on ${new Date(nextHoliday.date).toLocaleDateString()}`
    : 'No upcoming holidays';

  const summary = `
USER PROFILE & ACCESS LEVEL:
Employee: ${employee?.firstName || ''} ${employee?.lastName || ''} (${employee?.designationName || 'N/A'})
Department: ${employee?.departmentName || 'N/A'}
Role: ${userCheck.role || 'employee'}${isDeptHead ? ' + Department Head' : ''} (Effective Level ${roleLevel}/5)
${roleSummary}

YOUR TASKS:
- To-do: ${todoTasks.length}
- In-progress: ${inProgressTasks.length}  
- Completed: ${completedTasks.length}

${accessLevel !== 'self' ? `TEAM OVERVIEW (${accessDescription}):
- Team Members: ${teamMembers.length}
- Team Tasks Pending: ${teamTasksTodo.length}
- Team Tasks In Progress: ${teamTasksInProgress.length}
- Team Attendance (Last 7 days): ${teamAttendance.summary.present} present, ${teamAttendance.summary.absent} absent, ${teamAttendance.summary.late} late` : ''}

LEAVE & TIME OFF:
- Leave Balance: ${leaveBalanceSummary || 'No leave data'}
- Pending Leave Requests: ${pendingLeaves.length}
- ${holidaySummary}

UPCOMING:
- Meetings: ${meetings.length} in next 2 weeks
- Personal Todos: ${personalTodos.length} pending
- Daily Goals: ${dailyGoals.length}

OTHER:
- Projects: ${projects.length} active
- Announcements: ${announcements.length} recent
- Suggestions/Ideas: ${suggestions.length}
  `.trim();

  console.log('[Talio] Context summary:', summary);

  return {
    isConnected: true,
    userId: userCheck.userId,
    employeeId: userCheck.employeeId,
    companyId: userCheck.companyId,
    role: userCheck.role,
    isDepartmentHead: userCheck.isDepartmentHead,
    headOfDepartments: userCheck.headOfDepartments,
    effectiveRole,
    roleLevel,
    accessLevel,
    accessDescription,
    employee,
    subordinates,
    teamMembers,
    tasks,
    teamTasks,
    projects,
    recentMessages: messages,
    attendance,
    teamAttendance,
    leaveBalance,
    upcomingHolidays,
    pendingLeaves,
    announcements,
    meetings,
    dailyGoals,
    personalTodos,
    suggestions,
    companyDirectory,
    summary,
  };
}

export default connectToTalioDB;
