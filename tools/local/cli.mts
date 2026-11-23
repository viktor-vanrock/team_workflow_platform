const selector = process.argv[2];
if (selector === "qa") {
  process.env.AWP_COMPOSITION = "qa-local";
  process.argv.splice(2, 1);
} else if (selector === "foundation") {
  delete process.env.AWP_COMPOSITION;
  process.argv.splice(2, 1);
}
await import("./local.mts");
