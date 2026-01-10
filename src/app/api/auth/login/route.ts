import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/models/User';
import { verifyPassword, generateToken } from '@/lib/auth';
import { getTalioUserInfo, authenticateTalioUser } from '@/lib/talio';

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    
    const { email, password } = await request.json();
    
    // Validation
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }
    
    // Find user in MIRA database
    let user = await User.findOne({ email: email.toLowerCase() });
    
    // Cross-validate with Talio HRMS
    let talioProfile: any = null;
    let talioAuthenticated = false; // Track if user authenticated via Talio
    
    try {
      // First try to authenticate with Talio (this validates the password)
      const talioValidation = await authenticateTalioUser(email.toLowerCase(), password);
      
      if (talioValidation.success && talioValidation.user && talioValidation.tenant) {
        talioAuthenticated = true;
        talioProfile = {
          user: talioValidation.user,
          employee: talioValidation.employee,
          tenant: talioValidation.tenant,
        };
        
        console.log('[Login] Talio authentication successful for:', email);
        
        // If user doesn't exist in MIRA but authenticated via Talio, create account
        if (!user) {
          user = new User({
            email: email.toLowerCase(),
            password: password, // Will be hashed by pre-save hook
            name: talioProfile.employee?.firstName 
              ? `${talioProfile.employee.firstName} ${talioProfile.employee.lastName || ''}`.trim()
              : email.split('@')[0],
            preferences: {
              language: 'en',
              theme: 'dark',
              voiceSpeed: 'normal',
            },
            talioIntegration: {
              enabled: true,
              tenantId: talioProfile.tenant.databaseName,
              userId: talioProfile.user._id.toString(),
              employeeId: talioProfile.employee?._id?.toString(),
              role: talioProfile.user.role || 'employee',
              department: talioProfile.employee?.department?.toString(),
              lastSync: new Date(),
            },
          });
          await user.save();
          console.log('[Login] Auto-created MIRA account for Talio user:', email);
        }
      } else if (talioValidation.message) {
        console.log('[Login] Talio auth failed:', talioValidation.message);
      }
    } catch (talioError) {
      console.log('[Login] Talio cross-validation error:', talioError);
      // Continue with normal MIRA login
    }
    
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }
    
    // If NOT authenticated via Talio, verify password against MIRA database
    if (!talioAuthenticated) {
      const isValid = await verifyPassword(password, user.password);
      if (!isValid) {
        return NextResponse.json(
          { error: 'Invalid credentials' },
          { status: 401 }
        );
      }
    }
    
    // Update Talio integration info if profile exists
    if (talioProfile && !user.talioIntegration?.enabled) {
      user.talioIntegration = {
        enabled: true,
        tenantId: talioProfile.tenant.databaseName,
        userId: talioProfile.user._id.toString(),
        employeeId: talioProfile.employee?._id?.toString(),
        role: talioProfile.user.role || 'employee',
        department: talioProfile.employee?.department?.toString(),
        lastSync: new Date(),
      };
    }
    
    // Update last active
    user.lastActive = new Date();
    await user.save();
    
    // Generate token
    const token = generateToken(user);
    
    return NextResponse.json({
      message: 'Login successful',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        preferences: user.preferences,
        talioIntegration: user.talioIntegration || null,
      },
      token,
    });
    
  } catch (error: any) {
    // Handle connection abort errors gracefully (client disconnected)
    if (error?.code === 'ECONNRESET' || error?.message?.includes('aborted')) {
      console.log('[Login] Connection aborted by client');
      return NextResponse.json(
        { error: 'Connection aborted' },
        { status: 499 } // Client Closed Request
      );
    }
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
