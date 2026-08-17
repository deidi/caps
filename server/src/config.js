import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin).trim()).digest('hex');
}

/**
 * Finds and loads configuration from caps.config.json
 */
export function loadConfig() {
  const potentialPaths = [
    path.resolve(__dirname, '../../caps.config.json'),     // Workspace root
    path.resolve(__dirname, '../caps.config.json'),        // Server root
    path.resolve(process.cwd(), 'caps.config.json'),       // Current working directory
    path.resolve(process.cwd(), '../caps.config.json'),    // Parent directory
  ];

  let configPath = null;
  for (const p of potentialPaths) {
    if (fs.existsSync(p)) {
      configPath = p;
      break;
    }
  }

  const defaultConfig = {
    host_name: 'NCCF Media Team',
    admin_pin: '1234',
    port: 1000
  };

  if (!configPath) {
    const fallbackPath = path.resolve(__dirname, '../../caps.config.json');
    try {
      fs.writeFileSync(fallbackPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
      console.log('📄 Created default configuration file at: caps.config.json');
    } catch (e) {
      // Ignored if root is read-only
    }
    return defaultConfig;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    
    // Validate and sanitize
    const hostName = parsed.host_name && String(parsed.host_name).trim()
      ? String(parsed.host_name).trim()
      : defaultConfig.host_name;

    const adminPin = parsed.admin_pin && String(parsed.admin_pin).trim()
      ? String(parsed.admin_pin).trim()
      : defaultConfig.admin_pin;

    const port = parsed.port && !isNaN(Number(parsed.port))
      ? Number(parsed.port)
      : defaultConfig.port;

    return {
      host_name: hostName,
      admin_pin: adminPin,
      port: port
    };
  } catch (err) {
    console.error('⚠️ Error reading caps.config.json, using defaults:', err.message);
    return defaultConfig;
  }
}

/**
 * Synchronizes the config file credentials with the SQLite database
 */
export function syncConfigWithDb(db) {
  try {
    const config = loadConfig();
    if (!config.admin_pin) return;

    const pinHash = hashPin(config.admin_pin);
    const existing = db.prepare('SELECT id, host_name, pin_hash FROM settings WHERE id = 1').get();

    if (existing) {
      if (existing.host_name !== config.host_name || existing.pin_hash !== pinHash) {
        db.prepare(`
          UPDATE settings 
          SET host_name = ?, 
              pin_hash = ?
          WHERE id = 1
        `).run(config.host_name, pinHash);
        console.log(`🔑 Synchronized credentials from caps.config.json (Host: "${config.host_name}", PIN: ${config.admin_pin})`);
      }
    } else {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      db.prepare(`
        INSERT INTO settings (id, host_name, pin_hash, session_token)
        VALUES (1, ?, ?, ?)
      `).run(config.host_name, pinHash, sessionToken);
      console.log(`🔑 Initialized host account from caps.config.json (Host: "${config.host_name}", PIN: ${config.admin_pin})`);
    }
  } catch (e) {
    console.error('Error synchronizing config with database:', e.message);
  }
}
