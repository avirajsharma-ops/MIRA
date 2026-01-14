import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { PhoneCall, Reminder } from '@/models';
import { verifyToken } from '@/lib/auth';
import mongoose from 'mongoose';

// GET - Fetch phone calls (especially dropped/missed ones for follow-up)
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
    const needsFollowUp = searchParams.get('needsFollowUp');

    const query: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(decoded.userId),
    };

    if (status) {
      query.status = status;
    }

    // Get calls that need follow-up (dropped/missed without follow-up reminder)
    if (needsFollowUp === 'true') {
      query.status = { $in: ['dropped', 'missed'] };
      query.followUpCreated = false;
    }

    const calls = await PhoneCall.find(query)
      .sort({ detectedAt: -1 })
      .limit(50)
      .lean();

    return NextResponse.json({ calls });
  } catch (error) {
    console.error('[PhoneCalls] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch phone calls' }, { status: 500 });
  }
}

// POST - Log a phone call detection
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
    const { status, conversationHeard, conversationSummary, callerInfo, notes } = body;

    await connectToDatabase();

    const phoneCall = new PhoneCall({
      userId: new mongoose.Types.ObjectId(decoded.userId),
      detectedAt: new Date(),
      status: status || 'ringing',
      conversationHeard: conversationHeard || false,
      conversationSummary,
      callerInfo,
      notes,
    });

    await phoneCall.save();

    return NextResponse.json({ 
      success: true, 
      phoneCall,
      callId: phoneCall._id.toString()
    });
  } catch (error) {
    console.error('[PhoneCalls] POST error:', error);
    return NextResponse.json({ error: 'Failed to log phone call' }, { status: 500 });
  }
}

// PATCH - Update phone call status (e.g., answered, ended, dropped)
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
    const { id, status, duration, conversationSummary, callerInfo, createFollowUp, notes } = body;

    if (!id) {
      return NextResponse.json({ error: 'Phone call ID is required' }, { status: 400 });
    }

    await connectToDatabase();

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (duration !== undefined) updates.duration = duration;
    if (conversationSummary) updates.conversationSummary = conversationSummary;
    if (callerInfo) updates.callerInfo = callerInfo;
    if (notes) updates.notes = notes;

    // Create follow-up reminder for dropped/missed calls
    if (createFollowUp && (status === 'dropped' || status === 'missed')) {
      const reminder = new Reminder({
        userId: new mongoose.Types.ObjectId(decoded.userId),
        title: `Follow up: ${status === 'dropped' ? 'Dropped call' : 'Missed call'}${callerInfo ? ` from ${callerInfo}` : ''}`,
        description: `Phone call ${status} at ${new Date().toLocaleString()}. ${notes || 'Remember to follow up.'}`,
        dueDate: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes from now
        priority: 'high',
        source: 'phone_call',
        relatedContext: {
          phoneCallId: id,
        },
        notifications: { enabled: true, snoozeCount: 0 },
      });

      await reminder.save();
      updates.followUpCreated = true;
      updates.followUpReminderId = reminder._id;
    }

    const phoneCall = await PhoneCall.findOneAndUpdate(
      { 
        _id: new mongoose.Types.ObjectId(id),
        userId: new mongoose.Types.ObjectId(decoded.userId),
      },
      updates,
      { new: true }
    );

    if (!phoneCall) {
      return NextResponse.json({ error: 'Phone call not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, phoneCall });
  } catch (error) {
    console.error('[PhoneCalls] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update phone call' }, { status: 500 });
  }
}
