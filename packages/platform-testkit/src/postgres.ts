import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

export interface RunningPostgres {
  readonly container: StartedTestContainer;
  readonly url: string;
  stop(): Promise<void>;
}

export async function startPostgres(
  image = process.env.AWP_TEST_POSTGRES_IMAGE ?? "postgres:18.6-bookworm",
): Promise<RunningPostgres> {
  const password = "awp-test-only";
  const container = await new GenericContainer(image)
    .withEnvironment({
      POSTGRES_DB: "awp_test",
      POSTGRES_USER: "awp_test",
      POSTGRES_PASSWORD: password,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start();
  const url = `postgresql://awp_test:${password}@${container.getHost()}:${container.getMappedPort(5432)}/awp_test`;
  return Object.freeze({
    container,
    url,
    stop: async () => {
      await container.stop();
    },
  });
}
