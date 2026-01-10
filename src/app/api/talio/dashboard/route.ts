import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getDashboardOverview } from '@/lib/talio/talioQueries';
import { getTalioUserInfo, TalioUser, TalioEmployee } from '@/lib/talio/talioAuth';

export async function GET(request: NextRequest) {
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

    // Check if user has Talio integration
    if (!decoded.talioIntegration?.enabled) {
      return NextResponse.json({
        success: false,
        message: "You don't have Talio HRMS integration enabled.",
        data: null,
      });
    }

    // Get full Talio user info
    const talioInfo = await getTalioUserInfo(decoded.email);
    
    if (!talioInfo.success || !talioInfo.user || !talioInfo.employee) {
      return NextResponse.json({
        success: false,
        message: "Could not fetch Talio user info.",
        data: null,
      });
    }

    // Get dashboard overview
    const dashboard = await getDashboardOverview(
      talioInfo.user as TalioUser,
      talioInfo.employee as TalioEmployee,
      decoded.talioIntegration.tenantId
    );

    return NextResponse.json({
      success: true,
      data: dashboard,
    });

  } catch (error) {
    console.error('Talio dashboard error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
