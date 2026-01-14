import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { Reminder } from '@/models';
import { verifyToken } from '@/lib/auth';
import mongoose from 'mongoose';

// GET - Fetch user's reminders
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No token provided' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const upcoming = searchParams.get('upcoming');
    const overdue = searchParams.get('overdue');

    // Build query
    const query: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(decoded.userId),
    };

    if (status && status !== 'all') {
      query.status = status;
    } else if (!status) {
      // Default: show non-completed reminders
      query.status = { $ne: 'completed' };
    }

    if (priority) {
      query.priority = priority;
    }

    // Upcoming reminders (next 24 hours)
    if (upcoming === 'true') {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      query.dueDate = { $gte: now, $lte: tomorrow };
    }

    // Overdue reminders
    if (overdue === 'true') {
      query.dueDate = { $lt: new Date() };
      query.status = { $nin: ['completed'] };
    }

    const reminders = await Reminder.find(query)
      .sort({ dueDate: 1, priority: -1 })
      .lean();

    // Auto-update overdue status
    const now = new Date();
    const updatedReminders = reminders.map((r: Record<string, unknown>) => {
      if (r.status !== 'completed' && r.dueDate && new Date(r.dueDate as string) < now) {
        return { ...r, status: 'overdue' };
      }
      return r;
    });

    return NextResponse.json({ reminders: updatedReminders });
  } catch (error) {
    console.error('[Reminders] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch reminders' }, { status: 500 });
  }
}

// POST - Create a new reminder
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No token provided' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const body = await req.json();
    const { title, description, dueDate, reminderTime, priority, category, tags, source, recurrence } = body;

    if (!title || !dueDate) {
      return NextResponse.json({ error: 'Title and due date are required' }, { status: 400 });
    }

    await connectToDatabase();

    const reminder = new Reminder({
      userId: new mongoose.Types.ObjectId(decoded.userId),
      title,
      description,
      dueDate: new Date(dueDate),
      reminderTime: reminderTime ? new Date(reminderTime) : undefined,
      priority: priority || 'medium',
      category,
      tags: tags || [],
      source: source || 'user',
      recurrence: recurrence || { type: 'none', interval: 1 },
      notifications: { enabled: true, snoozeCount: 0 },
    });

    await reminder.save();

    return NextResponse.json({ 
      success: true, 
      reminder,
      message: 'Reminder created successfully'
    });
  } catch (error) {
    console.error('[Reminders] POST error:', error);
    return NextResponse.json({ error: 'Failed to create reminder' }, { status: 500 });
  }
}

// PATCH - Update a reminder
export async function PATCH(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No token provided' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Reminder ID is required' }, { status: 400 });
    }

    await connectToDatabase();

    // Handle special updates
    if (updates.status === 'completed') {
      updates.completedAt = new Date();
    }

    if (updates.snooze) {
      const snoozeMinutes = updates.snooze;
      delete updates.snooze;
      updates.$inc = { 'notifications.snoozeCount': 1 };
      updates['notifications.lastSnoozed'] = new Date();
      updates.dueDate = new Date(Date.now() + snoozeMinutes * 60 * 1000);
      updates.status = 'snoozed';
    }

    const reminder = await Reminder.findOneAndUpdate(
      { 
        _id: new mongoose.Types.ObjectId(id),
        userId: new mongoose.Types.ObjectId(decoded.userId),
      },
      updates,
      { new: true }
    );

    if (!reminder) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, reminder });
  } catch (error) {
    console.error('[Reminders] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update reminder' }, { status: 500 });
  }
}

// DELETE - Delete a reminder
export async function DELETE(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No token provided' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Reminder ID is required' }, { status: 400 });
    }

    await connectToDatabase();

    const result = await Reminder.deleteOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(decoded.userId),
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Reminder deleted' });
  } catch (error) {
    console.error('[Reminders] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete reminder' }, { status: 500 });
  }
}
