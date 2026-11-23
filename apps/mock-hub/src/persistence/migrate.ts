import { createMockHubDataSource } from "./data-source.ts";
import { migrateMockHub } from "./migration-runner.ts";

const url = process.env.MOCK_HUB_DATABASE_URL;
if (!url) throw new Error("MOCK_HUB_DATABASE_URL is required");
const source = createMockHubDataSource(url);
await migrateMockHub(source);
await source.destroy();
