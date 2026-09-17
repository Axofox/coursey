/*
  Transactional email via Resend's REST API (no SDK). Without RESEND_API_KEY the
  message is logged instead of sent, so local development and CI work without
  an account and password-reset links show up in the function logs.

  Env: RESEND_API_KEY, MAIL_FROM (e.g. "Coursehub <hello@yourdomain.com>"),
       SITE_URL (used in links; defaults to the request origin).
*/

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#FDF6EC;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#17171A;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="font-weight:700;font-size:18px;margin-bottom:24px;">Coursehub</div>
    <div style="background:#fff;border:1px solid #ECE1CC;border-radius:16px;padding:28px;">
      <h1 style="font-size:20px;margin:0 0 12px;">${esc(title)}</h1>
      ${bodyHtml}
    </div>
    <p style="font-size:12px;color:#8B8B92;margin-top:20px;">You received this because of an action on your Coursehub account.</p>
  </div></body></html>`;
}
const button = (href, label) =>
  `<p style="margin:20px 0;"><a href="${esc(href)}" style="display:inline-block;background:#FF6B47;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;">${esc(label)}</a></p>`;
const p = (text) => `<p style="font-size:15px;line-height:1.6;color:#55555C;margin:0 0 12px;">${esc(text)}</p>`;

export const templates = {
  welcome: ({ name, siteUrl }) => ({
    subject: "Welcome to Coursehub",
    html: layout(`Welcome, ${name}!`, p("Your account is ready. Browse the catalog, save courses to your wishlist and pick up where you left off on any device.") + button(siteUrl + "/index.html", "Browse courses")),
    text: `Welcome, ${name}! Your Coursehub account is ready: ${siteUrl}/index.html`,
  }),
  reset: ({ name, link }) => ({
    subject: "Reset your Coursehub password",
    html: layout("Reset your password", p(`Hi ${name}, someone asked to reset the password for this account. The link works for one hour. If that wasn't you, ignore this email.`) + button(link, "Choose a new password")),
    text: `Reset your Coursehub password (valid for one hour): ${link}`,
  }),
  purchase: ({ name, items, total, siteUrl }) => ({
    subject: "Your Coursehub purchase",
    html: layout("You're enrolled!", p(`Thanks, ${name}. Here's what you bought:`) +
      `<ul style="padding-left:18px;color:#55555C;font-size:15px;line-height:1.7;">${items.map((i) => `<li>${esc(i.title)} — $${(i.price_cents / 100).toFixed(2)}</li>`).join("")}</ul>` +
      p(`Total: $${(total / 100).toFixed(2)}`) + button(siteUrl + "/dashboard.html", "Start learning")),
    text: `Thanks, ${name}! You bought: ${items.map((i) => i.title).join(", ")}. Total $${(total / 100).toFixed(2)}. Start: ${siteUrl}/dashboard.html`,
  }),
  applicationApproved: ({ name, siteUrl }) => ({
    subject: "You're approved to teach on Coursehub",
    html: layout("Welcome aboard", p(`Hi ${name}, your instructor application was approved. Sign in and open Instructor Studio to create your first course. Courses go live after a quick review by our team.`) + button(siteUrl + "/seller-dashboard.html", "Open Instructor Studio")),
    text: `Hi ${name}, your instructor application was approved: ${siteUrl}/seller-dashboard.html`,
  }),
  coursePublished: ({ name, title, siteUrl, id }) => ({
    subject: `"${title}" is live on Coursehub`,
    html: layout("Your course is live", p(`Hi ${name}, "${title}" passed review and is now in the catalog.`) + button(`${siteUrl}/course-detail.html?id=${id}`, "See it live")),
    text: `"${title}" is live: ${siteUrl}/course-detail.html?id=${id}`,
  }),
};

export async function sendMail({ to, subject, html, text }, { fetchImpl = fetch, log = console.log } = {}) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || "Coursehub <onboarding@resend.dev>";
  if (!key) {
    log(`[mail] (not sent — RESEND_API_KEY unset) to=${to} subject="${subject}"\n${text}`);
    return { sent: false };
  }
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    log(`[mail] Resend error ${res.status}: ${await res.text()}`);
    return { sent: false };
  }
  return { sent: true };
}
