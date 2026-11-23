import {
  type ClaimedCommandDelivery,
  createPlatformDataSource,
  TypeOrmCommandDeliveryStore,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import { TypeOrmProjectEffectGuard } from "../../packages/runtime-composition/src/onboarding/project-effect-guard.ts";

// Only PostgreSQL and the controlled HTTP provider cross the process boundary.
const source = createPlatformDataSource({
  url: process.env.AWP_JOURNEY_DATABASE_URL!,
  entities: [],
  migrations: [],
});
await source.initialize();
const store = new TypeOrmCommandDeliveryStore(source);
let claimed: ClaimedCommandDelivery | undefined;
let chain = Promise.resolve();
process.on("message", (message: { id: number; operation: string }) => {
  chain = chain.then(async () => {
    try {
      let result: unknown;
      if (message.operation === "claim") {
        claimed = (await store.claim(new Date(), new Date(Date.now() + 60_000), 1))[0];
        result = { commandId: claimed?.command.id ?? null, pid: process.pid };
      } else if (message.operation === "dispatch") {
        if (!claimed) throw new Error("JOURNEY_CLAIM_REQUIRED");
        const command = await store.markDispatched(
          claimed.outbox,
          new Date(),
          30_000,
          undefined,
          async (manager, current) => {
            await new TypeOrmProjectEffectGuard(manager).assertEffectsAllowed(current);
          },
        );
        const response = await fetch(process.env.AWP_JOURNEY_PROVIDER_URL!, {
          method: "POST",
          signal: AbortSignal.timeout(5_000),
          headers: {
            "content-type": "application/json",
            "idempotency-key": command.effectIdempotencyKey,
          },
          body: JSON.stringify({ commandId: command.id }),
        });
        if (!response.ok) throw new Error("JOURNEY_PROVIDER_FAILED");
        await store.confirm(
          { ...command, commandId: command.id },
          await response.json(),
          new Date(),
        );
        result = { commandId: command.id, state: "CONFIRMED" };
      } else if (message.operation === "close") {
        await source.destroy();
        process.send?.({ id: message.id, result: { closed: true } });
        process.disconnect?.();
        return;
      } else throw new Error("JOURNEY_OPERATION_UNKNOWN");
      process.send?.({ id: message.id, result });
    } catch (error) {
      process.send?.({
        id: message.id,
        error: error instanceof Error ? error.message : "JOURNEY_WORKER_FAILED",
      });
    }
  });
});
process.send?.({ ready: true, pid: process.pid });
