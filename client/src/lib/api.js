const API_BASE = '/api';

export function getSessionToken() {
  return localStorage.getItem('caps_host_token') || '';
}

export function setSessionToken(token) {
  if (token) {
    localStorage.setItem('caps_host_token', token);
  } else {
    localStorage.removeItem('caps_host_token');
  }
}

export function getGuestToken(slug) {
  return localStorage.getItem(`caps_guest_${slug}`) || '';
}

export function setGuestToken(slug, token) {
  if (token) {
    localStorage.setItem(`caps_guest_${slug}`, token);
  } else {
    localStorage.removeItem(`caps_guest_${slug}`);
  }
}

export async function apiRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  const isFormData = options.body instanceof FormData;

  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  };

  const token = getSessionToken();
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed with status ${res.status}`);
    }
    return data;
  }

  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }

  return res;
}

export const api = {
  // Auth & Setup
  getAuthStatus: () => apiRequest('/auth/status'),
  setupHost: (host_name, pin) => apiRequest('/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ host_name, pin })
  }),
  verifyPin: (pin) => apiRequest('/auth/verify-pin', {
    method: 'POST',
    body: JSON.stringify({ pin })
  }),

  // Events
  getEvents: () => apiRequest('/events'),
  getEvent: (slug) => apiRequest(`/events/${slug}`),
  createEvent: (eventData) => apiRequest('/events', {
    method: 'POST',
    body: JSON.stringify(eventData)
  }),
  getEventQR: (slug, hostType = 'ip') => apiRequest(`/events/${slug}/qr?format=dataurl&host_type=${hostType}`),

  // Guest actions
  joinEvent: (slug, name) => apiRequest(`/events/${slug}/join`, {
    method: 'POST',
    body: JSON.stringify({ name })
  }),
  getGuestSession: (slug, guestToken) => apiRequest(`/events/${slug}/guest-session`, {
    headers: { 'X-Guest-Token': guestToken }
  }),

  // Photos
  uploadPhoto: (slug, file, guestToken) => {
    const formData = new FormData();
    formData.append('photo', file);
    return apiRequest(`/events/${slug}/photos`, {
      method: 'POST',
      body: formData,
      headers: guestToken ? { 'X-Guest-Token': guestToken } : {}
    });
  },
  getPhotos: (slug, options = {}) => {
    const params = new URLSearchParams();
    if (options.status) params.append('status', options.status);
    if (options.guest) params.append('guest', options.guest);
    const queryString = params.toString() ? `?${params.toString()}` : '';
    const headers = options.guestToken ? { 'X-Guest-Token': options.guestToken } : {};
    return apiRequest(`/events/${slug}/photos${queryString}`, { headers });
  },
  getMyQuota: (slug, guestToken) => apiRequest(`/events/${slug}/photos/my-quota`, {
    headers: { 'X-Guest-Token': guestToken }
  }),
  deletePhoto: (slug, photoId, guestToken) => {
    const headers = guestToken ? { 'X-Guest-Token': guestToken } : {};
    return apiRequest(`/events/${slug}/photos/${photoId}`, {
      method: 'DELETE',
      headers
    });
  },

  // Moderation (Host Only)
  patchPhotoStatus: (slug, photoId, status) => apiRequest(`/events/${slug}/photos/${photoId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  }),
  bulkPatchPhotoStatus: (slug, ids, status) => apiRequest(`/events/${slug}/photos/bulk`, {
    method: 'PATCH',
    body: JSON.stringify({ ids, status })
  }),

  // Slideshow
  getSlideshowConfig: (slug, hostType = 'ip') => apiRequest(`/events/${slug}/slideshow-config?host_type=${hostType}`),
  updateSlideshowConfig: (slug, config) => apiRequest(`/events/${slug}/slideshow-config`, {
    method: 'PATCH',
    body: JSON.stringify(config)
  }),

  // Lifecycle & Analytics (Host Only)
  updateEventStatus: (slug, status) => apiRequest(`/events/${slug}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  }),
  deleteEvent: (slug) => apiRequest(`/events/${slug}`, {
    method: 'DELETE'
  }),
  getEventAnalytics: (slug) => apiRequest(`/events/${slug}/analytics`),

  // Per-Event Branding (Host Only)
  uploadEventLogo: async (slug, file) => {
    const formData = new FormData();
    formData.append('logo', file);
    const token = getSessionToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/events/${slug}/logo`, {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to upload logo');
    return data;
  },
  deleteEventLogo: (slug) => apiRequest(`/events/${slug}/logo`, { method: 'DELETE' }),
  updateEventBranding: (slug, branding) => apiRequest(`/events/${slug}/branding`, {
    method: 'PATCH',
    body: JSON.stringify(branding)
  })
};

/**
 * Trigger ZIP download for selected photo IDs
 */
export async function downloadSelectedZip(slug, ids) {
  const res = await fetch(`/api/events/${slug}/photos/download-zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to generate ZIP');
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `caps-${slug}-selected.zip`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/**
 * Robust WebSocket client with auto-reconnection
 */
export function createWebSocketConnection(slug, { onMessage, onStatusChange, isHost = false }) {
  let ws = null;
  let retryCount = 0;
  let isClosedManually = false;

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      retryCount = 0;
      onStatusChange?.('connected');
      const hostToken = isHost ? getSessionToken() : null;
      ws.send(JSON.stringify({ type: 'join', slug, host_token: hostToken }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage?.(data);
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };

    ws.onclose = () => {
      onStatusChange?.('disconnected');
      if (!isClosedManually) {
        const delay = Math.min(1000 * Math.pow(1.5, retryCount), 10000);
        retryCount++;
        setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  connect();

  return {
    disconnect: () => {
      isClosedManually = true;
      if (ws) ws.close();
    }
  };
}
