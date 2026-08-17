import express from 'express';
import crypto from 'crypto';
import db from '../db.js';

const router = express.Router();

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin).trim()).digest('hex');
}

export function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function requireHostAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.substring(7).trim();
  const settings = db.prepare('SELECT session_token FROM settings WHERE id = 1').get();

  if (!settings || !settings.session_token || settings.session_token !== token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid session' });
  }

  next();
}

// GET /api/auth/status
router.get('/status', (req, res) => {
  const settings = db.prepare('SELECT host_name, session_token FROM settings WHERE id = 1').get();
  
  if (!settings) {
    return res.json({
      success: true,
      initialized: false,
      is_authenticated: false
    });
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  const isAuthenticated = Boolean(token && token === settings.session_token);

  res.json({
    success: true,
    initialized: true,
    host_name: settings.host_name,
    is_authenticated: isAuthenticated
  });
});

// POST /api/setup (First-time setup only)
router.post('/setup', (req, res) => {
  const { host_name, pin } = req.body;

  if (!host_name || !String(host_name).trim()) {
    return res.status(400).json({ success: false, error: 'Host name is required' });
  }

  if (!pin || String(pin).trim().length < 4) {
    return res.status(400).json({ success: false, error: 'PIN must be at least 4 digits' });
  }

  const existing = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (existing) {
    return res.status(400).json({ success: false, error: 'Setup already completed' });
  }

  const pinHash = hashPin(pin);
  const sessionToken = generateSessionToken();

  db.prepare(`
    INSERT INTO settings (id, host_name, pin_hash, session_token)
    VALUES (1, ?, ?, ?)
  `).run(String(host_name).trim(), pinHash, sessionToken);

  res.json({
    success: true,
    host_name: String(host_name).trim(),
    session_token: sessionToken
  });
});

// POST /api/auth/verify-pin
router.post('/verify-pin', (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ success: false, error: 'PIN is required' });
  }

  const settings = db.prepare('SELECT host_name, pin_hash FROM settings WHERE id = 1').get();
  if (!settings) {
    return res.status(400).json({ success: false, error: 'App is not set up yet' });
  }

  const pinHash = hashPin(pin);
  if (pinHash !== settings.pin_hash) {
    return res.status(401).json({ success: false, error: 'Incorrect PIN' });
  }

  const sessionToken = generateSessionToken();
  db.prepare('UPDATE settings SET session_token = ? WHERE id = 1').run(sessionToken);

  res.json({
    success: true,
    host_name: settings.host_name,
    session_token: sessionToken
  });
});

export default router;
