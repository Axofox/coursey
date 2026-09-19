-- Learner setup experiment: per-enrolment learning settings, quiz attempts,
-- an events log for before/after comparison, and a per-course feature flag.

ALTER TABLE courses ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS enrolment_settings (
  enrolment_id INTEGER PRIMARY KEY REFERENCES enrolments(id) ON DELETE CASCADE,
  pace         TEXT NOT NULL CHECK (pace IN ('sprint', 'marathon', 'cohort')),
  practice     TEXT NOT NULL CHECK (practice IN ('light', 'heavy')),
  track        TEXT NOT NULL CHECK (track IN ('job_ready', 'project', 'exploring')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section_idx  INTEGER NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('checkpoint', 'review')),
  score        INTEGER NOT NULL,
  total        INTEGER NOT NULL,
  answers      JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_attempts_user_course_idx ON quiz_attempts(user_id, course_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  course_id   INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  props       JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_name_course_idx ON events(name, course_id, created_at);

-- The one test course. Matched by title so it works on databases where ids differ.
UPDATE courses SET features = features || '{"learner_setup": true}'::jsonb
 WHERE title = 'UX Foundations: Research to Wireframe';
