/*
  # Add authenticated role policies for all tables

  ## Problem
  All existing RLS policies only allow the `anon` role. When users sign up
  and become `authenticated`, they lose access to all tables and cannot
  create projects, files, conversations, etc.

  ## Changes
  - Add SELECT, INSERT, UPDATE, DELETE policies for `authenticated` role on:
    - projects
    - files
    - conversations
    - messages
    - settings
    - project_docs

  ## Notes
  - Mirrors the existing anon policies so authenticated users have the same
    access level as unauthenticated users (this is a self-hosted tool)
  - The user_id column on projects remains optional for future per-user scoping
*/

CREATE POLICY "authenticated can read projects"
  ON projects FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can insert projects"
  ON projects FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated can update projects"
  ON projects FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated can delete projects"
  ON projects FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can read files"
  ON files FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can insert files"
  ON files FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated can update files"
  ON files FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated can delete files"
  ON files FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can read conversations"
  ON conversations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can insert conversations"
  ON conversations FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated can update conversations"
  ON conversations FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated can delete conversations"
  ON conversations FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can read messages"
  ON messages FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can insert messages"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated can update messages"
  ON messages FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated can delete messages"
  ON messages FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can read settings"
  ON settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can insert settings"
  ON settings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated can update settings"
  ON settings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated can delete settings"
  ON settings FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can read project_docs"
  ON project_docs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can insert project_docs"
  ON project_docs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated can update project_docs"
  ON project_docs FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated can delete project_docs"
  ON project_docs FOR DELETE
  TO authenticated
  USING (true);
