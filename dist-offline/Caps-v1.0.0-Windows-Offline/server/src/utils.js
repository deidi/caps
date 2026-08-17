import os from 'os';
import crypto from 'crypto';
import QRCode from 'qrcode';

/**
 * Returns primary IPv4 network address of host machine
 */
export function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Generate QR code as PNG Buffer
 */
export async function generateQRCodeBuffer(text, options = {}) {
  return await QRCode.toBuffer(text, {
    errorCorrectionLevel: 'M',
    type: 'png',
    margin: 2,
    width: options.width || 400,
    color: {
      dark: '#111827',
      light: '#ffffff'
    },
    ...options
  });
}

/**
 * Generate QR code as Base64 Data URL
 */
export async function generateQRCodeDataURL(text, options = {}) {
  return await QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: options.width || 400,
    color: {
      dark: '#111827',
      light: '#ffffff'
    },
    ...options
  });
}

/**
 * Generate secure guest token
 */
export function generateGuestToken() {
  return 'gst_' + crypto.randomBytes(20).toString('hex');
}
