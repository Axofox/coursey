import { test, expect } from "@playwright/test";
import { signup, login, logout, seedAdmin, mail } from "./helpers.mjs";

test.beforeEach(async ({ request }) => { await request.post("/__test/reset"); });

// Buy the flagged test course (UX Foundations, id 1) through the stubbed Stripe.
async function buyTestCourse(page) {
  const r = await (await page.request.post("/api/checkout", { data: { items: [{ kind: "course", id: 1 }] } })).json();
  await page.request.get(r.url); // /__test/pay → webhook
}

test.describe("learner setup (test course only)", () => {
  test("unflagged courses are untouched: classic player, no setup", async ({ page }) => {
    await seedAdmin(page);
    await page.request.put("/api/courses/3", { data: { price: 0 } });
    await logout(page);
    await signup(page, { name: "Ana", email: "ana@example.com" });
    await page.goto("/course-detail.html?id=3");
    await expect(page.locator("[data-course-main]")).not.toContainText("Learner setup");
    await page.locator("[data-enrol-free]").click();
    await expect(page).toHaveURL(/lesson\.html\?course=3/);
    await expect(page.locator(".lesson-list")).not.toContainText("Checkpoint");
    expect((await page.request.get("/api/learn/3")).status()).toBe(404);
  });

  test("character-select → plan with checkpoints and reviews → grading → spaced review brings back misses", async ({ page }) => {
    await seedAdmin(page); await logout(page);
    await signup(page, { name: "Ana Lopez", email: "ana@example.com" });
    await buyTestCourse(page);

    await page.goto("/course-detail.html?id=1");
    await expect(page.locator("[data-course-main]")).toContainText("Learner setup");
    await page.locator("[data-course-aside] a.btn-primary").click(); // "Set up & start"
    await expect(page).toHaveURL(/setup\.html\?course=1/);
    await page.locator("[data-setup-form] button[type=submit]").click();
    await expect(page.locator('[data-error-for="pace"]')).toHaveText("Pick one to continue.");
    await expect(page.locator("#pace-cohort")).toBeDisabled(); // stub
    await page.locator('label[for="pace-sprint"]').click();
    await page.locator('label[for="practice-heavy"]').click();
    await page.locator('label[for="track-job_ready"]').click();
    await page.locator("[data-setup-form] button[type=submit]").click();

    await expect(page).toHaveURL(/lesson\.html\?course=1&step=0/);
    await expect(page.locator(".lesson-list")).toContainText("Sprint · Heavy practice · Job-ready");
    await expect(page.locator(".lesson-list .step-checkpoint")).toHaveCount(4);
    await expect(page.locator(".lesson-list .step-review")).toHaveCount(3);
    await expect(page.locator(".lesson-list .step-exercise").first()).toContainText("Write a one-page project brief"); // job-ready exercise
    await expect(page.locator("[data-lesson-main] .notice")).toContainText("Sprint pace");

    // First checkpoint: answer everything with option B (two right, two wrong)
    await page.locator(".lesson-list .step-checkpoint").first().click();
    await expect(page.locator("h1")).toHaveText("Checkpoint: Getting started");
    await expect(page.locator(".quiz-q")).toHaveCount(4);
    for (let i = 0; i < 4; i++) await page.locator(`input[name="q${i}"][value="1"]`).check();
    await page.locator("[data-quiz] button[type=submit]").click();
    await expect(page.locator("[data-quiz-result]")).toContainText("/ 4");
    await expect(page.locator(".quiz-opt.right")).toHaveCount(4);
    await expect(page.locator(".lesson-list .step-checkpoint").first()).toHaveClass(/done/);

    // The review after section 2 starts with what was missed
    await page.locator(".lesson-list .step-review").first().click();
    await expect(page.locator("h1")).toHaveText("Review: earlier material");
    await expect(page.locator(".quiz-q").first()).toContainText("In the UX process taught here"); // answered wrongly above (correct = User research)
  });

  test("settings are editable later in account settings, per course; nudge follows pace", async ({ page }) => {
    await seedAdmin(page); await logout(page);
    await signup(page, { name: "Ana", email: "ana@example.com" });
    await buyTestCourse(page);
    await page.request.put("/api/learn/1/settings", { data: { pace: "sprint", practice: "heavy", track: "project" } });

    await page.goto("/dashboard.html");
    await expect(page.locator("[data-nudges]")).toContainText("Sprint pace: aim for one lesson today");
    await page.goto("/dashboard.html?tab=settings");
    const f = page.locator("[data-learn-form]");
    await expect(f).toBeVisible();
    await expect(f.locator("[name=practice]")).toHaveValue("heavy");
    await f.locator("[name=pace]").selectOption("marathon");
    await f.locator("[name=practice]").selectOption("light");
    await f.locator("button[type=submit]").click();
    await expect(page.locator(".toast")).toContainText("Learning setup saved");
    const state = await (await page.request.get("/api/learn/1")).json();
    expect(state.settings.practice).toBe("light");
    expect(state.plan.filter((s) => s.type === "review")).toHaveLength(0);
    expect(state.nudge).toBeNull();
    await page.goto("/lesson.html?course=1");
    await expect(page.locator(".lesson-list")).toContainText("Marathon · Light practice");
  });

  test("admin sees the experiment comparison and can author questions", async ({ page }) => {
    await seedAdmin(page);
    await page.goto("/admin-dashboard.html?tab=reports");
    await expect(page.locator("[data-experiment-body]")).toContainText("Test (1)");
    await expect(page.locator("[data-experiment-body]")).toContainText("Control (7)");
    await page.goto("/course-upload.html?id=1");
    await expect(page.locator("[data-field=learner_setup]")).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-step-goto="2"]').click();
    const details = page.locator('[data-section="0"] details');
    await expect(details.locator("summary")).toContainText("Checkpoint questions (4)");
  });
});
