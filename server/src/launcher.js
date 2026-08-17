import { exec } from 'child_process';
import { app } from './index.js';
import { loadConfig } from './config.js';

// If running in standalone launcher mode, automatically open host dashboard in default browser
const config = loadConfig();
const PORT = process.env.PORT || config.port || 1000;
const hostUrl = `http://localhost:${PORT}`;

console.log('🚀 Starting Caps Windows Hub Launcher...');
console.log(`🌐 Opening browser at: ${hostUrl}\n`);

// On Windows, 'start <url>' opens the URL in the default browser (Chrome, Edge, etc.)
if (process.platform === 'win32') {
  exec(`start ${hostUrl}`);
} else if (process.platform === 'darwin') {
  exec(`open ${hostUrl}`);
} else {
  exec(`xdg-open ${hostUrl}`);
}
