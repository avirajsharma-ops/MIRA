// Talio Authentication - Cross-validate MIRA users with Talio HRMS
// Handles user lookup, tenant detection, and role-based access control

import { getSuperAdminConnection, getTenantConnection } from './talioDb';
import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

// ========== Interfaces ==========

export interface TalioUser {
  _id: string;
  email: string;
  role: 'admin' | 'hr' | 'department_head' | 'manager' | 'employee';
  employeeId: string;
  isActive: boolean;
  lastLogin?: Date;
}

export interface TalioEmployee {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  employeeCode: string;
  phone?: string;
  department?: string;
  designation?: string;
  reportingManager?: string;
  isActive: boolean;
  dateOfJoining: Date;
}

export interface TalioTenantInfo {
  databaseName: string;
  companyName: string;
  companySlug: string;
  tenantCompanyId: string;
  role: string;
  isActive: boolean;
}

export interface TalioAuthResult {
  success: boolean;
  message?: string;
  user?: TalioUser;
  employee?: TalioEmployee;
  tenant?: TalioTenantInfo;
}

// ========== Schemas ==========

// UserTenantMapping schema (superadmin database)
const UserTenantMappingSchema = new Schema({
  email: { type: String, required: true, unique: true },
  tenantCompanyId: { type: Schema.Types.ObjectId },
  databaseName: String,
  companyName: String,
  companySlug: String,
  role: String,
  isActive: { type: Boolean, default: true },
  loginCount: { type: Number, default: 0 },
  lastLoginAt: Date,
}, { timestamps: true });

// User schema (tenant database)
const TalioUserSchema = new Schema({
  email: { type: String, required: true },
  password: { type: String, select: false },
  role: { type: String, enum: ['admin', 'hr', 'department_head', 'manager', 'employee'], default: 'employee' },
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
  isActive: { type: Boolean, default: true },
  forcePasswordChange: { type: Boolean, default: false },
  lastLogin: Date,
  isDepartmentHead: { type: Boolean, default: false },
  headOfDepartments: [{ type: Schema.Types.ObjectId, ref: 'Department' }],
}, { timestamps: true });

// Employee schema (tenant database)  
const TalioEmployeeSchema = new Schema({
  firstName: { type: String, required: true },
  lastName: { type: String },
  email: { type: String, required: true },
  employeeCode: String,
  phone: String,
  department: { type: Schema.Types.ObjectId, ref: 'Department' },
  designation: { type: Schema.Types.ObjectId, ref: 'Designation' },
  reportingManager: { type: Schema.Types.ObjectId, ref: 'Employee' },
  isActive: { type: Boolean, default: true },
  dateOfJoining: Date,
}, { timestamps: true });

// ========== Functions ==========

/**
 * Look up which tenant a user belongs to by their email
 */
export async function getTenantByEmail(email: string): Promise<TalioTenantInfo | null> {
  try {
    const superAdmin = await getSuperAdminConnection();
    const UserTenantMapping = superAdmin.models.UserTenantMapping || 
      superAdmin.model('UserTenantMapping', UserTenantMappingSchema);

    const mapping = await UserTenantMapping.findOne({ 
      email: email.toLowerCase(),
      isActive: true 
    }).lean() as any;

    if (!mapping) {
      return null;
    }

    return {
      databaseName: mapping.databaseName,
      companyName: mapping.companyName,
      companySlug: mapping.companySlug,
      tenantCompanyId: mapping.tenantCompanyId?.toString(),
      role: mapping.role,
      isActive: mapping.isActive,
    };
  } catch (error) {
    console.error('[TalioAuth] Error getting tenant by email:', error);
    return null;
  }
}

/**
 * Authenticate a user against the Talio database
 * Returns user info if credentials match
 */
export async function authenticateTalioUser(
  email: string, 
  password: string
): Promise<TalioAuthResult> {
  try {
    // First, find which tenant the user belongs to
    const tenant = await getTenantByEmail(email);
    
    if (!tenant) {
      return {
        success: false,
        message: 'User not found in Talio HRMS',
      };
    }

    // Connect to the tenant database
    const tenantConn = await getTenantConnection(tenant.databaseName);
    
    // Get or create models
    const User = tenantConn.models.User || tenantConn.model('User', TalioUserSchema);
    const Employee = tenantConn.models.Employee || tenantConn.model('Employee', TalioEmployeeSchema);

    // Find user with password
    const user = await User.findOne({ 
      email: email.toLowerCase(),
      isActive: true 
    }).select('+password').lean() as any;

    if (!user) {
      return {
        success: false,
        message: 'User account not found or inactive',
      };
    }

    // Verify password
    if (!user.password) {
      return {
        success: false,
        message: 'Password not set for this account',
      };
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return {
        success: false,
        message: 'Invalid password',
      };
    }

    // Get employee details
    const employee = await Employee.findById(user.employeeId).lean() as any;

    // Update last login
    await User.updateOne(
      { _id: user._id },
      { lastLogin: new Date() }
    );

    // Update tenant mapping login count
    const superAdmin = await getSuperAdminConnection();
    const UserTenantMapping = superAdmin.models.UserTenantMapping || 
      superAdmin.model('UserTenantMapping', UserTenantMappingSchema);
    await UserTenantMapping.updateOne(
      { email: email.toLowerCase() },
      { 
        $inc: { loginCount: 1 },
        lastLoginAt: new Date()
      }
    );

    return {
      success: true,
      user: {
        _id: user._id.toString(),
        email: user.email,
        role: user.role,
        employeeId: user.employeeId?.toString(),
        isActive: user.isActive,
        lastLogin: user.lastLogin,
      },
      employee: employee ? {
        _id: employee._id.toString(),
        firstName: employee.firstName,
        lastName: employee.lastName || '',
        email: employee.email,
        employeeCode: employee.employeeCode,
        phone: employee.phone,
        department: employee.department?.toString(),
        designation: employee.designation?.toString(),
        reportingManager: employee.reportingManager?.toString(),
        isActive: employee.isActive,
        dateOfJoining: employee.dateOfJoining,
      } : undefined,
      tenant,
    };
  } catch (error) {
    console.error('[TalioAuth] Authentication error:', error);
    return {
      success: false,
      message: 'Authentication failed',
    };
  }
}

