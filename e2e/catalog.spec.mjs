import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => { await request.post("/__test/reset"); });

test.describe("catalog", () => {
  test("home shows categories, featured courses, bundles and live stats", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-category-grid] a")).toHaveCount(6);
    await expect(page.locator("[data-course-grid] a.course-card")).toHaveCount(8);
    await expect(page.locator("[data-bundle-grid] a")).toHaveCount(3);
    await expect(page.locator('[data-stat="courses"]')).toHaveText("8");
    await expect(page.locator("[data-hero-badge]")).toContainText("8 courses");
  });

  test("search filters the grid and is reflected in the URL", async ({ page }) => {
    await page.goto("/");
    await page.locator("#hero-search").fill("sql");
    await page.locator("#hero-search").press("Enter");
    await expect(page.locator("[data-catalog-title]")).toHaveText("Results for “sql”");
    await expect(page.locator("[data-course-grid] a.course-card")).toHaveCount(1);
    await expect(page).toHaveURL(/q=sql/);
    await page.locator("[data-catalog-viewall]").click();
    await expect(page.locator("[data-catalog-title]")).toHaveText("Featured courses");
  });

  test("category cards filter without a reload and the back button restores", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-category-link="data"]').click();
    await expect(page.locator("[data-catalog-title]")).toHaveText("Data courses");
    await expect(page.locator("[data-course-grid] a.course-card")).toHaveCount(3);
    await page.goBack();
    await expect(page.locator("[data-catalog-title]")).toHaveText("Featured courses");
  });

  test("no results state", async ({ page }) => {
    await page.goto("/?q=zzzz-nothing");
    await expect(page.locator("[data-course-grid]")).toContainText("No courses found");
  });

  test("wishlist heart persists across reloads", async ({ page }) => {
    await page.goto("/");
    const heart = page.locator("[data-wishlist-toggle]").first();
    await heart.click();
    await expect(heart).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.locator("[data-wishlist-toggle]").first()).toHaveAttribute("aria-pressed", "true");
  });

  test("unknown pages get the 404 page", async ({ page }) => {
    const res = await page.goto("/nope.html");
    expect(res.status()).toBe(404);
    await expect(page.locator("h1")).toContainText("doesn’t exist");
  });
});
