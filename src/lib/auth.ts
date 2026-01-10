import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { IUser, ITalioIntegration } from '@/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'mira-default-secret';

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
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function getTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}
