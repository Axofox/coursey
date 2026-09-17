/*
  Accounts: password hashing (scrypt, Node built-in), cookie sessions stored in
  Postgres, and one-time tokens for password reset. No third-party service.

  Cookie: ch_session — httpOnly, SameSite=Lax, Secure on https, 30 days.
  Only a SHA-256 of the session token is stored, so a database leak does not
  hand out live sessions.
*/
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
export const SESSION_COOKIE = "ch_session";
export const SESSION_DAYS = 30;
export const RESET_MINUTES = 60;
export const ROLES = ["learner", "instructor", "admin"];

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, n, salt, hash] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const key = await scrypt(password, salt, SCRYPT.keylen, { ...SCRYPT, N: Number(n) });
  const expected = Buffer.from(hash, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 200) return "That password is too long.";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "Mix letters and numbers.";
  return "";
}

export const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, created_at: u.created_at });

/* ---------- Sessions ---------- */

export async function createSession(query, userId, userAgent = "") {
  const token = newToken();
  await query(
    `INSERT INTO sessions (token_hash, user_id, user_agent, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
    [sha256(token), userId, String(userAgent).slice(0, 300), String(SESSION_DAYS)]
  );
  return token;
}

export function readCookie(req, name) {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

export async function sessionUser(query, req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const { rows } = await query(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)]
  );
  return rows[0] || null;
}

export async function destroySession(query, req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}

export function sessionCookie(token, url) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}
export function clearedCookie(url) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/* ---------- Password reset ---------- */

export async function createResetToken(query, userId) {
  const token = newToken();
  await query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
  await query(
    "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval)",
    [sha256(token), userId, String(RESET_MINUTES)]
  );
  return token;
}

// Returns the user id the token belongs to, or null. Marks it used.
export async function consumeResetToken(query, token) {
  const { rows } = await query(
    `UPDATE password_resets SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [sha256(String(token || ""))]
  );
  return rows[0] ? rows[0].user_id : null;
}
