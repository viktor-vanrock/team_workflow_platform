import type {
  ClassificationReference,
  StableKey,
  Uuid,
  VersionedReference,
} from "../shared/primitives.ts";

export type MembershipState = "ACTIVE" | "SUSPENDED" | "REVOKED";
export type ProjectState = "ACTIVE" | "SUSPENDED" | "ARCHIVED";
export type AccessEffect = "ALLOW" | "DENY";

export interface Identity {
  readonly id: Uuid;
  readonly issuer: string;
  readonly subject: string;
  readonly kind: "HUMAN" | "SERVICE";
  readonly displayName: string;
}

export interface Workspace {
  readonly id: Uuid;
  readonly key: StableKey;
  readonly name: string;
  readonly state: "ACTIVE" | "SUSPENDED";
}

export interface WorkspaceMembership {
  readonly ref: VersionedReference;
  readonly workspaceId: Uuid;
  readonly principalId: Uuid;
  readonly state: MembershipState;
  readonly validFrom: Date;
  readonly validUntil?: Date;
  readonly revokedAt?: Date;
}

export interface Project {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly key: StableKey;
  readonly state: ProjectState;
  readonly classification: ClassificationReference;
}

export interface ProjectEntitlement {
  readonly ref: VersionedReference;
  readonly workspaceId: Uuid;
  readonly projectId: Uuid;
  readonly principalId: Uuid;
  readonly effect: AccessEffect;
  readonly permissions: ReadonlySet<string>;
  readonly classificationCeiling: ClassificationReference;
  readonly validFrom: Date;
  readonly validUntil?: Date;
  readonly revokedAt?: Date;
}

export interface RoleAssignment {
  readonly ref: VersionedReference;
  readonly workspaceId: Uuid;
  readonly projectId?: Uuid;
  readonly principalId: Uuid;
  readonly roleKey: StableKey;
  readonly permissions: ReadonlySet<string>;
  readonly effect: AccessEffect;
  readonly validFrom: Date;
  readonly validUntil?: Date;
  readonly revokedAt?: Date;
}

export interface AuthorizationFacts {
  readonly membership?: WorkspaceMembership;
  readonly entitlements: readonly ProjectEntitlement[];
  readonly roleAssignments: readonly RoleAssignment[];
}
