import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { handleTalioQuery, TalioMiraUser } from '@/lib/talio/talioMiraIntegration';

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const { query } = await request.json();
    
    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Check if user has Talio integration
    if (!decoded.talioIntegration?.enabled) {
      return NextResponse.json({
        success: false,
        message: "You don't have Talio HRMS integration enabled. Please contact your administrator.",
        data: null,
      });
    }

    // Build Talio user object
    const talioUser: TalioMiraUser = {
      email: decoded.email,
      talioUserId: decoded.talioIntegration.userId,
      tenantDatabase: decoded.talioIntegration.tenantId,
      role: decoded.talioIntegration.role,
      employeeId: decoded.talioIntegration.employeeId,
      department: decoded.talioIntegration.department,
    };

    // Process the query
    const result = await handleTalioQuery(query, talioUser);

    return NextResponse.json(result);

  } catch (error) {
    console.error('Talio query error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
