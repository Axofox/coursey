import { test, expect } from "@playwright/test";
import { signup, login, logout, seedAdmin, mail } from "./helpers.mjs";

test.beforeEach(async ({ request }) => { await request.post("/__test/reset"); });

test.describe("accounts", () => {
  test("sign up from the form, land on the dashboard, account menu shows", async ({ page }) => {
    await page.goto("/signup.html");
    await page.locator("[name=name]").fill("Ana Lopez");
    await page.locator("[name=email]").fill("ana@example.com");
    await page.locator("[name=password]").fill("short");
    await page.locator("button[type=submit]").click();
    await expect(page.locator('[data-error-for="password"]')).toContainText("at least 10");
    await page.locator("[name=password]").fill("ana-password-1");
    await page.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/dashboard\.html/);
    await expect(page.locator("[data-me-name]")).toHaveText("Ana Lopez");
    await page.goto("/");
    await page.locator(".account-avatar").click();
    await expect(page.locator(".account-dropdown")).toContainText("ana@example.com");
    await page.locator("[data-signout]").click();
    await expect(page).toHaveURL(/index\.html/);
    await expect(page.locator("[data-account-menu]")).toContainText("Sign in");
  });

  test("wrong password is rejected; login redirects to ?next", async ({ page }) => {
    await signup(page, { name: "Ana", email: "ana@example.com" });
    await logout(page);
    await page.goto("/login.html?next=cart.html");
    await page.locator("[name=email]").fill("ana@example.com");
    await page.locator("[name=password]").fill("wrong-password-1");
    await page.locator("button[type=submit]").click();
    await expect(page.locator("[data-auth-error]")).toHaveText("Wrong email or password");
    await page.locator("[name=password]").fill("e2e-password-1");
    await page.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/cart\.html/);
  });

  test("password reset via the emailed link", async ({ page }) => {
    await signup(page, { name: "Ana", email: "ana@example.com" });
    await logout(page);
    await page.goto("/forgot.html");
    await page.locator("[name=email]").fill("ana@example.com");
    await page.locator("button[type=submit]").click();
    await expect(page.locator("[data-auth-done]")).toBeVisible();
    const msgs = await mail(page);
    const link = /reset\.html\?token=[^\s"]+/.exec(msgs.at(-1).text)[0];
    await page.goto("/" + link);
    await page.locator("[name=password]").fill("new-password-22");
    await page.locator("[name=confirm]").fill("new-password-22");
    await page.locator("button[type=submit]").click();
    await expect(page.locator("[data-auth-done]")).toContainText("Password saved");
    await login(page, "ana@example.com", "new-password-22");
  });

  test("buy a course and a bundle, then learn to a certificate", async ({ page }) => {
    await seedAdmin(page);
    await logout(page);
    await signup(page, { name: "Ana Lopez", email: "ana@example.com" });
    await page.goto("/course-detail.html?id=2");
    await page.locator("[data-cart-toggle]").click();
    await page.goto("/bundle.html?id=1");
    await page.locator("[data-cart-toggle]").click();
    await page.goto("/cart.html");
    await expect(page.locator("[data-cart-row]")).toHaveCount(2);
    await expect(page.locator("[data-cart-total]")).toHaveText("$143");
    await page.locator("[data-pay-total]").click(); // → stubbed Stripe → webhook → success page
    await expect(page).toHaveURL(/checkout-success\.html\?order=\d+/);
    await expect(page.locator("[data-order-state]")).toContainText("You’re enrolled");
    await expect(page.locator("[data-cart-badge]")).toBeHidden();

    await page.goto("/dashboard.html?tab=courses");
    await expect(page.locator("[data-course-list] .card")).toHaveCount(4); // 1 course + 3 in the bundle
    await page.goto("/course-detail.html?id=2");
    await expect(page.locator("[data-course-aside]")).toContainText("Start learning");

    // Watch every lesson of the 6-lesson course
    await page.goto("/lesson.html?course=7&s=0&l=0");
    await expect(page.locator(".player")).not.toContainText("Unlock");
    for (let i = 0; i < 5; i++) await page.locator("[data-lesson-main] button[data-goto]").last().click();
    await expect(page.locator(".toast")).toContainText("certificate");
    await page.goto("/dashboard.html?tab=awards");
    await expect(page.locator("[data-certificates] .card")).toHaveCount(1);
    await page.locator("[data-certificates] a").click();
    await expect(page.locator(".cert")).toContainText("Ana Lopez");
    await expect(page.locator(".cert")).toContainText("Figma to Front-End Handoff");
    // The certificate is publicly verifiable
    const url = page.url();
    await logout(page);
    await page.goto(url);
    await expect(page.locator(".cert")).toContainText("Ana Lopez");
  });

  test("free course enrols directly; paid lessons stay locked without purchase", async ({ page }) => {
    const admin = await seedAdmin(page);
    await page.request.put("/api/courses/3", { data: { price: 0 } });
    await logout(page);
    await signup(page, { name: "Ana", email: "ana@example.com" });
    await page.goto("/course-detail.html?id=3");
    await page.locator("[data-enrol-free]").click();
    await expect(page).toHaveURL(/lesson\.html\?course=3/);
    await page.goto("/lesson.html?course=1&s=0&l=1");
    await expect(page.locator(".player")).toContainText("Unlock this lesson");
  });

  test("review needs an account and lands as pending", async ({ page }) => {
    await page.goto("/course-detail.html?id=1");
    await expect(page.locator("[data-review-signin]")).toBeVisible();
    await signup(page, { name: "Ana", email: "ana@example.com" });
    await page.goto("/course-detail.html?id=1");
    await page.locator("[name=rating]").selectOption("5");
    await page.locator("[name=body]").fill("Really clear and practical, built a case study.");
    await page.locator("[data-review-form] button[type=submit]").click();
    await expect(page.locator("[data-review-done]")).toBeVisible();
    await expect(page.locator("#reviews")).toContainText("No reviews yet"); // pending until approved
  });
});

