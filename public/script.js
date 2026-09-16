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
function renderHomeCategories() {
  const grid = document.querySelector("[data-category-grid]");
  if (!grid) return;
  const categories = loadCategories();
  grid.innerHTML = categories.map((cat) => `
    <a class="card category-block" href="category.html?id=${encodeURIComponent(cat.id)}">
      <span class="tag">${cat.courses.length} course${cat.courses.length === 1 ? "" : "s"}</span>
      <h3>${escapeHtml(cat.name)}</h3>
      <p>${escapeHtml(cat.description)}</p>
    </a>
  `).join("");
}

/* ---------- Category page ---------- */
function renderCategoryPage() {
  const container = document.querySelector("[data-category-page]");
  if (!container) return;
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const categories = loadCategories();
  const cat = categories.find((c) => c.id === id) || categories[0];

  if (!cat) {
    container.innerHTML = "<p>No categories yet. Add one from the admin screen.</p>";
    return;
  }

  document.title = cat.name + " — Course Site";
  container.innerHTML = `
    <h1>${escapeHtml(cat.name)}</h1>
    <p style="color:var(--text-muted); max-width:520px;">${escapeHtml(cat.description)}</p>
    <div class="grid" style="margin-top:32px;">
      ${cat.courses.map((course) => `
        <div class="card">
          <span class="tag">${escapeHtml(course.level)}</span>
          <h3>${escapeHtml(course.title)}</h3>
          <div class="meta">
            <span>${course.lessons} lessons</span>
            <span>Preview</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

/* ---------- Admin page ---------- */
function renderAdminList() {
  const list = document.querySelector("[data-admin-list]");
  if (!list) return;
  const categories = loadCategories();
  list.innerHTML = categories.map((cat, i) => `
    <div class="admin-list-item">
      <span>${escapeHtml(cat.name)} <span style="color:var(--text-muted); font-size:0.85rem;">(${cat.courses.length} courses)</span></span>
      <button class="remove-btn" data-remove="${i}">Remove</button>
    </div>
  `).join("") || "<p style='color:var(--text-muted)'>No categories yet.</p>";

  list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-remove"), 10);
      const cats = loadCategories();
      cats.splice(idx, 1);
      saveCategories(cats);
      renderAdminList();
    });
  });
}

function initAdminForm() {
  const form = document.querySelector("[data-admin-form]");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const description = form.description.value.trim();
    if (!name) return;

    const id = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const categories = loadCategories();
    categories.push({ id, name, description, courses: [] });
    saveCategories(categories);

    form.reset();
    renderAdminList();

    const notice = document.querySelector("[data-admin-notice]");
    if (notice) {
      notice.textContent = `"${name}" added. Check the homepage to see it live.`;
      notice.style.display = "block";
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initMobileNav();
  renderHomeCategories();
  renderCategoryPage();
  renderAdminList();
  initAdminForm();

  const toggleBtn = document.querySelector("[data-theme-toggle]");
  if (toggleBtn) toggleBtn.addEventListener("click", toggleTheme);
});
