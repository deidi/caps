import { WebSocketServer, WebSocket } from 'ws';

let wss = null;
// Map of eventSlug -> Set of WebSocket clients
const eventRooms = new Map();
// Set of authenticated host WebSocket clients
const hostClients = new Set();

export function initWebSocketServer(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    let currentEventSlug = null;
    let isHost = false;

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'join') {
          const { slug, host_token } = message;
          if (slug) {
            currentEventSlug = slug;
            if (!eventRooms.has(slug)) {
              eventRooms.set(slug, new Set());
            }
            eventRooms.get(slug).add(ws);
          }

          if (host_token) {
            isHost = true;
            hostClients.add(ws);
          }

          ws.send(JSON.stringify({ type: 'joined', slug, is_host: isHost }));
        }
      } catch (err) {
        console.error('Error handling WS message:', err);
      }
    });

    ws.on('close', () => {
      if (currentEventSlug && eventRooms.has(currentEventSlug)) {
        eventRooms.get(currentEventSlug).delete(ws);
        if (eventRooms.get(currentEventSlug).size === 0) {
          eventRooms.delete(currentEventSlug);
        }
      }
      if (isHost) {
        hostClients.delete(ws);
      }
    });

    ws.on('error', (err) => {
      console.warn('WS client error:', err.message);
    });
  });

  // Keep-alive heartbeat interval (every 30s)
  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  console.log('⚡ WebSocket server initialized at /ws');
  return wss;
}

/**
 * Broadcast an event payload to all clients connected to an event room
 */
export function broadcastToEvent(slug, type, payload) {
  if (!eventRooms.has(slug)) return;
  const message = JSON.stringify({ type, slug, payload, timestamp: Date.now() });

  eventRooms.get(slug).forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Broadcast an event payload to all connected host clients
 */
export function broadcastToHosts(type, payload) {
  const message = JSON.stringify({ type, payload, timestamp: Date.now() });
  hostClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
