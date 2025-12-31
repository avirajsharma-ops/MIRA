// Health check endpoint for Docker/Kubernetes
// Simple health check that doesn't require database connection
import { NextResponse } from 'next/server';

export async function GET() {
  // Simple health check - just confirm the app is running
  // Don't check database here as it causes container to fail health checks
  // if MongoDB is temporarily unavailable
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  };

  return NextResponse.json(healthCheck, { status: 200 });
}
