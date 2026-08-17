import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import photoRoutes from './routes/photos.js';
import { getLocalIpAddress } from './utils.js';
import { initWebSocketServer } from './ws.js';
import { loadConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const config = loadConfig();
const PORT = process.env.PORT || config.port || 1000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static directory for uploaded data
const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
app.use('/data', express.static(dataDir));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/events/:slug/photos', photoRoutes);
app.use('/api/events', eventRoutes);

// Healthcheck endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    ip: getLocalIpAddress(),
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Client static serving (for Svelte production build)
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/data')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  // If client isn't built yet, serve a friendly fallback
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/data')) {
      return next();
    }
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Caps Server</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #fafbfc; color: #111827; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); max-width: 480px; text-align: center; }
            h1 { color: #2563eb; margin-top: 0; }
            .badge { display: inline-block; padding: 0.25rem 0.75rem; background: #dbeafe; color: #1d4ed8; border-radius: 9999px; font-weight: 600; font-size: 0.875rem; margin-bottom: 1rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <span class="badge">Caps Server Active</span>
            <h1>Caps Local Hub is Running</h1>
            <p>REST API is live at <code>/api</code>. Client UI is being connected.</p>
          </div>
        </body>
      </html>
    `);
  });
}

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log(`========================================`);
  console.log(` 📸 Caps Server running on:`);
  console.log(` - Localhost:  http://localhost:${PORT}`);
  console.log(` - LAN IP:     http://${localIp}:${PORT}`);
  console.log(`========================================`);

  initWebSocketServer(server);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const localIp = getLocalIpAddress();
    console.log(`\n========================================`);
    console.log(` ⚠️ Caps is ALREADY RUNNING on port ${PORT}!`);
    console.log(` - Localhost:  http://localhost:${PORT}`);
    console.log(` - LAN IP:     http://${localIp}:${PORT}`);
    console.log(`========================================\n`);
  } else {
    console.error('❌ Server startup error:', err.message);
  }
});

export { app, server };
