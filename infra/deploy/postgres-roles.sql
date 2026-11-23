-- Run once as the DBA, connected to an empty, dedicated awp_qa database.
-- Provision passwords/certificates through the corporate secret-management process.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE awp_qa_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE awp_qa_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE awp_qa TO awp_qa_migrator, awp_qa_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO awp_qa_migrator;
GRANT USAGE ON SCHEMA public TO awp_qa_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE awp_qa_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO awp_qa_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE awp_qa_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO awp_qa_runtime;
COMMIT;
