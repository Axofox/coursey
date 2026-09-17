/*
  /api/auth/*
    POST signup   { name, email, password }            → 201 user, sets cookie
    POST login    { email, password }                  → 200 user, sets cookie
    POST logout                                        → 204, clears cookie
    GET  me                                            → user or 401
    PUT  me       { name?, headline?, bio? }           → user
    PUT  password { current, password }                → 204
    POST forgot   { email }                            → 204 always (no account enumeration)
    POST reset    { token, password }                  → 204, all sessions revoked
    GET  check                                         → 204 if admin (session or break-glass token)
*/
import { json, error, noContent, readBody, bodyError, clean, isEmail } from "../http.mjs";
import {
  hashPassword, verifyPassword, passwordProblem, publicUser,
  createSession, destroySession, sessionCookie, clearedCookie, createResetToken, consumeResetToken,
} from "../auth.mjs";

const withCookie = (data, status, cookie) => json(data, status, { "Set-Cookie": cookie });

export async function auth(ctx, action) {
  const { query, req, url } = ctx;
  const m = req.method;

  if (action === "check" && m === "GET") return ctx.admin ? noContent() : error("Unauthorized", 401);

  if (action === "me" && m === "GET") return ctx.user ? json(publicUser(ctx.user)) : error("Unauthorized", 401);

  if (action === "logout" && m === "POST") {
    await destroySession(query, req);
    return noContent({ "Set-Cookie": clearedCookie(url) });
  }

  const body = ["signup", "login", "forgot", "reset", "me", "password"].includes(action) ? await readBody(req) : {};
  if (!body || body === "too-large") return bodyError(body);

  switch (action + " " + m) {
    case "signup POST": {
      const name = clean(body.name, 120);
      const email = clean(body.email, 200).toLowerCase();
      const problem = passwordProblem(body.password);
      if (!name) return error("Please add your name", 400);
      if (!isEmail(email)) return error("Please enter a valid email address", 400);
      if (problem) return error(problem, 400);
      const exists = await query("SELECT 1 FROM users WHERE lower(email) = $1", [email]);
      if (exists.rowCount) return error("An account with that email already exists — try signing in", 409);
      // The first account, or one created with the break-glass token, is an admin.
      const { rows: count } = await query("SELECT count(*)::int AS n FROM users");
      const role = count[0].n === 0 || ctx.breakGlass ? "admin" : "learner";
      const { rows } = await query(
        "INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING *",
        [email, name, await hashPassword(body.password), role]
      );
      const token = await createSession(query, rows[0].id, req.headers.get("user-agent"));
      ctx.notify("welcome", rows[0]);
      return withCookie(publicUser(rows[0]), 201, sessionCookie(token, url));
    }
    case "login POST": {
      const email = clean(body.email, 200).toLowerCase();
      const { rows } = await query("SELECT * FROM users WHERE lower(email) = $1", [email]);
      const ok = rows[0] && (await verifyPassword(String(body.password || ""), rows[0].password_hash));
      if (!ok) return error("Wrong email or password", 401);
      const token = await createSession(query, rows[0].id, req.headers.get("user-agent"));
      return withCookie(publicUser(rows[0]), 200, sessionCookie(token, url));
    }
    case "me PUT": {
      if (!ctx.user) return error("Unauthorized", 401);
      const name = body.name !== undefined ? clean(body.name, 120) : undefined;
      if (name === "") return error("Name cannot be empty", 400);
      const headline = body.headline !== undefined ? clean(body.headline, 200) : undefined;
      const bio = body.bio !== undefined ? clean(body.bio, 2000) : undefined;
      const { rows } = await query(
        "UPDATE users SET name = COALESCE($2, name), headline = COALESCE($3, headline), bio = COALESCE($4, bio) WHERE id = $1 RETURNING *",
        [ctx.user.id, name, headline, bio]
      );
      return json(publicUser(rows[0]));
    }
    case "password PUT": {
      if (!ctx.user) return error("Unauthorized", 401);
      if (!(await verifyPassword(String(body.current || ""), ctx.user.password_hash))) return error("Current password is wrong", 401);
      const problem = passwordProblem(body.password);
      if (problem) return error(problem, 400);
      await query("UPDATE users SET password_hash = $2 WHERE id = $1", [ctx.user.id, await hashPassword(body.password)]);
      return noContent();
    }
    case "forgot POST": {
      const email = clean(body.email, 200).toLowerCase();
      const { rows } = await query("SELECT * FROM users WHERE lower(email) = $1", [email]);
      if (rows[0]) {
        const token = await createResetToken(query, rows[0].id);
        ctx.notify("reset", { user: rows[0], link: `${ctx.siteUrl}/reset.html?token=${encodeURIComponent(token)}` });
      }
      return noContent(); // same answer whether or not the account exists
    }
    case "reset POST": {
      const problem = passwordProblem(body.password);
      if (problem) return error(problem, 400);
      const userId = await consumeResetToken(query, body.token);
      if (!userId) return error("This reset link is invalid or has expired", 400);
      await query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, await hashPassword(body.password)]);
      await query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      return noContent({ "Set-Cookie": clearedCookie(url) });
    }
    default:
      return error("Not found", 404);
  }
}
