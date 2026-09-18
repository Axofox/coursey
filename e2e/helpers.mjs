// Shared e2e helpers: accounts through the real API on the dev server.
export async function signup(page, { name, email, password = "e2e-password-1" }) {
  const res = await page.request.post("/api/auth/signup", { data: { name, email, password } });
  if (!res.ok()) throw new Error("signup failed: " + (await res.text()));
  return res.json();
}
export async function login(page, email, password = "e2e-password-1") {
  const res = await page.request.post("/api/auth/login", { data: { email, password } });
  if (!res.ok()) throw new Error("login failed: " + (await res.text()));
  return res.json();
}
export async function logout(page) {
  await page.request.post("/api/auth/logout");
}
// The first account on a fresh database is the admin.
export async function seedAdmin(page) {
  return signup(page, { name: "Sam Admin", email: "admin@example.com" });
}
export async function mail(page) {
  return (await page.request.get("/__test/mail")).json();
}
