import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

const JWT_SECRET = config.jwtSecret;

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: 'user' | 'admin';
    name: string;
  };
}

export function generateToken(payload: { id: number; email: string; role: 'user' | 'admin'; name: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
  } catch (err) {
    // Invalid token, treat as guest
  }
  next();
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  // Allow browser CORS preflight requests to pass through without credentials
  if (req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid token. Please sign in again.' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Administrative privileges required.' });
    }
    next();
  });
}
