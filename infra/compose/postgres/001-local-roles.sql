CREATE ROLE awp_core_migrator LOGIN PASSWORD 'local-core-migrator-only';
CREATE ROLE awp_runtime LOGIN PASSWORD 'local-runtime-only';
CREATE ROLE awp_mock_owner LOGIN PASSWORD 'local-mock-owner-only';

ALTER DATABASE awp OWNER TO awp_core_migrator;
GRANT CONNECT ON DATABASE awp TO awp_runtime;

\connect awp
GRANT USAGE, CREATE ON SCHEMA public TO awp_core_migrator;
GRANT USAGE ON SCHEMA public TO awp_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE awp_core_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO awp_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE awp_core_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO awp_runtime;

SELECT 'CREATE DATABASE awp_mock OWNER awp_mock_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'awp_mock')\gexec
