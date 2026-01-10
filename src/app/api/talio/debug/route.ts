import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/models/User';
import { getTalioDB, checkTalioUser } from '@/lib/talio-db';
import mongoose from 'mongoose';

// Debug endpoint to investigate Talio task fetching issues
// Accepts email as query parameter for testing: /api/talio/debug?email=user@example.com
export async function GET(request: NextRequest) {
  try {
    // Allow query param for testing
    const url = new URL(request.url);
    const emailParam = url.searchParams.get('email');
    
    let email = emailParam;
    
    // If no email param, try auth token
    if (!email) {
      const token = getTokenFromHeader(request.headers.get('authorization'));
      if (token) {
        const payload = verifyToken(token);
        if (payload) {
          await connectToDatabase();
          const user = await User.findById(payload.userId);
          if (user) {
            email = user.email;
          }
        }
      }
    }

    if (!email) {
      return NextResponse.json({ 
        error: 'Provide email as query param: /api/talio/debug?email=your@email.com' 
      }, { status: 400 });
    }

    const debug: any = {
      miraUserEmail: email,
      timestamp: new Date().toISOString(),
    };

    // Step 1: Check Talio user lookup
    const userCheck = await checkTalioUser(email);
    debug.talioUserCheck = userCheck;

    if (!userCheck.exists || !userCheck.userId) {
      return NextResponse.json({
        ...debug,
        error: 'User not found in Talio database',
      });
    }

    // Step 2: Get direct DB access for debugging
    const db = await getTalioDB();
    if (!db) {
      return NextResponse.json({
        ...debug,
        error: 'Could not connect to Talio database',
      });
    }

    // Step 3: List all collections
    const collections = await db.listCollections().toArray();
    debug.availableCollections = collections.map((c: any) => c.name);

    // Step 4: Examine the users collection for this email
    const usersCollection = db.collection('users');
    const talioUser = await usersCollection.findOne({
      $or: [
        { email: email },
        { email: email.toLowerCase() },
      ]
    });
    debug.talioUserDocument = talioUser ? {
      _id: talioUser._id?.toString(),
      email: talioUser.email,
      employeeId: talioUser.employeeId?.toString(),
      name: talioUser.firstName + ' ' + talioUser.lastName,
      role: talioUser.role,
      company: talioUser.company?.toString(),
    } : null;

    // Step 5: Check if there's an employees collection entry
    if (talioUser?.employeeId) {
      const employeesCollection = db.collection('employees');
      const employee = await employeesCollection.findOne({
        _id: talioUser.employeeId
      });
      debug.employeeDocument = employee ? {
        _id: employee._id?.toString(),
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        department: employee.department?.toString(),
        designation: employee.designation?.toString(),
        company: employee.company?.toString(),
      } : null;
      
      // Debug: Check designation lookup
      if (employee?.designation) {
        const designationsCollection = db.collection('designations');
        const designation = await designationsCollection.findOne({
          _id: employee.designation
        });
        debug.designationLookup = {
          designationId: employee.designation?.toString(),
          found: !!designation,
          name: designation?.name || 'Not found',
          rawDocument: designation,
        };
      }
    }

    // Step 6: Check taskassignees with BOTH userId and employeeId
    // NOTE: taskassignees collection uses 'user' field (not 'assignee') which stores employeeId
    const taskAssigneesCollection = db.collection('taskassignees');
    
    // Try with userId
    const userObjectId = new mongoose.Types.ObjectId(userCheck.userId);
    const assignmentsWithUserId = await taskAssigneesCollection
      .find({ user: userObjectId })
      .limit(10)
      .toArray();
    debug.taskAssigneesWithUserId = {
      count: assignmentsWithUserId.length,
      sample: assignmentsWithUserId.slice(0, 3).map((a: any) => ({
        _id: a._id?.toString(),
        task: a.task?.toString(),
        user: a.user?.toString(),
        assignedBy: a.assignedBy?.toString(),
        assignmentStatus: a.assignmentStatus,
      })),
    };

    // Try with employeeId (this is likely the correct one)
    if (userCheck.employeeId) {
      const employeeObjectId = new mongoose.Types.ObjectId(userCheck.employeeId);
      const assignmentsWithEmployeeId = await taskAssigneesCollection
        .find({ user: employeeObjectId })
        .limit(10)
        .toArray();
      debug.taskAssigneesWithEmployeeId = {
        count: assignmentsWithEmployeeId.length,
        sample: assignmentsWithEmployeeId.slice(0, 3).map((a: any) => ({
          _id: a._id?.toString(),
          task: a.task?.toString(),
          user: a.user?.toString(),
          assignedBy: a.assignedBy?.toString(),
          assignmentStatus: a.assignmentStatus,
        })),
      };
    }

    // Step 7: Sample taskassignees to see what assignee format looks like
    const sampleAssignees = await taskAssigneesCollection.find({}).limit(5).toArray();
    debug.sampleTaskAssignees = sampleAssignees.map((a: any) => ({
      _id: a._id?.toString(),
      task: a.task?.toString(),
      assignee: a.assignee?.toString?.() || JSON.stringify(a.assignee),
      assigneeRaw: a.assignee,
      assigneeType: typeof a.assignee,
      allKeys: Object.keys(a),
    }));

    // Step 8: Check tasks collection directly
    const tasksCollection = db.collection('tasks');
    const totalTasks = await tasksCollection.countDocuments({});
    debug.totalTasksInCollection = totalTasks;

    // Find tasks where user is creator or assignedBy
    const tasksAsCreator = await tasksCollection
      .find({ createdBy: userObjectId })
      .limit(5)
      .toArray();
    debug.tasksCreatedByUser = {
      count: tasksAsCreator.length,
      sample: tasksAsCreator.slice(0, 3).map((t: any) => ({
        _id: t._id?.toString(),
        title: t.title,
        status: t.status,
        createdBy: t.createdBy?.toString(),
      })),
    };

    // Step 9: Check if tasks have assignees embedded
    const tasksWithAssignees = await tasksCollection.find({
      $or: [
        { assignees: { $exists: true, $ne: [] } },
        { assignee: { $exists: true } },
      ]
    }).limit(5).toArray();
    debug.tasksWithEmbeddedAssignees = tasksWithAssignees.map((t: any) => ({
      _id: t._id?.toString(),
      title: t.title,
      assignees: t.assignees?.map((a: any) => a?.toString?.() || a),
      assignee: t.assignee?.toString?.() || t.assignee,
    }));

    // Step 10: Check projects
    const projectsCollection = db.collection('projects');
    const projectMembersCollection = db.collection('projectmembers');
    
    const totalProjects = await projectsCollection.countDocuments({});
    debug.totalProjectsInCollection = totalProjects;

    // Check project members with both userId and employeeId
    const projectMembersWithUserId = await projectMembersCollection
      .find({ 
        $or: [
          { user: userObjectId },
          { employee: userObjectId },
        ]
      })
      .limit(5)
      .toArray();
    debug.projectMembersWithUserId = {
      count: projectMembersWithUserId.length,
      sample: projectMembersWithUserId.map((p: any) => ({
        _id: p._id?.toString(),
        project: p.project?.toString(),
        user: p.user?.toString(),
        employee: p.employee?.toString(),
      })),
    };

    if (userCheck.employeeId) {
      const employeeObjectId = new mongoose.Types.ObjectId(userCheck.employeeId);
      const projectMembersWithEmployeeId = await projectMembersCollection
        .find({ 
          $or: [
            { user: employeeObjectId },
            { employee: employeeObjectId },
          ]
        })
        .limit(5)
        .toArray();
      debug.projectMembersWithEmployeeId = {
        count: projectMembersWithEmployeeId.length,
        sample: projectMembersWithEmployeeId.map((p: any) => ({
          _id: p._id?.toString(),
          project: p.project?.toString(),
          user: p.user?.toString(),
          employee: p.employee?.toString(),
        })),
      };
    }

    // Step 11: Test the actual getTalioTasks function
    const { getTalioTasks, getTalioProjects, getAccessibleEmployees, getTeamTasks, getTalioContext } = await import('@/lib/talio-db');
    const actualTasks = await getTalioTasks(userCheck.userId, userCheck.employeeId, 20);
    const actualProjects = await getTalioProjects(userCheck.userId, userCheck.companyId, userCheck.employeeId, 20);
    
    // Step 12: Test role-based access
    const departmentId = debug.employeeDocument?.department;
    const accessibleEmployees = await getAccessibleEmployees(
      userCheck.userId,
      userCheck.employeeId!,
      userCheck.role || 'employee',
      userCheck.companyId!,
      departmentId
    );
    
    debug.roleBasedAccess = {
      role: userCheck.role,
      accessLevel: accessibleEmployees.accessLevel,
      accessDescription: accessibleEmployees.accessDescription,
      teamMemberCount: accessibleEmployees.employees.length,
      teamMembers: accessibleEmployees.employees.slice(0, 10).map((e: any) => ({
        name: `${e.firstName} ${e.lastName || ''}`.trim(),
        designation: e.designationName,
        department: e.departmentName,
      })),
    };
    
    // Step 13: Test team tasks
    const teamTasks = await getTeamTasks(
      userCheck.userId,
      userCheck.employeeId!,
      userCheck.role || 'employee',
      userCheck.companyId!,
      departmentId,
      20
    );
    
    debug.teamTasks = {
      count: teamTasks.length,
      tasks: teamTasks.slice(0, 5).map((t: any) => ({
        title: t.title,
        status: t.status,
        assignees: t.assigneeNames,
        createdBy: t.createdByName,
      })),
    };
    
    // Step 14: Get full context
    const fullContext = await getTalioContext(email);
    debug.fullContextSummary = fullContext.summary;
    
    debug.actualTasksFetched = {
      count: actualTasks.length,
      tasks: actualTasks.map((t: any) => ({
        _id: t._id?.toString(),
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignedByName: t.assignedByName || 'Unknown',
        assignedByEmployeeId: t.assignedByEmployeeId?.toString(),
        createdByName: t.createdByName || 'Unknown',
        projectName: t.projectName,
      })),
    };
    
    // Include new data from context
    debug.additionalContextData = {
      leaveBalance: fullContext.leaveBalance?.map((lb: any) => ({
        leaveType: lb.leaveTypeName,
        balance: lb.balance,
      })),
      upcomingHolidays: fullContext.upcomingHolidays?.slice(0, 3).map((h: any) => ({
        name: h.name,
        date: h.date,
      })),
      meetings: fullContext.meetings?.slice(0, 3).map((m: any) => ({
        title: m.title,
        startTime: m.startTime,
      })),
      announcements: fullContext.announcements?.slice(0, 3).map((a: any) => ({
        title: a.title,
        createdAt: a.createdAt,
      })),
      dailyGoals: fullContext.dailyGoals?.length,
      personalTodos: fullContext.personalTodos?.length,
      suggestions: fullContext.suggestions?.length,
    };
    
    // Company directory (PUBLIC info - accessible to all)
    debug.companyDirectory = {
      hr: fullContext.companyDirectory?.hr?.map((h: any) => ({
        name: h.name,
        email: h.email,
        designation: h.designation,
      })),
      admins: fullContext.companyDirectory?.admins?.map((a: any) => ({
        name: a.name,
        email: a.email,
      })),
      departmentHeads: fullContext.companyDirectory?.departmentHeads?.map((dh: any) => ({
        name: dh.name,
        department: dh.department,
        designation: dh.designation,
      })),
      totalEmployees: fullContext.companyDirectory?.allEmployees?.length,
    };
    
    debug.actualProjectsFetched = {
      count: actualProjects.length,
      projects: actualProjects.map((p: any) => ({
        _id: p._id?.toString(),
        name: p.name,
        status: p.status,
        progress: p.progress,
      })),
    };

    return NextResponse.json(debug);
  } catch (error) {
    console.error('[Talio Debug] Error:', error);
    return NextResponse.json(
      { error: 'Debug error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
