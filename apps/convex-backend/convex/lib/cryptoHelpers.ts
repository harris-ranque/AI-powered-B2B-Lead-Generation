/**
 * Crypto helper functions for Convex using Web Crypto API
 * Compatible with Convex edge runtime (no Node.js dependencies)
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64UrlEncode(data: Uint8Array): string {
  // Use btoa for base64 encoding (available in Web APIs)
  const base64 = btoa(String.fromCharCode(...data));
  return base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64UrlEncodeString(data: string): string {
  return base64UrlEncode(encoder.encode(data));
}

export function base64UrlDecodeToString(data: string): string {
  const padded = data.padEnd(data.length + ((4 - (data.length % 4)) % 4), "=");
  const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
  // Use atob for base64 decoding (available in Web APIs)
  const binaryString = atob(normalized);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return decoder.decode(bytes);
}

export function randomNonce(bytes = 16): string {
  // Use Web Crypto API for random bytes
  const randomBytes = new Uint8Array(bytes);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hmacSha256(secret: string, payload: string): Promise<string> {
  // Use Web Crypto API for HMAC
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  // Convert to base64url
  return base64UrlEncode(new Uint8Array(signature));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export interface ExportTokenPayload {
  uid: string;
  iat: number;
  exp: number;
  aud?: string;
  n?: string;
  iss?: string;
  ver?: number;
  ori?: string;
}

export async function verifyExportToken(
  token: string,
  secret: string,
  expectedAudience: string,
  requestOrigin?: string,
): Promise<{ valid: boolean; payload?: ExportTokenPayload } | { valid: false }> {
  if (!token.startsWith("v2.")) {
    return { valid: false };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false };
  }

  const [, payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) {
    return { valid: false };
  }

  const expectedSignature = await hmacSha256(secret, payloadB64);
  if (!timingSafeEqual(signatureB64, expectedSignature)) {
    return { valid: false };
  }

  let payload: ExportTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    return { valid: false };
  }

  if (payload.aud && payload.aud !== expectedAudience) {
    return { valid: false };
  }

  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    return { valid: false };
  }

  if (!payload.uid) {
    return { valid: false };
  }

  if (payload.ori && requestOrigin && payload.ori !== requestOrigin) {
    return { valid: false };
  }

  return { valid: true, payload };
}

// Helper for base64 encoding strings (for legacy token format)
export function bufferFromString(str: string): { toString: (encoding: string) => string } {
  return {
    toString: (encoding: string) => {
      if (encoding === "base64") {
        return btoa(str);
      }
      return str;
    }
  };
}

// Helper for base64 decoding (for legacy token format)
export function bufferFromBase64(data: string): { toString: (encoding: string) => string } {
  return {
    toString: (encoding: string) => {
      if (encoding === "utf8") {
        return atob(data);
      }
      return data;
    }
  };
}