/**
 * Get user info from Talio by email (without password verification)
 * Used after MIRA authentication to check if user has Talio access
 */
export async function getTalioUserInfo(email: string): Promise<TalioAuthResult> {
  try {
    const tenant = await getTenantByEmail(email);
    
    if (!tenant) {
      return {
        success: false,
        message: 'User not found in Talio HRMS',
      };
    }

    const tenantConn = await getTenantConnection(tenant.databaseName);
    const User = tenantConn.models.User || tenantConn.model('User', TalioUserSchema);
    const Employee = tenantConn.models.Employee || tenantConn.model('Employee', TalioEmployeeSchema);

    const user = await User.findOne({ 
      email: email.toLowerCase(),
      isActive: true 
    }).lean() as any;

    if (!user) {
      return {
        success: false,
        message: 'User account not found or inactive',
      };
    }

    const employee = await Employee.findById(user.employeeId).lean() as any;

    return {
      success: true,
      user: {
        _id: user._id.toString(),
        email: user.email,
        role: user.role,
        employeeId: user.employeeId?.toString(),
        isActive: user.isActive,
        lastLogin: user.lastLogin,
      },
      employee: employee ? {
        _id: employee._id.toString(),
        firstName: employee.firstName,
        lastName: employee.lastName || '',
        email: employee.email,
        employeeCode: employee.employeeCode,
        phone: employee.phone,
        department: employee.department?.toString(),
        designation: employee.designation?.toString(),
        reportingManager: employee.reportingManager?.toString(),
        isActive: employee.isActive,
        dateOfJoining: employee.dateOfJoining,
      } : undefined,
      tenant,
    };
  } catch (error) {
    console.error('[TalioAuth] Error getting user info:', error);
    return {
      success: false,
      message: 'Failed to get user info',
    };
  }
}

/**
 * Check if a user has a specific role or higher
 * Hierarchy: admin > department_head > hr > manager > employee
 */
export function hasRole(userRole: string, requiredRoles: string[]): boolean {
  const roleHierarchy: Record<string, number> = {
    admin: 5,
    department_head: 4,
    hr: 3,
    manager: 2,
    employee: 1,
  };

  const userLevel = roleHierarchy[userRole] || 0;
  
  return requiredRoles.some(role => {
    const requiredLevel = roleHierarchy[role] || 0;
    return userLevel >= requiredLevel;
  });
}

/**
 * Check if user can access another user's data
 * Based on role hierarchy and reporting structure
 */
export async function canAccessUserData(
  requestingUser: TalioUser,
  targetUserId: string,
  tenantDatabase: string
): Promise<boolean> {
  // Admin and HR can access all data
  if (['admin', 'hr'].includes(requestingUser.role)) {
    return true;
  }

  // Users can always access their own data
  if (requestingUser._id === targetUserId || requestingUser.employeeId === targetUserId) {
    return true;
  }

  try {
    const tenantConn = await getTenantConnection(tenantDatabase);
    const Employee = tenantConn.models.Employee || tenantConn.model('Employee', TalioEmployeeSchema);
    const User = tenantConn.models.User || tenantConn.model('User', TalioUserSchema);

    // Get target user's employee record
    const targetUser = await User.findById(targetUserId).lean() as any;
    const targetEmployee = targetUser?.employeeId 
      ? await Employee.findById(targetUser.employeeId).lean() as any
      : await Employee.findById(targetUserId).lean() as any;

    if (!targetEmployee) {
      return false;
    }

    // Manager can access their direct reports
    if (requestingUser.role === 'manager') {
      return targetEmployee.reportingManager?.toString() === requestingUser.employeeId;
    }

    // Department head can access their department members
    if (requestingUser.role === 'department_head') {
      const requestingUserRecord = await User.findById(requestingUser._id)
        .populate('headOfDepartments')
        .lean() as any;
      
      if (requestingUserRecord?.headOfDepartments?.length) {
        const deptIds = requestingUserRecord.headOfDepartments.map((d: any) => d._id.toString());
        return deptIds.includes(targetEmployee.department?.toString());
      }
    }

    return false;
  } catch (error) {
    console.error('[TalioAuth] Error checking access:', error);
    return false;
  }
}
