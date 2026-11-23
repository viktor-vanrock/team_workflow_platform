import type { EntitySchema } from "typeorm";

import { coreEntities } from "@awp/platform-persistence-typeorm";

export const coreOnlyEntities: readonly EntitySchema[] = coreEntities;
