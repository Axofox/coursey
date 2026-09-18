import { test, expect } from "@playwright/test";
import { seedAdmin } from "./helpers.mjs";

// Creates the admin account (first signup) and opens the console signed in.
async function signIn(page) {
  await seedAdmin(page);
  await page.goto("/admin-dashboard.html");
  await expect(page.locator("[data-admin-app]")).toBeVisible();
}

test.describe("admin", () => {
  test.beforeEach(async ({ request }) => { await request.post("/__test/reset"); });

  test("account sign-in: wrong password, non-admin account, admin account, break-glass token", async ({ page }) => {
    await seedAdmin(page);
    await page.request.post("/api/auth/logout");
    await page.goto("/admin-dashboard.html");
    await page.locator("#admin-email").fill("admin@example.com");
    await page.locator("#admin-password").fill("wrong-password-1");
    await page.locator("[data-login-form] button[type=submit]").click();
    await expect(page.locator("[data-login-error]")).toHaveText("Wrong email or password.");
    await page.request.post("/api/auth/signup", { data: { name: "Ana", email: "ana@example.com", password: "ana-password-1" } });
    await page.request.post("/api/auth/logout");
    await page.locator("#admin-email").fill("ana@example.com");
    await page.locator("#admin-password").fill("ana-password-1");
    await page.locator("[data-login-form] button[type=submit]").click();
    await expect(page.locator("[data-login-error]")).toContainText("isn’t an admin");
    await page.locator("#admin-email").fill("admin@example.com");
    await page.locator("#admin-password").fill("e2e-password-1");
    await page.locator("[data-login-form] button[type=submit]").click();
    await expect(page.locator("[data-admin-app]")).toBeVisible();
    await expect(page.locator('[data-ov="courses"]')).toHaveText("8");
    await page.locator("[data-signout]").click();
    await page.locator("[data-login-mode]").click();
    await page.locator("#admin-token").fill("testtoken");
    await page.locator("[data-login-form] button[type=submit]").click();
    await expect(page.locator("[data-admin-app]")).toBeVisible();
  });

  test("courses table, unpublish hides from the catalog", async ({ page }) => {
    await signIn(page);
    await page.locator('[data-tab="courses"]').click();
    await expect(page.locator("[data-course-rows] .trow")).toHaveCount(8);
    await page.locator('[data-toggle-publish="8"]').click();
    await expect(page.locator('[data-course-row="8"]')).toContainText("Draft");
    expect(await (await page.request.get("/api/courses?q=machine+learning")).json()).toHaveLength(0); // gone from the catalog
    expect((await page.request.get("/api/courses/8")).status()).toBe(200); // but admins still see it
    await page.locator('[data-toggle-publish="8"]').click();
    await expect(page.locator('[data-course-row="8"]')).toContainText("Published");
  });

  test("category form validates and creates", async ({ page }) => {
    await signIn(page);
    await page.locator('[data-tab="categories"]').click();
    await page.locator("[data-category-form] button[type=submit]").click();
    await expect(page.locator('[data-category-form] [name="name"]')).toHaveAttribute("required", "");
    await page.locator("#cat-name").fill("Music Production");
    await page.locator("[data-category-form] button[type=submit]").click();
    await expect(page.locator(".toast")).toContainText("added");
    await expect(page.locator("[data-category-rows]")).toContainText("Music Production");
  });

  test("review moderation approves a pending review", async ({ page }) => {
    await signIn(page);
    await page.request.post("/api/reviews", { data: { course_id: 1, rating: 5, body: "Clear, structured, and actually project-based." } });
    await page.goto("/admin-dashboard.html?tab=reviews");
    const pendingBefore = await page.locator('[data-review-status="approved"]').count();
    expect(pendingBefore).toBeGreaterThan(0);
    await page.locator('[data-review-status="approved"]').first().click();
    await expect(page.locator(".toast")).toContainText("Review published");
    await page.locator('[data-review-filter="approved"]').click();
    await expect(page.locator('[data-review-status="pending"]')).toHaveCount(1);
  });

  test("bundle form requires two courses", async ({ page }) => {
    await signIn(page);
    await page.locator('[data-tab="bundles"]').click();
    await page.locator("#bn-name").fill("Tiny");
    await page.locator("#bn-price").fill("10");
    await page.locator("[data-bundle-form] button[type=submit]").click();
    await expect(page.locator('[data-error-for="course_ids"]')).toHaveText("Pick at least two courses.");
  });

  test("editor creates a draft course that shows in the admin table", async ({ page }) => {
    await seedAdmin(page);
    await page.goto("/course-upload.html");
    await expect(page.locator("[data-admin-app]")).toBeVisible();
    await page.locator('[data-step-goto="4"]').click(); // jump straight to publish with an empty form
    await page.locator("[data-publish]").click();
    await expect(page.locator('[data-error-for="title"]')).toHaveText("A course title is required.");
    await page.locator("#cu-title").fill("Playwright 101"); // validation jumped back to step 1
    await page.locator('[data-step-goto="3"]').click();
    await page.locator("#cu-price").fill("25");
    await page.locator("[data-save-draft]").first().click();
    await expect(page.locator(".toast")).toContainText("Draft saved");
    await expect(page).toHaveURL(/course-upload\.html\?id=\d+/);
    await page.goto("/admin-dashboard.html?tab=courses");
    const row = page.locator("[data-course-rows] .trow", { hasText: "Playwright 101" });
    await expect(row).toContainText("Draft");
  });
});
