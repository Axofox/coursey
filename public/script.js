/* ---------- Theme handling (shared across all pages) ---------- */
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch (e) {}
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  updateToggleLabel(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (e) {}
  updateToggleLabel(next);
}

function updateToggleLabel(theme) {
  const btn = document.querySelector("[data-theme-toggle]");
  if (btn) btn.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

/* ---------- Mobile nav ---------- */
function initMobileNav() {
  const btn = document.querySelector("[data-menu-btn]");
  const links = document.querySelector("[data-nav-links]");
  if (!btn || !links) return;
  btn.addEventListener("click", () => links.classList.toggle("open"));
}

/* ---------- Homepage: render categories ---------- */
async function renderHomeCategories() {
  const grid = document.querySelector("[data-category-grid]");
  if (!grid) return;
  grid.innerHTML = `<p class="muted">Loading…</p>`;
  let categories;
  try {
    categories = await fetchCategories();
  } catch (e) {
    grid.innerHTML = `<p class="muted">Couldn't load categories right now. Please try again in a moment.</p>`;
    return;
  }
  if (!categories.length) {
    grid.innerHTML = `<p class="muted">No categories yet.</p>`;
    return;
  }
  grid.innerHTML = categories.map((cat) => `
    <a class="card category-block" href="category.html?id=${encodeURIComponent(cat.id)}">
      <span class="tag">${cat.courses.length} course${cat.courses.length === 1 ? "" : "s"}</span>
      <h3>${escapeHtml(cat.name)}</h3>
      <p>${escapeHtml(cat.description)}</p>
    </a>
  `).join("");
}

/* ---------- Category page ---------- */
async function renderCategoryPage() {
  const container = document.querySelector("[data-category-page]");
  if (!container) return;
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  container.innerHTML = `<p class="muted">Loading…</p>`;

  let cat = null;
  try {
    cat = id ? await fetchCategory(id) : null;
  } catch (e) {
    if (e.status !== 404) {
      container.innerHTML = `<p class="muted">Couldn't load this category right now.</p>`;
      return;
    }
  }
  if (!cat) {
    container.innerHTML = `<h1>Category not found</h1><p class="muted">It may have been removed.</p>`;
    return;
  }

  document.title = cat.name + " — Course Site";
  container.innerHTML = `
    <h1>${escapeHtml(cat.name)}</h1>
    <p class="muted" style="max-width:520px;">${escapeHtml(cat.description)}</p>
    <div class="grid" style="margin-top:32px;">
      ${cat.courses.length ? cat.courses.map((course) => `
        <div class="card">
          <span class="tag">${escapeHtml(course.level)}</span>
          <h3>${escapeHtml(course.title)}</h3>
          ${course.description ? `<p>${escapeHtml(course.description)}</p>` : ""}
          <div class="meta">
            <span>${course.lessons} lesson${course.lessons === 1 ? "" : "s"}</span>
            <span>Preview</span>
          </div>
        </div>
      `).join("") : `<p class="muted">No courses in this category yet.</p>`}
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initMobileNav();
  renderHomeCategories();
  renderCategoryPage();
  if (typeof initAdmin === "function") initAdmin();

  const toggleBtn = document.querySelector("[data-theme-toggle]");
  if (toggleBtn) toggleBtn.addEventListener("click", toggleTheme);
});
