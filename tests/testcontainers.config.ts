export const POSTGRES_TEST_IMAGES = ["postgres:17.7-bookworm", "postgres:18.6-bookworm"] as const;
export const POSTGRES_TEST_IMAGE = process.env.AWP_TEST_POSTGRES_IMAGE ?? POSTGRES_TEST_IMAGES[1];
export const TESTCONTAINERS_REUSE_ENABLE = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";
