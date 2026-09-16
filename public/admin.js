/*
  Admin page: sign in with the admin token, then manage categories and courses.
  All changes go straight to the database via api.js.
*/

const state = {
  categories: [],
  openCategory: null,   // id of the category whose courses are expanded
  editingCategory: null,
  editingCourse: null,  // { id, category_id }
};

const $ = (sel) => document.querySelector(sel);

function notify(message, isError) {
  const el = $("[data-admin-notice]");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", !!isError);
  el.style.display = message ? "block" : "none";
}

function showApp(authed) {
  $("[data-admin-login]").style.display = authed ? "none" : "";
  $("[data-admin-app]").style.display = authed ? "" : "none";
}

/* ---------- Sign in ---------- */
async function initLogin() {
  const form = $("[data-login-form]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = form.token.value.trim();
    if (!token) return;
    setToken(token);
    try {
      await checkToken();
      form.reset();
      notify("");
      showApp(true);
      await refresh();
    } catch (err) {
      setToken("");
      notify(err.status === 401 ? "That token isn't right." : "Couldn't reach the server: " + err.message, true);
    }
  });

  $("[data-signout]").addEventListener("click", () => {
    setToken("");
    showApp(false);
    notify("");
  });

  if (getToken()) {
    try {
      await checkToken();
      showApp(true);
      await refresh();
      return;
    } catch (e) {
      setToken("");
    }
  }
  showApp(false);
}

/* ---------- Data ---------- */
async function refresh() {
  try {
    state.categories = await fetchCategories();
  } catch (e) {
    notify("Couldn't load categories: " + e.message, true);
    return;
  }
  renderList();
}

async function run(action, successMessage) {
  try {
    await action();
    notify(successMessage || "");
    await refresh();
  } catch (e) {
    if (e.status === 401) {
      setToken("");
      showApp(false);
      notify("Your session expired — please sign in again.", true);
    } else {
      notify(e.message, true);
    }
  }
}

/* ---------- Category form ---------- */
function initCategoryForm() {
  const form = $("[data-category-form]");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = { name: form.name.value.trim(), description: form.description.value.trim() };
    if (!data.name) return;
    const editing = state.editingCategory;
    run(
      () => (editing ? updateCategory(editing, data) : createCategory(data)),
      editing ? `"${data.name}" updated.` : `"${data.name}" added — it's live on the homepage now.`
    ).then(() => setCategoryForm(null));
  });
  form.querySelector("[data-cancel]").addEventListener("click", () => setCategoryForm(null));
}

function setCategoryForm(cat) {
  const form = $("[data-category-form]");
  state.editingCategory = cat ? cat.id : null;
  form.name.value = cat ? cat.name : "";
  form.description.value = cat ? cat.description : "";
  $("[data-category-form-title]").textContent = cat ? `Edit "${cat.name}"` : "Add a category";
  form.querySelector("[type=submit]").textContent = cat ? "Save changes" : "Add category";
  form.querySelector("[data-cancel]").style.display = cat ? "" : "none";
  if (cat) form.name.focus();
}

/* ---------- Category + course list ---------- */
function renderList() {
  const list = $("[data-admin-list]");
  if (!state.categories.length) {
    list.innerHTML = `<p class="muted">No categories yet — add one above.</p>`;
    return;
  }
  list.innerHTML = state.categories.map((cat) => {
    const open = state.openCategory === cat.id;
    return `
      <div class="admin-item">
        <div class="admin-row">
          <span><strong>${escapeHtml(cat.name)}</strong>
            <span class="muted small">(${cat.courses.length} course${cat.courses.length === 1 ? "" : "s"})</span></span>
          <span class="admin-actions">
            <button class="link-btn" data-toggle="${escapeHtml(cat.id)}">${open ? "Hide courses" : "Courses"}</button>
            <button class="link-btn" data-edit-cat="${escapeHtml(cat.id)}">Edit</button>
            <button class="link-btn danger" data-remove-cat="${escapeHtml(cat.id)}">Remove</button>
          </span>
        </div>
        ${open ? renderCourses(cat) : ""}
      </div>`;
  }).join("");

  list.querySelectorAll("[data-toggle]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.openCategory = state.openCategory === btn.dataset.toggle ? null : btn.dataset.toggle;
      state.editingCourse = null;
      renderList();
    })
  );
  list.querySelectorAll("[data-edit-cat]").forEach((btn) =>
    btn.addEventListener("click", () => {
      setCategoryForm(state.categories.find((c) => c.id === btn.dataset.editCat));
      window.scrollTo({ top: 0, behavior: "smooth" });
    })
  );
  list.querySelectorAll("[data-remove-cat]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const cat = state.categories.find((c) => c.id === btn.dataset.removeCat);
      const n = cat.courses.length;
      const msg = n
        ? `Remove "${cat.name}" and its ${n} course${n === 1 ? "" : "s"}? This can't be undone.`
        : `Remove "${cat.name}"?`;
      if (confirm(msg)) run(() => deleteCategory(cat.id), `"${cat.name}" removed.`);
    })
  );

  initCourseHandlers(list);
}