test.describe("instructors", () => {
  test("apply → approved → create course → admin publishes → live", async ({ page }) => {
    await seedAdmin(page);
    await logout(page);
    await signup(page, { name: "Maya Chen", email: "maya@example.com" });
    await page.goto("/teach.html");
    await expect(page.locator("[name=email]")).toHaveValue("maya@example.com");
    await page.locator("[name=expertise]").fill("Design systems");
    await page.locator("[name=bio]").fill("Ten years designing at Figma and Airbnb.");
    await page.locator("button[type=submit]").click();
    await expect(page.locator("[data-apply-done]")).toBeVisible();

    await logout(page);
    await login(page, "admin@example.com");
    await page.goto("/admin-dashboard.html?tab=instructors");
    await page.locator('[data-app-status="approved"]').click();
    await expect(page.locator(".toast")).toContainText("approved");
    expect((await mail(page)).at(-1).subject).toContain("approved to teach");

    await logout(page);
    await login(page, "maya@example.com");
    await page.goto("/course-upload.html");
    await expect(page.locator("[data-publish]")).toHaveText("Submit for review");
    await expect(page.locator('[data-admin-only]').first()).toBeHidden();
    await page.locator("#cu-title").fill("Design Tokens in Practice");
    await page.locator('[data-step-goto="3"]').click();
    await page.locator("#cu-price").fill("39");
    await page.locator('[data-step-goto="4"]').click();
    await page.locator("[data-publish]").click();
    await expect(page).toHaveURL(/seller-dashboard\.html/);
    await expect(page.locator("[data-my-courses]")).toContainText("Pending review");
    expect((await page.request.get("/api/courses?q=tokens")).ok()).toBeTruthy();
    expect(await (await page.request.get("/api/courses?q=tokens")).json()).toHaveLength(0);

    await logout(page);
    await login(page, "admin@example.com");
    await page.goto("/admin-dashboard.html?tab=courses");
    await page.locator('[data-course-status="pending"]').click();
    await expect(page.locator("[data-course-rows]")).toContainText("Design Tokens in Practice");
    await page.locator("[data-toggle-publish]").click();
    await expect(page.locator(".toast")).toContainText("is live");
    expect(await (await page.request.get("/api/courses?q=tokens")).json()).toHaveLength(1);
    expect((await mail(page)).at(-1).subject).toContain("is live");
  });
});
