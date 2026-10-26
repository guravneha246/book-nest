import cors, { CorsOptions } from 'cors';
import { config } from '../config/index.js';

export function getAllowedOrigins(): string[] {
  const allowed = new Set<string>();

  // Configured APP_URL
  if (config.appUrl) {
    try {
      allowed.add(new URL(config.appUrl).origin.toLowerCase());
    } catch {}
  }

  // Render deployment environment URLs
  if (process.env.RENDER_EXTERNAL_URL) {
    try {
      allowed.add(new URL(process.env.RENDER_EXTERNAL_URL).origin.toLowerCase());
    } catch {}
  }
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    allowed.add(`https://${process.env.RENDER_EXTERNAL_HOSTNAME.toLowerCase()}`);
  }

  // Live production service default
  allowed.add('https://booknest-api-tnwu.onrender.com');

  // Local development / testing origins
  allowed.add('http://localhost:3000');
  allowed.add('http://127.0.0.1:3000');
  allowed.add('http://localhost:5000');
  allowed.add('http://127.0.0.1:5000');

  // Additional origins from CORS_ALLOWED_ORIGINS environment variable
  const extraOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (extraOrigins) {
    extraOrigins.split(',').forEach((o) => {
      const trimmed = o.trim();
      if (trimmed) {
        try {
          allowed.add(new URL(trimmed).origin.toLowerCase());
        } catch {
          allowed.add(trimmed.toLowerCase());
        }
      }
    });
  }

  return Array.from(allowed);
}

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Non-browser requests (same-origin, curl, server-to-server, test scripts) omit Origin
    if (!origin) {
      return callback(null, true);
    }

    const normalizedOrigin = origin.toLowerCase();
    const allowedOrigins = getAllowedOrigins();

    if (allowedOrigins.includes(normalizedOrigin) || normalizedOrigin.endsWith('.onrender.com')) {
      return callback(null, true);
    }

    // Explicitly disallow unauthorized origins
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'],
  exposedHeaders: ['Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  credentials: false,
  maxAge: 86400 // Cache preflight requests for 24 hours
};

export const corsMiddleware = cors(corsOptions);
