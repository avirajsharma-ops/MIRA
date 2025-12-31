// Health check endpoint for Docker/Kubernetes
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';

export async function GET() {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    checks: {
      database: 'unknown',
      memory: 'ok',
    },
  };

  try {
    // Check database connection
    await connectToDatabase();
    healthCheck.checks.database = 'connected';
  } catch (error) {
    healthCheck.checks.database = 'disconnected';
    healthCheck.status = 'degraded';
  }

  // Check memory usage
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
  
  if (heapUsedMB / heapTotalMB > 0.9) {
    healthCheck.checks.memory = 'high';
    healthCheck.status = 'degraded';
  }

  const statusCode = healthCheck.status === 'healthy' ? 200 : 503;

  return NextResponse.json(healthCheck, { status: statusCode });
}
