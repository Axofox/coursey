/*
  Placeholder data layer.

  This mockup stores categories in the browser's own localStorage so the
  "admin" screen feels real when you add a category — it will show up on
  the homepage immediately. IMPORTANT: this only lives on *this* browser,
  on *this* device. It is not shared with other visitors and is not a
  real database. Once a real backend (e.g. Supabase) is added later,
  this file gets replaced with real API calls, but the rest of the site
  (index.html, category.html, admin.html) won't need to change much.
*/

const DEFAULT_CATEGORIES = [
  {
    id: "personal-development",
    name: "Personal Development",
    description: "Habits, focus, and growth-oriented courses.",
    courses: [
      { title: "Building Daily Discipline", level: "Beginner", lessons: 8 },
      { title: "Deep Work Fundamentals", level: "Intermediate", lessons: 6 },
    ],
  },
  {
    id: "positivity",
    name: "Positivity",
    description: "Mindset, resilience, and everyday optimism.",
    courses: [
      { title: "Reframing Negative Thoughts", level: "Beginner", lessons: 5 },
      { title: "Gratitude in Practice", level: "Beginner", lessons: 4 },
    ],
  },
  {
    id: "ai",
    name: "AI",
    description: "Practical AI skills, no heavy math required.",
    courses: [
      { title: "AI Tools for Everyday Work", level: "Beginner", lessons: 7 },
      { title: "Prompting Well", level: "Intermediate", lessons: 5 },
    ],
  },
];

const STORAGE_KEY = "course_site_categories";

function loadCategories() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* localStorage unavailable — fall back to defaults */
  }
  return DEFAULT_CATEGORIES;
}

function saveCategories(categories) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(categories));
  } catch (e) {
    /* ignore — non-critical for a mockup */
  }
}

function resetCategories() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}
