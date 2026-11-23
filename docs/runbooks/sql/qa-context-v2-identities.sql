-- Upgrade contexts published before the shared identity fix (QA schema 2110).
-- Run once after migrations, before accepting QA requests; safe to repeat.
BEGIN;
LOCK TABLE qa_project_contexts, qa_project_context_headers_v2 IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM qa_project_context_headers_v2 v2
    JOIN qa_project_contexts identity ON identity.id=v2.context_id
    WHERE identity.workspace_id<>v2.workspace_id OR identity.project_id<>v2.project_id
  ) THEN
    RAISE EXCEPTION 'QA_CONTEXT_IDENTITY_SCOPE_CONFLICT';
  END IF;
END $$;
INSERT INTO qa_project_contexts(id,workspace_id,project_id,resource_version)
SELECT context_id,workspace_id,project_id,1 FROM qa_project_context_headers_v2
ON CONFLICT(id) DO NOTHING;
COMMIT;
-- Must return 0; legacy published version pointers and immutable records remain unchanged.
SELECT count(*) AS missing_context_identities
FROM qa_project_context_headers_v2 v2
LEFT JOIN qa_project_contexts identity
  ON (identity.id,identity.workspace_id,identity.project_id)=(v2.context_id,v2.workspace_id,v2.project_id)
WHERE identity.id IS NULL;
