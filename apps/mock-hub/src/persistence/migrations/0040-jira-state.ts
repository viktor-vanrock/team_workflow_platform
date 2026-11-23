import type { MigrationInterface, QueryRunner } from "typeorm";

export class JiraState00401700000002040 implements MigrationInterface {
  readonly name = "JiraState00401700000002040";
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
 CREATE SEQUENCE jira_mock_issue_id_seq START 10001;
 CREATE TABLE jira_mock_issues(id text PRIMARY KEY DEFAULT nextval('jira_mock_issue_id_seq')::text,key text GENERATED ALWAYS AS ('QAC-'||id) STORED,project_id text NOT NULL,issue_type_id text NOT NULL,fields jsonb NOT NULL,marker text NULL,updated_at timestamptz NOT NULL,changelog_id bigint GENERATED ALWAYS AS IDENTITY,UNIQUE(marker));
 CREATE TABLE jira_mock_properties(issue_id text NOT NULL REFERENCES jira_mock_issues(id),key text NOT NULL,value jsonb NOT NULL,PRIMARY KEY(issue_id,key));
 CREATE TABLE jira_mock_links(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,issue_id text NOT NULL REFERENCES jira_mock_issues(id),type_id text NOT NULL,other_issue_id text NOT NULL,direction text NOT NULL CHECK(direction IN ('INWARD','OUTWARD')),UNIQUE(issue_id,type_id,other_issue_id,direction));
 CREATE TABLE jira_mock_comments(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,issue_id text NOT NULL REFERENCES jira_mock_issues(id),marker text NOT NULL,body text NOT NULL,UNIQUE(issue_id,marker));
 CREATE TABLE jira_mock_webhooks(id uuid PRIMARY KEY,registration_kind text NOT NULL,secret_ref_hash text NOT NULL,expires_at timestamptz NULL,state text NOT NULL);
 CREATE TABLE jira_mock_scenario(singleton integer PRIMARY KEY CHECK(singleton=1),scenario text NOT NULL);INSERT INTO jira_mock_scenario(singleton,scenario) VALUES(1,'NORMAL');
`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DROP TABLE jira_mock_scenario; DROP TABLE jira_mock_webhooks; DROP TABLE jira_mock_comments; DROP TABLE jira_mock_links; DROP TABLE jira_mock_properties; DROP TABLE jira_mock_issues; DROP SEQUENCE jira_mock_issue_id_seq;",
    );
  }
}
