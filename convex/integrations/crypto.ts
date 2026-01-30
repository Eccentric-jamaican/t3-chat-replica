/**
 * AES-256-GCM encryption using Web Crypto API (works in Convex V8 runtime).
 * Format: base64(iv):base64(authTag):base64(ciphertext)
 * Requires ENCRYPTION_KEY env var (64-character hex string = 32 bytes).
 */

function hexToUint8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getKey(): Promise<CryptoKey> {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be a 64-character hex string (32 bytes)",
    );
  }
  const keyBytes = hexToUint8(hex);
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns a string in the format: base64(iv):base64(authTag):base64(ciphertext)
 */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );

  // Web Crypto appends the 16-byte auth tag to the ciphertext
  const result = new Uint8Array(ciphertextWithTag);
  const tag = result.slice(-16);
  const ciphertext = result.slice(0, -16);

  return `${uint8ToBase64(iv)}:${uint8ToBase64(tag)}:${uint8ToBase64(ciphertext)}`;
}

/**
 * Decrypts a token previously encrypted with encrypt().
 * Expects format: base64(iv):base64(authTag):base64(ciphertext)
 */
export async function decrypt(token: string): Promise<string> {
  const key = await getKey();
  const parts = token.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }

  const iv = base64ToUint8(parts[0]!);
  const tag = base64ToUint8(parts[1]!);
  const ciphertext = base64ToUint8(parts[2]!);

  // Web Crypto expects ciphertext + tag concatenated
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    combined,
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Both strings must be the same length; returns false immediately
 * if lengths differ (length is not secret in HMAC-hex comparisons).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Computes HMAC-SHA256 and returns hex digest.
 * Used for WhatsApp webhook signature verification.
 */
export async function hmacSha256Hex(
  secret: string,
  data: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );

  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
