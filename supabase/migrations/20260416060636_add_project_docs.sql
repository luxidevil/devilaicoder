/*
  # Add project_docs table

  1. New Tables
    - `project_docs`
      - `id` (serial, primary key)
      - `project_id` (integer, foreign key → projects.id, cascade delete)
      - `title` (text) — short label for the doc
      - `content` (text) — full doc text included in AI context
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS
    - Public anon select/insert/update/delete (consistent with other tables in this self-hosted tool)

  3. Notes
    - Docs are included in the AI system prompt per-project to give context
    - No hard limit on doc size but AI providers will truncate at token limits
*/

CREATE TABLE IF NOT EXISTS project_docs (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE project_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can select project_docs"
  ON project_docs FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "anon can insert project_docs"
  ON project_docs FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "anon can update project_docs"
  ON project_docs FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "anon can delete project_docs"
  ON project_docs FOR DELETE
  TO anon
  USING (true);
