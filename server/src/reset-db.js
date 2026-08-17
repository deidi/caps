import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { syncConfigWithDb, loadConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../data');
const eventsDir = path.join(dataDir, 'events');

console.log('🧹 Clearing Caps database of all test data...');

// 1. Wipe SQLite tables
db.exec(`
  DELETE FROM photos;
  DELETE FROM guests;
  DELETE FROM events;
`);

// 2. Wipe test event directories and files on disk
if (fs.existsSync(eventsDir)) {
  try {
    fs.rmSync(eventsDir, { recursive: true, force: true });
    fs.mkdirSync(eventsDir, { recursive: true });
    console.log('   ✅ Removed test event photos and folders from disk.');
  } catch (e) {
    console.warn('   ⚠️ Could not remove events directory:', e.message);
  }
}

// 3. Sync admin PIN and host name from caps.config.json
syncConfigWithDb(db);
const config = loadConfig();
const settings = db.prepare('SELECT host_name, pin_hash FROM settings WHERE id = 1').get();

console.log('\n======================================================');
console.log('✨ CAPS DATABASE RESET COMPLETE & CLEAN');
console.log('======================================================');
console.log(`👤 Host Name:  ${config.host_name}`);
console.log(`🔑 Admin PIN:  ${config.admin_pin} (from caps.config.json)`);
console.log(`🌐 Server Port: ${config.port}`);
console.log('======================================================\n');
