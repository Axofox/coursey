# Course Site Mockup

A static, no-backend preview of the course site: homepage with categories,
a category/course listing page, an admin screen for adding categories
(saved to your browser only — not a real database yet), and light/dark
mode. Fully responsive for mobile.

## Try it locally first
Just open `index.html` in a browser — no install needed. Try the dark
mode toggle, click into a category, and add a category from Admin to see
it appear on the homepage.

## Deploy to GitHub + Netlify

1. Create a new empty repository on GitHub (e.g. `course-website-mockup`).
2. Upload these files to it — easiest way: on the repo page, click
   "Add file" → "Upload files", drag in everything from this folder, and
   commit.
3. Go to netlify.com, sign up free, click "Add new site" →
   "Import an existing project" → connect GitHub → pick this repo.
4. Leave the build settings empty (no build command needed, this is
   plain HTML/CSS/JS) and deploy.
5. Netlify gives you a live URL like `yoursite.netlify.app` — that's your
   real, shareable mockup.

## What's a placeholder vs. what's real

- Categories/courses: placeholder data, editable via Admin, stored in
  your browser's local storage only (not shared across devices/visitors).
- No logins, no payments, no real database yet — those come once a
  backend (e.g. Supabase) is added in the next phase.
- Design, layout, and navigation are real and will carry over directly
  into the fuller build.
