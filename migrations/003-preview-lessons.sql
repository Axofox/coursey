-- Courses created before the lesson player existed have no preview lesson;
-- flag the first lesson of each so "Preview this course" has something to play.
UPDATE courses
   SET curriculum = jsonb_set(curriculum, '{0,lessons,0,preview}', 'true'::jsonb)
 WHERE jsonb_typeof(curriculum) = 'array'
   AND jsonb_array_length(curriculum) > 0
   AND jsonb_typeof(curriculum->0->'lessons') = 'array'
   AND jsonb_array_length(curriculum->0->'lessons') > 0
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(curriculum) s, jsonb_array_elements(s->'lessons') l
      WHERE (l->>'preview')::boolean IS TRUE
   );
