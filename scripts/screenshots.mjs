// Regenerates docs/screenshots/*.png and docs/demo.webm.
// Usage: npm run dev (in another terminal) && node scripts/screenshots.mjs
import { chromium } from "@playwright/test";

const base = "http://localhost:8765";
const shots = [
  ["home", "/", "light"], ["home-dark", "/", "dark"],
  ["course", "/course-detail.html?id=1", "light"], ["course-dark", "/course-detail.html?id=1", "dark"],
  ["lesson", "/lesson.html?course=1&s=0&l=0", "light"],
  ["cart", "/cart.html", "light"],
  ["admin", "/admin-dashboard.html?tab=courses", "dark"],
  ["editor", "/course-upload.html?id=1", "light"],
  ["dashboard", "/dashboard.html", "light"],
  ["signup", "/signup.html", "dark"],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(base + "/");
await page.request.post(base + "/__test/reset");
await page.request.post(base + "/api/auth/signup", { data: { name: "Sam Lindqvist", email: "sam@example.com", password: "screenshot-pass-1" } }); // first account = admin
await page.evaluate(() => {
  localStorage.setItem("coursehub-cart", JSON.stringify([{ key: "course-1", kind: "course", id: 1, title: "UX Foundations: Research to Wireframe", price: 49, subtitle: "Maya Chen", icon_bg: "#EDEBFB", href: "course-detail.html?id=1" }]));
});
for (const [name, path, theme] of shots) {
  await page.evaluate((t) => localStorage.setItem("coursehub-theme", t), theme);
  await page.goto(base + path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: name === "course" });
  console.log("saved", name);
}
await ctx.close();

// Short demo: browse → course → add to cart → cart
const vctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: "docs/", size: { width: 1280, height: 800 } } });
const v = await vctx.newPage();
await v.goto(base + "/");
await v.waitForLoadState("networkidle");
await v.locator("#hero-search").fill("python");
await v.locator("#hero-search").press("Enter");
await v.waitForTimeout(900);
await v.locator("[data-course-grid] a.course-card").first().click();
await v.waitForLoadState("networkidle");
await v.waitForTimeout(700);
await v.locator("[data-cart-toggle]").click();
await v.waitForTimeout(700);
await v.goto(base + "/cart.html");
await v.waitForTimeout(1200);
const video = v.video();
await vctx.close();
const { rename } = await import("node:fs/promises");
await rename(await video.path(), "docs/demo.webm");
console.log("saved docs/demo.webm");
await browser.close();
