import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import { getTalioContext, createTalioTask, updateTalioTaskStatus, getTalioTasks, getTalioProjects } from '@/lib/talio-db';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/models/User';

// GET - Get Talio context for the logged-in user
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromHeader(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await connectToDatabase();
    const user = await User.findById(payload.userId);
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const talioContext = await getTalioContext(user.email);

    return NextResponse.json({
      connected: talioContext.isConnected,
      ...talioContext,
    });
  } catch (error) {
    console.error('[Talio API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Perform actions on Talio (create task, update status, etc.)
export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromHeader(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await connectToDatabase();
    const user = await User.findById(payload.userId);
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { action, data } = await request.json();

    // Check if user is connected to Talio
    const talioContext = await getTalioContext(user.email);
    if (!talioContext.isConnected || !talioContext.userId) {
      return NextResponse.json(
        { error: 'User not connected to Talio workspace' },
        { status: 403 }
      );
    }

    switch (action) {
      case 'createTask': {
        const result = await createTalioTask(talioContext.userId, {
          title: data.title,
          description: data.description,
          priority: data.priority,
          dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
          projectId: data.projectId,
        });
        return NextResponse.json({ success: true, result });
      }

      case 'updateTaskStatus': {
        const success = await updateTalioTaskStatus(data.taskId, data.status);
        return NextResponse.json({ success });
      }

      case 'getTasks': {
        const tasks = await getTalioTasks(talioContext.userId, talioContext.employeeId, data.limit || 20);
        return NextResponse.json({ tasks });
      }

      case 'getProjects': {
        const projects = await getTalioProjects(
          talioContext.userId,
          talioContext.companyId,
          talioContext.employeeId,
          data.limit || 20
        );
        return NextResponse.json({ projects });
      }

      default:
        return NextResponse.json(
          { error: 'Unknown action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[Talio API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
