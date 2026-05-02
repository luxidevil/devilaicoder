/*
  # Scope project data to project owners

  Fixes two data-isolation issues:
  1. New projects were not stamped with the current user.
  2. Existing RLS policies allowed authenticated users to read/write every
     project, file, conversation, message, and project doc.

  This migration adds restrictive owner/admin policies that are ANDed with any
  permissive legacy policies, so older broad rules no longer leak data.
*/

DROP POLICY IF EXISTS "project owners or admins can read projects" ON projects;
DROP POLICY IF EXISTS "project owners or admins can insert projects" ON projects;
DROP POLICY IF EXISTS "project owners or admins can update projects" ON projects;
DROP POLICY IF EXISTS "project owners or admins can delete projects" ON projects;

DROP POLICY IF EXISTS "project owners or admins can read files" ON files;
DROP POLICY IF EXISTS "project owners or admins can insert files" ON files;
DROP POLICY IF EXISTS "project owners or admins can update files" ON files;
DROP POLICY IF EXISTS "project owners or admins can delete files" ON files;

DROP POLICY IF EXISTS "project owners or admins can read conversations" ON conversations;
DROP POLICY IF EXISTS "project owners or admins can insert conversations" ON conversations;
DROP POLICY IF EXISTS "project owners or admins can update conversations" ON conversations;
DROP POLICY IF EXISTS "project owners or admins can delete conversations" ON conversations;

DROP POLICY IF EXISTS "project owners or admins can read messages" ON messages;
DROP POLICY IF EXISTS "project owners or admins can insert messages" ON messages;
DROP POLICY IF EXISTS "project owners or admins can update messages" ON messages;
DROP POLICY IF EXISTS "project owners or admins can delete messages" ON messages;

DROP POLICY IF EXISTS "project owners or admins can read project docs" ON project_docs;
DROP POLICY IF EXISTS "project owners or admins can insert project docs" ON project_docs;
DROP POLICY IF EXISTS "project owners or admins can update project docs" ON project_docs;
DROP POLICY IF EXISTS "project owners or admins can delete project docs" ON project_docs;

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND is_admin = true
  );
$$;

CREATE POLICY "project owners or admins can read projects"
  ON projects
  AS RESTRICTIVE
  FOR SELECT
  TO public
  USING (
    user_id = auth.uid()
    OR public.is_current_user_admin()
  );

CREATE POLICY "project owners or admins can insert projects"
  ON projects
  AS RESTRICTIVE
  FOR INSERT
  TO public
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_current_user_admin()
  );

CREATE POLICY "project owners or admins can update projects"
  ON projects
  AS RESTRICTIVE
  FOR UPDATE
  TO public
  USING (
    user_id = auth.uid()
    OR public.is_current_user_admin()
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_current_user_admin()
  );

CREATE POLICY "project owners or admins can delete projects"
  ON projects
  AS RESTRICTIVE
  FOR DELETE
  TO public
  USING (
    user_id = auth.uid()
    OR public.is_current_user_admin()
  );

CREATE POLICY "project owners or admins can read files"
  ON files
  AS RESTRICTIVE
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = files.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can insert files"
  ON files
  AS RESTRICTIVE
  FOR INSERT
  TO public
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = files.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can update files"
  ON files
  AS RESTRICTIVE
  FOR UPDATE
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = files.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = files.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can delete files"
  ON files
  AS RESTRICTIVE
  FOR DELETE
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = files.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can read conversations"
  ON conversations
  AS RESTRICTIVE
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = conversations.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can insert conversations"
  ON conversations
  AS RESTRICTIVE
  FOR INSERT
  TO public
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = conversations.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can update conversations"
  ON conversations
  AS RESTRICTIVE
  FOR UPDATE
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = conversations.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = conversations.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can delete conversations"
  ON conversations
  AS RESTRICTIVE
  FOR DELETE
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = conversations.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can read messages"
  ON messages
  AS RESTRICTIVE
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM conversations
      JOIN projects ON projects.id = conversations.project_id
      WHERE conversations.id = messages.conversation_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can insert messages"
  ON messages
  AS RESTRICTIVE
  FOR INSERT
  TO public
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM conversations
      JOIN projects ON projects.id = conversations.project_id
      WHERE conversations.id = messages.conversation_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can update messages"
  ON messages
  AS RESTRICTIVE
  FOR UPDATE
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM conversations
      JOIN projects ON projects.id = conversations.project_id
      WHERE conversations.id = messages.conversation_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM conversations
      JOIN projects ON projects.id = conversations.project_id
      WHERE conversations.id = messages.conversation_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can delete messages"
  ON messages
  AS RESTRICTIVE
  FOR DELETE
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM conversations
      JOIN projects ON projects.id = conversations.project_id
      WHERE conversations.id = messages.conversation_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can read project docs"
  ON project_docs
  AS RESTRICTIVE
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = project_docs.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can insert project docs"
  ON project_docs
  AS RESTRICTIVE
  FOR INSERT
  TO public
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = project_docs.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can update project docs"
  ON project_docs
  AS RESTRICTIVE
  FOR UPDATE
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = project_docs.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = project_docs.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );

CREATE POLICY "project owners or admins can delete project docs"
  ON project_docs
  AS RESTRICTIVE
  FOR DELETE
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.id = project_docs.project_id
        AND (
          projects.user_id = auth.uid()
          OR public.is_current_user_admin()
        )
    )
  );
