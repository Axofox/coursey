/*
  Learner setup — pure logic, no I/O (unit-tested directly).

  Three settings per enrolment, each evidence-backed on its own terms:
    pace      sprint | marathon | cohort   — cadence: streaks and "due today" nudges (sprint) or nothing (marathon); cohort is a stub
    practice  light | heavy                — retrieval practice: how many checkpoint questions, and whether earlier
                                             sections are re-quizzed later (spaced repetition)
    track     job_ready | project | exploring — which tagged exercises are shown after a section

  buildPlan() turns a course curriculum + settings + what the learner has already
  done into an ordered list of steps the player walks through.
*/

export const PACES = {
  sprint:   { label: "Sprint",   tagline: "Daily check-ins, streaks, a little pressure.", daily_target: 1 },
  marathon: { label: "Marathon", tagline: "Fully self-paced. No deadlines, no streaks." },
  cohort:   { label: "Cohort",   tagline: "Start with a group on a schedule. (Coming soon)", stub: true },
};
export const PRACTICES = {
  light: { label: "Light", tagline: "A short checkpoint after each section.", checkpoint_questions: 2, review: false },
  heavy: { label: "Heavy", tagline: "Frequent low-stakes quizzes, and earlier material comes back later.", checkpoint_questions: 5, review: true },
};
export const TRACKS = {
  job_ready: { label: "Job-ready",       tagline: "Applied exercises close to real deliverables." },
  project:   { label: "Project builder", tagline: "Lighter theory, fastest route to a working output." },
  exploring: { label: "Exploring",       tagline: "Broad overview, lowest friction." },
};

export function validSettings(s) {
  return !!s && s.pace in PACES && s.practice in PRACTICES && s.track in TRACKS;
}

// Which earlier sections get re-quizzed after section `si`: one and three back (expanding gaps).
export const reviewSourcesFor = (si) => [si - 1, si - 3].filter((x) => x >= 0);

/*
  Choose `count` questions from a section, preferring ones the learner got wrong
  most recently, then ones never seen, then the rest in order.
*/
export function pickQuestions(section, sectionIdx, count, attempts = []) {
  const quiz = section.quiz || [];
  const lastResult = new Map(); // q_idx → correct? (most recent)
  for (const a of attempts) {
    for (const r of a.answers || []) {
      if (r.section_idx === sectionIdx) lastResult.set(r.q_idx, r.correct);
    }
  }
  const rank = (i) => (lastResult.get(i) === false ? 0 : lastResult.has(i) ? 2 : 1);
  return quiz.map((q, i) => ({ q, i })).sort((a, b) => rank(a.i) - rank(b.i) || a.i - b.i).slice(0, count)
    .map(({ q, i }) => ({ section_idx: sectionIdx, q_idx: i, prompt: q.prompt, options: q.options }));
}

const exerciseFor = (section, track) => {
  const list = section.exercises || [];
  return list.find((e) => e.track === track) || list.find((e) => !e.track || e.track === "all") || null;
};

/*
  Steps: { type: "lesson", si, li } · { type: "checkpoint", si, questions } ·
         { type: "exercise", si, exercise } · { type: "review", si, sources, questions }
  Each carries `done`. `progress` is ["si-li", …], `attempts` are quiz_attempts rows.
*/
export function buildPlan(curriculum, settings, { progress = [], attempts = [] } = {}) {
  const practice = PRACTICES[settings.practice] || PRACTICES.light;
  const doneSet = new Set(progress);
  const attempted = (kind, si) => attempts.some((a) => a.kind === kind && a.section_idx === si);
  const steps = [];
  (curriculum || []).forEach((section, si) => {
    (section.lessons || []).forEach((l, li) => {
      steps.push({ type: "lesson", si, li, title: l.title, duration: l.duration, done: doneSet.has(`${si}-${li}`) });
    });
    if ((section.quiz || []).length) {
      const questions = pickQuestions(section, si, practice.checkpoint_questions, attempts);
      steps.push({ type: "checkpoint", si, title: `Checkpoint: ${section.title}`, questions, done: attempted("checkpoint", si) });
    }
    const exercise = exerciseFor(section, settings.track);
    if (exercise) steps.push({ type: "exercise", si, title: exercise.title, exercise, done: attempted("checkpoint", si) || doneSet.has(`${si}-x`) });
    if (practice.review) {
      const sources = reviewSourcesFor(si).filter((s) => (curriculum[s].quiz || []).length);
      if (sources.length) {
        const questions = sources.flatMap((s) => pickQuestions(curriculum[s], s, 2, attempts));
        steps.push({ type: "review", si, sources, title: "Review: earlier material", questions, done: attempted("review", si) });
      }
    }
  });
  return steps;
}

export function gradeAnswers(curriculum, answers) {
  const results = [];
  for (const a of Array.isArray(answers) ? answers : []) {
    const section = curriculum[Number(a.section_idx)];
    const q = section && (section.quiz || [])[Number(a.q_idx)];
    if (!q) continue;
    const choice = Number(a.choice);
    results.push({ section_idx: Number(a.section_idx), q_idx: Number(a.q_idx), choice, correct: choice === q.answer, answer: q.answer, explanation: q.explanation || "" });
  }
  return { results, score: results.filter((r) => r.correct).length, total: results.length };
}

/* ---------- Pace: streaks and nudges ---------- */

const dayKey = (d, tz) => new Date(d).toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD

// Consecutive active days ending today or yesterday.
export function streakInfo(activityDates, { now = new Date(), tz = "UTC" } = {}) {
  const days = new Set(activityDates.map((d) => dayKey(d, tz)));
  const today = dayKey(now, tz);
  const shift = (key, n) => { const d = new Date(key + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  let cursor = days.has(today) ? today : shift(today, -1);
  let streak = 0;
  while (days.has(cursor)) { streak++; cursor = shift(cursor, -1); }
  return { streak, active_today: days.has(today), active_days: days.size };
}

export function nudgeFor(settings, streak, { completed = false } = {}) {
  if (completed || !settings || settings.pace !== "sprint") return null;
  if (streak.active_today) return { tone: "done", text: streak.streak > 1 ? `Day ${streak.streak} done — streak intact.` : "Today's session is done. Come back tomorrow to start a streak." };
  if (streak.streak > 0) return { tone: "due", text: `You're on a ${streak.streak}-day streak. One lesson today keeps it alive.` };
  return { tone: "due", text: "Sprint pace: aim for one lesson today." };
}
