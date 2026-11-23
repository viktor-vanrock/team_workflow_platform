import type { DataSource } from "typeorm";

import {
  ConfirmOperationalEffect,
  type ExternalCommandLifecycleContribution,
  type OperationalConfirmationHook,
  OperationalConfirmationHookRegistry,
  PlatformActionExecutor,
  type PlatformActionHandler,
  PlatformActionHandlerRegistry,
  type PlatformActionPort,
} from "@awp/platform-core";
import {
  TypeOrmConfirmationUnitOfWork,
  type TypeOrmExternalCommandLifecycleOptions,
  TypeOrmExternalCommandLifecycleUnitOfWork,
  type TypeOrmOperationalConfirmationOptions,
} from "@awp/platform-persistence-typeorm";

export interface GenericHandlerContributions<TCandidate = unknown, TResult = unknown> {
  readonly confirmationHooks?: readonly OperationalConfirmationHook[];
  readonly externalCommandLifecycle?: readonly ExternalCommandLifecycleContribution[];
  readonly platformActionHandlers?: readonly PlatformActionHandler<TCandidate, TResult>[];
}

export interface GenericHandlerCompositionOptions<TCandidate = unknown, TResult = unknown> {
  readonly source: DataSource;
  readonly platformActions: PlatformActionPort<TCandidate, TResult>;
  readonly contributions?: GenericHandlerContributions<TCandidate, TResult>;
  readonly confirmation?: TypeOrmOperationalConfirmationOptions;
  readonly lifecycle?: TypeOrmExternalCommandLifecycleOptions;
}

export function composeGenericHandlers<TCandidate = unknown, TResult = unknown>(
  options: GenericHandlerCompositionOptions<TCandidate, TResult>,
) {
  const confirmationHooks = new OperationalConfirmationHookRegistry(
    options.contributions?.confirmationHooks ?? [],
  );
  const externalCommandLifecycle = new TypeOrmExternalCommandLifecycleUnitOfWork(
    options.source,
    options.contributions?.externalCommandLifecycle ?? [],
    options.lifecycle,
  );
  const platformActionHandlers = new PlatformActionHandlerRegistry(
    options.contributions?.platformActionHandlers ?? [],
  );
  return Object.freeze({
    confirmationHooks,
    confirmOperationalEffect: new ConfirmOperationalEffect(
      new TypeOrmConfirmationUnitOfWork(options.source, options.confirmation),
      confirmationHooks,
    ),
    externalCommandLifecycle,
    platformActionHandlers,
    platformActionExecutor: new PlatformActionExecutor(
      options.platformActions,
      platformActionHandlers,
    ),
  });
}
