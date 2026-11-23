import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0110AgentRuntime1700000000110 implements MigrationInterface {
  readonly name = "M0110AgentRuntime1700000000110";
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE agent_runs(id text PRIMARY KEY,workspace_id uuid NOT NULL,project_id uuid NOT NULL,request_key text NOT NULL,request_hash text NOT NULL,subject jsonb NOT NULL,human_principal_id uuid NOT NULL,service_principal_id uuid NOT NULL,prompt_manifest jsonb NOT NULL,grant_set_hash text NOT NULL,state text NOT NULL,result jsonb NULL,row_version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL,UNIQUE(workspace_id,project_id,human_principal_id,request_key));CREATE TABLE agent_run_grants(run_id text NOT NULL,ordinal integer NOT NULL,grant_payload jsonb NOT NULL,grant_hash text NOT NULL,PRIMARY KEY(run_id,ordinal));CREATE TABLE agent_run_steps(run_id text NOT NULL,ordinal integer NOT NULL,state text NOT NULL,input_hash text NOT NULL,output_hash text NULL,started_at timestamptz NULL,finished_at timestamptz NULL,PRIMARY KEY(run_id,ordinal));CREATE TABLE agent_tool_invocations(id text PRIMARY KEY,run_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,action text NOT NULL,grant_hash text NOT NULL,state text NOT NULL,result_hash text NULL,created_at timestamptz NOT NULL);UPDATE platform_schema_versions SET version=110,applied_at=clock_timestamp() WHERE namespace='core';`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP TABLE agent_tool_invocations;DROP TABLE agent_run_steps;DROP TABLE agent_run_grants;DROP TABLE agent_runs;UPDATE platform_schema_versions SET version=105 WHERE namespace='core';`,
    );
  }
}
