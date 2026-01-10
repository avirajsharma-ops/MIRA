// Talio Multi-Tenant Database Connection Manager
// Connects to Talio HRMS MongoDB for employee data, tasks, attendance, etc.

import mongoose from 'mongoose';

// IMPORTANT: Do not hardcode MongoDB URIs - use environment variables only
const TALIO_MONGODB_URI = process.env.TALIO_MONGODB_URI;

if (!TALIO_MONGODB_URI) {
  console.warn('[TalioDB] TALIO_MONGODB_URI not set in environment variables');
}

// Connection cache for tenant databases
const tenantConnections = new Map<string, mongoose.Connection>();

// SuperAdmin database connection
let superAdminConnection: mongoose.Connection | null = null;

/**
 * Get connection to the Talio SuperAdmin database
 * This contains TenantCompany and UserTenantMapping collections
 */
export async function getSuperAdminConnection(): Promise<mongoose.Connection> {
  if (superAdminConnection && superAdminConnection.readyState === 1) {
    return superAdminConnection;
  }

  if (!TALIO_MONGODB_URI) {
    throw new Error('TALIO_MONGODB_URI environment variable is not configured');
  }

  try {
    const conn = mongoose.createConnection(TALIO_MONGODB_URI, {
      dbName: 'talio_superadmin',
      maxPoolSize: 5,
      minPoolSize: 1,
    });

    await conn.asPromise();
    superAdminConnection = conn;
    console.log('[TalioDB] Connected to superadmin database');
    return conn;
  } catch (error) {
    console.error('[TalioDB] SuperAdmin connection error:', error);
    throw error;
  }
}

/**
 * Get connection to a specific tenant database
 * Each company has its own database: talio_company_{slug}
 */
export async function getTenantConnection(databaseName: string): Promise<mongoose.Connection> {
  // Check cache
  const cached = tenantConnections.get(databaseName);
  if (cached && cached.readyState === 1) {
    return cached;
  }

  if (!TALIO_MONGODB_URI) {
    throw new Error('TALIO_MONGODB_URI environment variable is not configured');
  }

  try {
    const conn = mongoose.createConnection(TALIO_MONGODB_URI, {
      dbName: databaseName,
      maxPoolSize: 10,
      minPoolSize: 2,
    });

    await conn.asPromise();
    tenantConnections.set(databaseName, conn);
    console.log(`[TalioDB] Connected to tenant database: ${databaseName}`);
    return conn;
  } catch (error) {
    console.error(`[TalioDB] Tenant connection error for ${databaseName}:`, error);
    throw error;
  }
}

/**
 * Close all Talio database connections
 */
export async function closeTalioConnections(): Promise<void> {
  if (superAdminConnection) {
    await superAdminConnection.close();
    superAdminConnection = null;
  }

  for (const [name, conn] of tenantConnections) {
    await conn.close();
    console.log(`[TalioDB] Closed connection to ${name}`);
  }
  tenantConnections.clear();
}

/**
 * Get active tenant connections info (for debugging)
 */
export function getActiveTenantConnections(): { databaseName: string; readyState: number }[] {
  return Array.from(tenantConnections.entries()).map(([name, conn]) => ({
    databaseName: name,
    readyState: conn.readyState,
  }));
}
