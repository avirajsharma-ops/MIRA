import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { IUser, ITalioIntegration } from '@/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'mira-default-secret';

// Log JWT_SECRET availability (not the actual secret)
if (!process.env.JWT_SECRET) {
  console.warn('[Auth] WARNING: JWT_SECRET not set, using default (insecure for production)');
}

export interface TokenPayload {
  userId: string;
  email: string;
  name: string;
  talioIntegration?: ITalioIntegration;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export function generateToken(user: IUser): string {
  const payload: TokenPayload = {
    userId: user._id.toString(),
    email: user.email,
    name: user.name,
    talioIntegration: user.talioIntegration || undefined,
  };
  
  // Token valid for 30 days
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
    return payload;
  } catch (error: any) {
    console.log('[Auth] Token verification failed:', error?.message || 'Unknown error');
    return null;
  }
}

export function getTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}
