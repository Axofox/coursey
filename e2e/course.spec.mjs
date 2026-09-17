import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => { await request.post("/api/_reset"); });

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

  test("checkout validates the card form and never charges", async ({ page }) => {
    await page.goto("/course-detail.html?id=1");
    await page.locator("[data-cart-toggle]").click();
    await page.goto("/cart.html");
    await page.locator("[data-pay-total]").click();
    await expect(page.locator('[data-error-for="cc-name"]')).toBeVisible();
    await page.locator("#cc-name").fill("Alex Rivera");
    await page.locator("#cc-number").fill("4242 4242 4242 4242");
    await page.locator("#cc-expiry").fill("12 / 39");
    await page.locator("#cc-cvc").fill("123");
    await page.locator("#cc-postal").fill("81675");
    await page.locator("[data-pay-total]").click();
    await expect(page.locator(".toast")).toContainText("nothing was charged");
  });

  test("review form validates then submits as pending", async ({ page }) => {
    await page.goto("/course-detail.html?id=3");
    const form = page.locator("[data-review-form]");
    await form.locator("button[type=submit]").click();
    await expect(form.locator('[data-error-for="name"]')).toHaveText("Your name is required.");
    await form.locator("[name=name]").fill("Ana");
    await form.locator("[name=rating]").selectOption("5");
    await form.locator("[name=body]").fill("Really clear and practical, built a case study.");
    await form.locator("button[type=submit]").click();
    await expect(form.locator("[data-review-done]")).toBeVisible();
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
