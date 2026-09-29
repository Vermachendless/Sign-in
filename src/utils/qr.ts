import QRCode from 'qrcode';

/**
 * Generates an SVG string representation of a QR code
 * Encodes strictly the opaque verification token or URL, never personal data
 */
export async function generateQrSvg(dataToEncode: string): Promise<string> {
  return QRCode.toString(dataToEncode, {
    type: 'svg',
    margin: 1,
    color: {
      dark: '#0A0A0A',
      light: '#FFFFFF',
    },
    errorCorrectionLevel: 'M',
  });
}

/**
 * Generates a base64 DataURL representation of a QR code for img tags
 */
export async function generateQrDataUrl(dataToEncode: string): Promise<string> {
  return QRCode.toDataURL(dataToEncode, {
    margin: 1,
    width: 256,
    color: {
      dark: '#0A0A0A',
      light: '#FFFFFF',
    },
    errorCorrectionLevel: 'M',
  });
}

/**
 * Constructs the canonical verification URL containing only the opaque token or code
 */
export function buildVerificationUrl(tokenOrCode: { token?: string; code?: string }): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://office-access.local';
  if (tokenOrCode.token) {
    return `${origin}/access/verify?t=${encodeURIComponent(tokenOrCode.token)}`;
  }
  if (tokenOrCode.code) {
    return `${origin}/access/verify?c=${encodeURIComponent(tokenOrCode.code)}`;
  }
  return `${origin}/access/verify`;
}
