/* Admin user management: GET /api/users, PUT /api/users/:id { role }, DELETE /api/users/:id */
import { json, error, noContent, readBody, bodyError, idOr404 } from "../http.mjs";
import { ROLES, publicUser } from "../auth.mjs";

export async function users(ctx, id) {
  const { query, req } = ctx;
  if (!ctx.admin) return error("Unauthorized", 401);
  const userId = idOr404(id);
  if (userId === null) return error("Not found", 404);

  switch (req.method) {
    case "GET": {
      if (userId !== undefined) return error("Not found", 404);
      const { rows } = await query(
        `SELECT u.id, u.email, u.name, u.role, u.created_at,
                (SELECT count(*)::int FROM enrolments e WHERE e.user_id = u.id) AS enrolments,
                (SELECT COALESCE(sum(amount_cents), 0)::int FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS spent_cents,
                (SELECT count(*)::int FROM courses c WHERE c.owner_id = u.id) AS courses
           FROM users u ORDER BY u.created_at DESC LIMIT 500`);
      return json(rows);
    }
    case "PUT": {
      if (userId === undefined) return error("Not found", 404);
      const body = await readBody(req);
      if (body === "too-large") return bodyError(body);
      if (!body || !ROLES.includes(body.role)) return error(`role must be one of: ${ROLES.join(", ")}`, 400);
      if (ctx.user && ctx.user.id === userId && body.role !== "admin") return error("You can't remove your own admin role", 400);
      const { rows } = await query("UPDATE users SET role = $2 WHERE id = $1 RETURNING *", [userId, body.role]);
      return rows[0] ? json(publicUser(rows[0])) : error("User not found", 404);
    }
    case "DELETE": {
      if (userId === undefined) return error("Not found", 404);
      if (ctx.user && ctx.user.id === userId) return error("You can't delete your own account from here", 400);
      const res = await query("DELETE FROM users WHERE id = $1", [userId]);
      return res.rowCount ? noContent() : error("User not found", 404);
    }
    default:
      return error("Method not allowed", 405);
  }
}
