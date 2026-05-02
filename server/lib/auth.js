import jwt from 'jsonwebtoken';
import { User, serializeUser } from './models.js';

const AUTH_DISABLED = /^(1|true|yes|on)$/i.test(String(process.env.DISABLE_AUTH ?? '').trim());
const LOCAL_ADMIN_EMAIL = String(process.env.DISABLED_AUTH_EMAIL ?? 'local-admin@luxi.local').trim().toLowerCase();
let localAdminPromise = null;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
}

export function isAuthDisabled() {
  return AUTH_DISABLED;
}

async function getOrCreateLocalAdminUser() {
  if (!AUTH_DISABLED) return null;
  if (!localAdminPromise) {
    localAdminPromise = (async () => {
      let user = await User.findOne({ is_admin: true }).sort({ created_at: 1 });
      if (!user) {
        user = await User.findOne({ email: LOCAL_ADMIN_EMAIL });
      }
      if (!user) {
        user = await User.findOne().sort({ created_at: 1 });
      }
      if (!user) {
        user = await User.create({
          email: LOCAL_ADMIN_EMAIL,
          password_hash: 'auth-disabled',
          display_name: 'Local Admin',
          is_admin: true,
          subscription_tier: 'unlimited',
          credit_balance: 999999,
          total_purchased: 999999,
        });
        return user;
      }

      let dirty = false;
      if (!user.is_admin) {
        user.is_admin = true;
        dirty = true;
      }
      if (!user.subscription_tier || user.subscription_tier === 'free') {
        user.subscription_tier = 'unlimited';
        dirty = true;
      }
      if (Number(user.credit_balance ?? 0) < 999999) {
        user.credit_balance = 999999;
        dirty = true;
      }
      if (dirty) {
        await user.save();
      }
      return user;
    })().catch((error) => {
      localAdminPromise = null;
      throw error;
    });
  }
  return localAdminPromise;
}

export function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN ?? '30d' },
  );
}

function getTokenFromRequest(req) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export async function optionalAuth(req, _res, next) {
  if (AUTH_DISABLED) {
    req.user = await getOrCreateLocalAdminUser();
    next();
    return;
  }

  const token = getTokenFromRequest(req);
  if (!token) {
    req.user = null;
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    const user = await User.findById(payload.sub);
    req.user = user ?? null;
  } catch {
    req.user = null;
  }
  next();
}

export async function requireAuth(req, res, next) {
  if (AUTH_DISABLED) {
    req.user = await getOrCreateLocalAdminUser();
    next();
    return;
  }

  const token = getTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    const user = await User.findById(payload.sub);
    if (!user) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid session' });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

export function authResponse(user) {
  return {
    token: signToken(user),
    user: serializeUser(user),
  };
}
