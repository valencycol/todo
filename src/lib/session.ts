const SESSION_COOKIE = "todo_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const SUPERUSER_COOKIE = "todo_su";
const SUPERUSER_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — auto-expires even if never explicitly disabled

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(sig);
}

async function createSignedCookieValue(secret: string, ttlMs: number): Promise<string> {
  const expiresAt = Date.now() + ttlMs;
  const payload = String(expiresAt);
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

async function verifySignedCookieValue(value: string | undefined, secret: string): Promise<boolean> {
  if (!value) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  const expected = await sign(payload, secret);
  if (expected.length !== signature.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff !== 0) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

function cookieHeader(name: string, value: string, ttlMs: number): string {
  const maxAge = Math.floor(ttlMs / 1000);
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(name: string, cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

export async function createSessionCookieValue(secret: string): Promise<string> {
  return createSignedCookieValue(secret, SESSION_TTL_MS);
}
export async function verifySessionCookieValue(value: string | undefined, secret: string): Promise<boolean> {
  return verifySignedCookieValue(value, secret);
}
export function sessionCookieHeader(value: string): string {
  return cookieHeader(SESSION_COOKIE, value, SESSION_TTL_MS);
}
export function clearSessionCookieHeader(): string {
  return clearCookieHeader(SESSION_COOKIE);
}
export function readSessionCookie(cookieHeader: string | null): string | undefined {
  return readCookie(SESSION_COOKIE, cookieHeader);
}

export async function createSuperuserCookieValue(secret: string): Promise<string> {
  return createSignedCookieValue(secret, SUPERUSER_TTL_MS);
}
export async function verifySuperuserCookieValue(value: string | undefined, secret: string): Promise<boolean> {
  return verifySignedCookieValue(value, secret);
}
export function superuserCookieHeader(value: string): string {
  return cookieHeader(SUPERUSER_COOKIE, value, SUPERUSER_TTL_MS);
}
export function clearSuperuserCookieHeader(): string {
  return clearCookieHeader(SUPERUSER_COOKIE);
}
export function readSuperuserCookie(cookieHeader: string | null): string | undefined {
  return readCookie(SUPERUSER_COOKIE, cookieHeader);
}
