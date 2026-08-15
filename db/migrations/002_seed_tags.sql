BEGIN;
INSERT INTO tags(name, category) VALUES
  ('Triplet', 'RHYTHM'),
  ('Swing', 'RHYTHM'),
  ('Funky Beats', 'RHYTHM'),
  ('Continuous Polygons', 'PATTERN'),
  ('Gallop', 'PATTERN'),
  ('Speed Change', 'EVENT'),
  ('Hold', 'DLC'),
  ('Freeroam', 'DLC'),
  ('3 Planets', 'DLC'),
  ('Timing Window Change', 'EVENT'),
  ('Visual Distraction', 'READING'),
  ('Memorize', 'READING'),
  ('Multitap', 'INPUT'),
  ('Gimmick', 'SPECIAL')
ON CONFLICT(name) DO NOTHING;
COMMIT;
