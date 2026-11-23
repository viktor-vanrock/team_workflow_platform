import { seedGitLabRepository } from "../gitlab/state/gitlab.repository.ts";
import { seedMattermostRepository } from "../mattermost/state/mattermost.repository.ts";
import { createMockHubDataSource } from "./data-source.ts";
import { migrateMockHub } from "./migration-runner.ts";
import { TypeOrmMockStateRepository } from "./mock-state.repository.ts";

const url = process.env.MOCK_HUB_DATABASE_URL;
if (!url) throw new Error("MOCK_HUB_DATABASE_URL is required");
const source = createMockHubDataSource(url);
await migrateMockHub(source);
await new TypeOrmMockStateRepository(source).seed(Number(process.env.MOCK_HUB_SEED ?? 42));
await seedMattermostRepository(source);
await seedGitLabRepository(source);
await source.destroy();
