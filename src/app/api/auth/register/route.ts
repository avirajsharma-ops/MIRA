import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase, dropCollections } from '@/lib/mongodb';
import User from '@/models/User';
import { hashPassword, generateToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    
    const { email, password, name, dropExisting } = await request.json();
    
    // Option to drop existing collections for fresh start
    if (dropExisting) {
      await dropCollections();
    }
    
    // Validation
    if (!email || !password || !name) {
      return NextResponse.json(
        { error: 'Email, password, and name are required' },
        { status: 400 }
      );
    }
    
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }
    
    // Check if user exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return NextResponse.json(
        { error: 'User already exists with this email' },
        { status: 409 }
      );
    }
    
    // Create user
    const hashedPassword = await hashPassword(password);
    const user = await User.create({
      email: email.toLowerCase(),
      password: hashedPassword,
      name,
      preferences: {
        miPersonality: 50,
        raPersonality: 50,
        voiceEnabled: true,
        autoInitiate: true,
      },
    });
    
    // Generate token
    const token = generateToken(user);
    
    return NextResponse.json({
      message: 'User created successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        preferences: user.preferences,
      },
      token,
    }, { status: 201 });
    
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
