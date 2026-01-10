import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/models/User';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromHeader(request.headers.get('authorization'));
    
    if (!token) {
      console.log('[Auth/Me] No token provided');
      return NextResponse.json(
        { error: 'No token provided' },
        { status: 401 }
      );
    }
    
    const payload = verifyToken(token);
    if (!payload) {
      console.log('[Auth/Me] Invalid token');
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }
    
    await connectToDatabase();
    
    const user = await User.findById(payload.userId).select('-password');
    if (!user) {
      console.log('[Auth/Me] User not found for ID:', payload.userId);
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }
    
    console.log('[Auth/Me] Session valid for:', user.email);
    
    return NextResponse.json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        preferences: user.preferences,
        talioIntegration: user.talioIntegration || null,
        lastActive: user.lastActive,
      },
    });
    
  } catch (error) {
    console.error('[Auth/Me] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
