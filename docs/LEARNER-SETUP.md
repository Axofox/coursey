# Learner setup (experiment)

A short, game-like setup screen before a learner starts a course. Three
choices, each stored **per enrolment** and changeable any time, that really
change how the course is delivered. Live on **one course only** — UX
Foundations — behind a per-course flag, so the rest of the catalog is the
control group.

Not in here, deliberately: "learning styles" (visual/auditory/kinesthetic).
The three parameters below are the ones with evidence behind them.

| Setting | Options | What it changes |
|---------|---------|-----------------|
| **Pace** | Sprint · Marathon · Cohort (stub) | Sprint: a "due today" nudge on the dashboard and in the player, a streak counter (consecutive days with a lesson or quiz). Marathon: none of that. Cohort: disabled card, "coming soon". |
| **Practice** | Light · Heavy | Light: a 2-question checkpoint after each section that has questions. Heavy: up to 5 questions per checkpoint **and** a spaced review after each section that re-asks questions from one and three sections back, wrong answers first. |
| **Goal track** | Job-ready · Project builder · Exploring | Which exercise is shown after a section. Exercises are tagged with a track (or `all`); the learner's track wins, `all` is the fallback, nothing if neither exists. |

## Where it applies

`courses.features.learner_setup = true`. Toggle in the course editor (admins
only, step 3). Migration 005 turned it on for UX Foundations by title.

- Course page: badge *Learner setup · beta*; "Start learning" becomes
  **Set up & start** until settings exist.
- `lesson.html` for an enrolled learner on a flagged course loads `/api/learn/:id`
  and walks the **plan** (lessons, checkpoints, exercises, reviews). No settings
  yet → redirect to `setup.html?course=N`. Unflagged courses use the classic
  player exactly as before.
- Dashboard → Settings → *Learning setup*: pick any flagged course you're
  enrolled in and change the three settings; Overview shows the Sprint nudge
  and streak.

## Data model (migration 005)

```
courses.features            JSONB   {"learner_setup": true}
enrolment_settings          enrolment_id PK → enrolments (so per user per course), pace, practice, track, timestamps
quiz_attempts               user, course, section_idx, kind (checkpoint|review), score, total, answers JSONB, created_at
events                      name, user_id?, course_id?, props JSONB, created_at
lesson_progress             (existing) — exercises are recorded as lesson_idx = -1 for their section
```

Questions and exercises live inside `courses.curriculum` per section:

```json
{ "title": "User research",
  "lessons": [...],
  "quiz": [{ "prompt": "…", "options": ["…","…"], "answer": 1, "explanation": "…" }],
  "exercises": [{ "title": "…", "body": "…", "track": "job_ready" }] }
```

Authored in the course editor (step 2 → "Checkpoint questions & exercises"
under each section). Migration 006 seeded 4 questions + 3 exercises per
section for the test course, only where a section had none.

Learners never receive `answer`: the public course payload carries only
`quiz_count` per section; questions come from `/api/learn` without answers and
are graded server-side.

## API

```
GET  /api/learn/:course             { settings|null, plan|null, streak, nudge, completed, options }
PUT  /api/learn/:course/settings    { pace, practice, track }         → setup_completed / settings_changed event
POST /api/learn/:course/quiz        { kind, section_idx, answers:[{section_idx,q_idx,choice}] } → graded results + new state
POST /api/learn/:course/exercise    { section_idx }
POST /api/events                    { name, course_id, props }        client events (whitelist: setup_viewed, setup_skipped, nudge_shown, plan_viewed)
GET  /api/experiment                admin — the comparison below
```

Signed-in + enrolled required; unflagged course → 404. The plan builder,
question picker, grading and streak maths are pure functions in
`netlify/lib/learn.mjs` (unit-tested).

## Plan logic (netlify/lib/learn.mjs)

For each section, in order: its lessons → a **checkpoint** (if the section has
questions; 2 questions for Light, up to 5 for Heavy, wrong-most-recently
first, then unseen, then the rest) → the **exercise** for the learner's track →
for Heavy only, a **review** pulling 2 questions each from sections `si−1` and
`si−3` (expanding gaps), same ordering. Each step carries `done` from
`lesson_progress` / `quiz_attempts`.

Streak = consecutive days (learner's timezone, sent as `X-Timezone`) with a
lesson or quiz, ending today or yesterday. Nudge text depends on pace, streak
and whether the course is complete.

## Events logged

| name | when | props |
|------|------|-------|
| `enrolled` | free enrol or paid webhook | `via`, `flag` |
| `setup_viewed` (client) | setup screen opened | `first_time` |
| `setup_completed` / `settings_changed` | settings saved | the settings, `flag` |
| `lesson_completed` | a lesson recorded | `section`, `lesson`, `flag` |
| `quiz_completed` | checkpoint/review graded | `kind`, `section_idx`, `score`, `total` |
| `exercise_completed` | exercise marked done | `section_idx` |
| `course_completed` | certificate issued (first time) | `flag` |
| `nudge_shown` (client) | Sprint nudge displayed | `tone`, `where` |

Every event carries `course_id`, so "test vs. control" is a join to
`courses.features`.

## Reading the before/after

Admin → Reports → *Learner setup experiment* shows, for the flagged course(s)
vs. every other published course: enrolments, **start rate** (≥ 1 lesson),
**completion rate** (certificate), lessons per enrolment, quiz attempts, the
distribution of setups chosen, and event counts per group.

The two numbers that decide it are **start rate** (does the setup screen add
friction before the first lesson?) and **completion rate** (does the delivery
help people finish?). Lessons-per-enrolment is the softer signal in between.

Caveats, so nobody over-reads it:
- One course vs. seven confounds the feature with the course itself. Compare
  UX Foundations against its own pre-flag numbers too — the `events` table has
  timestamps, and enrolments created before migration 005 have no
  `setup_completed` event.
- Wait for ≥ 30 enrolments on the test course and a gap that holds for a week
  before expanding. Then flag a second, different-shaped course (e.g. Python)
  and see if the direction holds.
- Sprint nudges are in-app only in this pass; no email reminders yet.

## Rolling out or backing out

- Expand: toggle *Learner setup* in the editor of another course; author its
  questions/exercises (or accept that sections without questions simply get
  no checkpoints).
- Back out: toggle the flag off — the classic player returns immediately;
  settings, attempts and events stay for analysis.
