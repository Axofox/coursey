import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => { await request.post("/__test/reset"); });

test.describe("course, cart, lesson", () => {
  test("course page renders from the record", async ({ page }) => {
    await page.goto("/course-detail.html?id=1");
    await expect(page.locator("h1")).toHaveText("UX Foundations: Research to Wireframe");
    await expect(page.locator("[data-breadcrumb]")).toContainText("Design");
    await expect(page.locator("text=Course content")).toBeVisible();
    await expect(page.locator("[data-course-aside]")).toContainText("$49");
    await expect(page.locator("[data-course-aside]")).toContainText("45% off");
  });

  test("add to cart → cart page → remove → empty state", async ({ page }) => {
    await page.goto("/course-detail.html?id=2");
    await page.locator("[data-cart-toggle]").click();
    await expect(page.locator("[data-cart-toggle]")).toHaveText("Added to cart");
    await expect(page.locator("[data-cart-badge]")).toHaveText("1");
    await page.goto("/cart.html");
    await expect(page.locator("[data-cart-row]")).toHaveCount(1);
    await expect(page.locator("[data-cart-subtotal]")).toHaveText("$54");
    await page.locator("[data-remove-row]").click();
    await expect(page.locator("[data-cart-empty]")).toBeVisible();
    await expect(page.locator("[data-cart-count]")).toHaveText("0");
  });

  test("checkout asks visitors to sign in and never charges from the browser", async ({ page }) => {
    await page.goto("/course-detail.html?id=1");
    await page.locator("[data-cart-toggle]").click();
    await page.goto("/cart.html");
    await expect(page.locator("[data-checkout-signin]")).toBeVisible();
    await page.locator("[data-pay-total]").click();
    await expect(page).toHaveURL(/login\.html\?next=cart\.html/);
  });

  test("review form is gated behind sign-in", async ({ page }) => {
    await page.goto("/course-detail.html?id=3");
    await expect(page.locator("[data-review-signin]")).toBeVisible();
    await expect(page.locator("[data-review-fields]")).toBeHidden();
    await expect(page.locator("[data-review-signin] a")).toHaveAttribute("href", /login\.html\?next=course-detail/);
  });

  test("lesson player gates non-preview lessons and navigates", async ({ page }) => {
    await page.goto("/lesson.html?course=1&s=0&l=0");
    await expect(page.locator("h1")).toHaveText("Welcome & how this course works");
    await expect(page.locator(".player")).not.toContainText("Unlock this lesson");
    await page.locator("[data-lesson-main] [data-goto]").last().click();
    await expect(page.locator("h1")).toHaveText("Setting up Figma");
    await expect(page.locator(".player")).toContainText("Unlock this lesson");
    await expect(page.locator(".lesson-list .lesson.active")).toContainText("Setting up Figma");
  });

  test("bundle page lists its courses and adds a single line to the cart", async ({ page }) => {
    await page.goto("/bundle.html?id=1");
    await expect(page.locator("h1")).toHaveText("Product Design Career Path");
    await expect(page.locator("[data-bundle-main] a.course-card")).toHaveCount(3);
    await page.locator("[data-cart-toggle]").click();
    await page.goto("/cart.html");
    await expect(page.locator("[data-cart-row]")).toHaveCount(1);
    await expect(page.locator("[data-cart-row]")).toContainText("Bundle");
  });
});