function renderCourses(cat) {
  const editing = state.editingCourse && state.editingCourse.category_id === cat.id
    ? cat.courses.find((c) => c.id === state.editingCourse.id)
    : null;
  return `
    <div class="admin-sub">
      ${cat.courses.length ? cat.courses.map((c) => `
        <div class="admin-row">
          <span>${escapeHtml(c.title)}
            <span class="muted small">· ${escapeHtml(c.level)} · ${c.lessons} lesson${c.lessons === 1 ? "" : "s"}</span></span>
          <span class="admin-actions">
            <button class="link-btn" data-edit-course="${c.id}">Edit</button>
            <button class="link-btn danger" data-remove-course="${c.id}">Remove</button>
          </span>
        </div>
      `).join("") : `<p class="muted small">No courses in this category yet.</p>`}

      <form class="course-form" data-course-form data-category="${escapeHtml(cat.id)}">
        <h4>${editing ? `Edit "${escapeHtml(editing.title)}"` : "Add a course"}</h4>
        <div class="field">
          <label>Title</label>
          <input name="title" required value="${editing ? escapeHtml(editing.title) : ""}" placeholder="e.g. Deep Work Fundamentals">
        </div>
        <div class="field">
          <label>Short description (optional)</label>
          <textarea name="description" rows="2">${editing ? escapeHtml(editing.description) : ""}</textarea>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Level</label>
            <select name="level">
              ${["Beginner", "Intermediate", "Advanced"].map((l) =>
                `<option ${editing && editing.level === l ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Lessons</label>
            <input name="lessons" type="number" min="0" step="1" value="${editing ? editing.lessons : 0}">
          </div>
        </div>
        <button type="submit" class="btn">${editing ? "Save changes" : "Add course"}</button>
        ${editing ? `<button type="button" class="btn secondary" data-cancel-course>Cancel</button>` : ""}
      </form>
    </div>`;
}

function initCourseHandlers(list) {
  list.querySelectorAll("[data-edit-course]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.editingCourse = { id: Number(btn.dataset.editCourse), category_id: state.openCategory };
      renderList();
      const input = list.querySelector("[data-course-form] [name=title]");
      if (input) input.focus();
    })
  );
  list.querySelectorAll("[data-remove-course]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const cat = state.categories.find((c) => c.id === state.openCategory);
      const course = cat.courses.find((c) => c.id === Number(btn.dataset.removeCourse));
      if (confirm(`Remove "${course.title}"?`)) run(() => deleteCourse(course.id), `"${course.title}" removed.`);
    })
  );
  const cancel = list.querySelector("[data-cancel-course]");
  if (cancel) cancel.addEventListener("click", () => { state.editingCourse = null; renderList(); });

  const form = list.querySelector("[data-course-form]");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = {
        title: form.title.value.trim(),
        description: form.description.value.trim(),
        level: form.level.value,
        lessons: Number(form.lessons.value || 0),
      };
      if (!data.title) return;
      const editing = state.editingCourse;
      run(
        () => (editing
          ? updateCourse(editing.id, data)
          : createCourse({ ...data, category_id: form.dataset.category })),
        editing ? `"${data.title}" updated.` : `"${data.title}" added.`
      ).then(() => { state.editingCourse = null; renderList(); });
    });
  }
}

/* ---------- Entry point (called from script.js) ---------- */
function initAdmin() {
  if (!$("[data-admin-app]")) return;
  initCategoryForm();
  setCategoryForm(null);
  initLogin();
}
