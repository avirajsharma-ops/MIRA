import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { MIRAAgent, ContextEngine } from '@/lib/agents';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import User from '@/models/User';

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

    const { visualContext, lastActivityTime } = await request.json();

    // Get user preferences
    const user = await User.findById(payload.userId);
    if (!user?.preferences.autoInitiate) {
      return NextResponse.json({ shouldSpeak: false });
    }

    // Get context
    const contextEngine = new ContextEngine(payload.userId);
    const memories = await contextEngine.getAllMemoriesForContext();

    // Build agent context
    const agentContext = {
      memories,
      recentMessages: [],
      visualContext: visualContext || undefined,
      currentTime: new Date(),
      userName: payload.name,
      userId: payload.userId, // For face recognition
    };

    const agent = new MIRAAgent(agentContext);

    // Check if AI should proactively speak
    const lastActivity = new Date(lastActivityTime || Date.now() - 120000);
    const result = await agent.generateProactiveMessage(lastActivity);

    if (result.shouldSpeak && result.message) {
      return NextResponse.json({
        shouldSpeak: true,
        message: result.message,
        agent: result.agent || 'mi',
      });
    }

    return NextResponse.json({ shouldSpeak: false });
  } catch (error) {
    console.error('Proactive check error:', error);
    return NextResponse.json({ shouldSpeak: false });
  }
}
