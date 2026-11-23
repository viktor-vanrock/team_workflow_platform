# Pilot recovery procedure

Use this procedure for an approved recovery rehearsal or incident. The restore
target must be a disposable, explicitly identified database with worker egress
fenced. Never restore over the active local stack or a live pilot database.

## Prepare and fence

1. Record the fault declaration time, last confirmed recoverable commit, current
   deployment/configuration/image refs, active runtime instance IDs, owner and the
   approved RPO/RTO policy.
2. Fence every old API and worker instance at the database and provider gateways.
   Preserve proof of the instance IDs and fence result. An expired process lease
   is not enough when the process can still reach a provider.
3. Create the isolated target identity record with `isolated=true` and
   `fenced=true`. Confirm it has no active runtime lease. A mismatch or active
   target stops the procedure before `pg_dump`, PITR, or provider I/O.

## Backup and restore

For a logical rehearsal, collect the scoped canonical, audit, delivery,
configuration, public-key and artifact inventories. Pin database major version,
schema versions, watermarks, protected backup location, retention policy, dump
digest and byte count. The manifest contains references and public verification
keys; it must not contain credentials, private keys or provider payloads.

Restore the logical dump only to the validated isolated target. Physical PITR is
a separate operation: require the approved recovery provider, base-backup digest,
timeline, complete ordered WAL chain and requested recovery point from IN-08.
Never present a logical restore as PITR evidence.

## Verify and reconcile

1. Verify schema pins, binding hashes and the append-only audit chain.
2. Verify historical signatures with the archived public keys across rotations.
   Private signing keys remain under the secret-store owner's recovery procedure.
3. A required artifact needs its expected bytes and metadata. A policy-compliant
   expired artifact may lack bytes, but its immutable metadata must remain.
4. Reclaim expired PostgreSQL delivery leases and restart workers while egress is
   still fenced.
5. Reconcile every possibly applied effect through provider reads. A matching
   Jira/GitLab/Mattermost object confirms the original command. A delayed empty
   result, multiple matches, divergence, or a provider-only post-backup effect is
   quarantined. Do not repeat POST/PUT and do not rewrite stale Jira state.

## Measure, rollback and resume

RPO is the interval from the last confirmed recoverable commit to the fault
declaration. RTO starts at the fault declaration and ends only after schema,
integrity, queue, provider reconciliation and service checks pass; database startup
does not end RTO. Compare both measurements with the approved policy and retain the
timestamps and owner evidence.

Rollback selects a compatible image, configuration and schema reader. Do not run
destructive down-migrations and do not attempt to undo external provider history.
Keep unresolved effects quarantined.

`READY_FOR_RESUME` does not enable writes. Obtain a separate exact human approval
bound to the recovery run, new runtime ID, current image/configuration, fence
version and resume nonce. Resume only that runtime. Recheck the old-instance fence,
then monitor audit/effect counts and suspend immediately on any duplicate or scope
violation.
