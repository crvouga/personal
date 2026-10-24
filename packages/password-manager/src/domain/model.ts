export type AuthMethod =
  | 'password'
  | 'passkey'
  | 'social'
  | 'sso'
  | 'magic-link'
  | 'hardware-key'
  | 'unknown';
export type CoverageState =
  | 'configured'
  | 'connected'
  | 'scanned'
  | 'incomplete'
  | 'skipped'
  | 'unsupported'
  | 'failed'
  | 'requires-user-action';
export type SourceKind =
  | 'bitwarden'
  | 'csv'
  | 'bitwarden-json'
  | 'mbox'
  | 'eml'
  | 'gmail'
  | 'microsoft'
  | 'imap'
  | 'inventory'
  | 'confirmed';
export interface Coverage {
  id: string;
  state: CoverageState;
  scanned: number;
  discovered: number;
  lastSuccess: string | null;
  cursor: string | null;
  filters: string;
  error: string | null;
}
export interface Evidence {
  vaultRevision?: string | null;
  identityProvider?: string;
  id: string;
  sourceId: string;
  sourceRef: string;
  observedAt: string;
  category:
    | 'vault'
    | 'export'
    | 'registration'
    | 'verification'
    | 'reset'
    | 'change'
    | 'security'
    | 'billing'
    | 'inventory'
    | 'confirmed';
  origin: string | null;
  domain: string | null;
  username: string | null;
  confirmed: boolean;
  reasons: string[];
  vaultId: string | null;
  candidateRef: string | null;
  unsupported: string[];
  auth: AuthMethod;
}
export interface Account {
  credentialRevision?: string | null;
  credentialVerifiedAt?: string | null;
  id: string;
  origin: string;
  username: string;
  confirmed: boolean;
  auth: AuthMethod;
  identityProvider: string | null;
  evidenceIds: string[];
  vaultIds: string[];
  credential: 'unknown' | 'stored' | 'verified' | 'stale';
  recovery: 'unknown' | 'user-attested' | 'verified';
  mfa: 'unknown' | 'user-attested' | 'verified';
  priority: number;
}
export type OperationState =
  | 'planned'
  | 'prerequisites_ready'
  | 'credential_staged'
  | 'change_submitting'
  | 'change_confirmed'
  | 'vault_updated'
  | 'login_verified'
  | 'completed'
  | 'requires_user_action'
  | 'outcome_unknown'
  | 'reconciliation_required'
  | 'failed'
  | 'cancelled';
export type OperationKind =
  | 'import'
  | 'rotate'
  | 'mfa-enroll'
  | 'factor-replace'
  | 'factor-remove'
  | 'passkey-enroll'
  | 'recovery-regenerate'
  | 'recovery-check'
  | 'delete-account'
  | 'delete-vault-item'
  | 'review-linked';
export interface Operation {
  targetFactor?: string | null;
  replacementOperationId?: string | null;
  importMode?: 'create' | 'merge-metadata' | 'replace-password' | 'preserve';
  id: string;
  planId: string;
  runId: string | null;
  accountId: string;
  kind: OperationKind;
  state: OperationState;
  resumeState: OperationState | null;
  vaultId: string | null;
  evidenceId: string | null;
  stagedRef: string | null;
  oldRef: string | null;
  expectedRevision: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  completedAt: string | null;
  attempts: number;
  error: string | null;
}
export interface PlanScope {
  targetFactor?: string | null;
  replacementOperationId?: string | null;
  importMode: 'create' | 'merge-metadata' | 'replace-password' | 'preserve';
  operationId: string;
  accountId: string;
  origin: string;
  username: string;
  auth: AuthMethod;
  kind: OperationKind;
  vaultId: string | null;
  evidenceId: string | null;
  candidateRef: string | null;
}
export interface MigrationIssue {
  accountId: string;
  evidenceId: string;
  reason:
    | 'unsupported-transfer-fields'
    | 'conflicting-import-candidates'
    | 'existing-vault-credential-preserved';
}
export interface Plan {
  vaultIdentity?: { server: string; email: string } | null;
  issues?: MigrationIssue[];
  scope?: PlanScope[];
  id: string;
  createdAt: string;
  operationIds: string[];
  authorizedAt: string | null;
  expiresAt: string;
  policy: 'inspect' | 'selected';
}
export interface UserAction {
  id: string;
  accountId: string | null;
  sourceId: string | null;
  operationId: string | null;
  runId: string | null;
  step: string;
  reason: string;
  destination: string | null;
  instructions: string[];
  prerequisites: string[];
  expiresAt: string | null;
  detection: string;
  resume: string;
  alternative: string;
  status: 'pending' | 'resolved' | 'skipped';
  attestation: 'none' | 'user';
}
export interface Run {
  id: string;
  createdAt: string;
  planId: string | null;
  state:
    | 'running'
    | 'completed'
    | 'requires-user-action'
    | 'partial'
    | 'failed'
    | 'cancelled';
  cancelled: boolean;
}
export interface AuditEvent {
  id: string;
  at: string;
  operationId: string;
  state: OperationState;
}
export interface IdentityDecision {
  id: string;
  evidenceId: string;
  origin: string;
  username: string;
  auth: AuthMethod;
  identityProvider: string | null;
  active: boolean;
  createdAt: string;
  previousId: string | null;
}
export interface ImportMapping {
  status?: 'imported' | 'updated' | 'preserved';
  id: string;
  sourceId: string;
  sourceRef: string;
  vaultId: string;
  operationId: string;
  verifiedAt: string;
}
export interface BackupRecord {
  id: string;
  createdAt: string;
  digest: string;
  verifiedAt: string | null;
  vaultItems: number;
}
export interface CandidateResolution {
  id: string;
  originalRef: string;
  candidateRef: string;
  unsupported: string[];
  createdAt: string;
}
export interface MaintenanceRecord {
  id: string;
  at: string;
  status: string;
  pendingActions: number;
  backupFresh: boolean;
  capabilityDigest: string;
  notificationDigest: string;
}
export interface Tables {
  maintenance: MaintenanceRecord;
  candidates: CandidateResolution;
  backups: BackupRecord;
  imports: ImportMapping;
  decisions: IdentityDecision;
  evidence: Evidence;
  accounts: Account;
  operations: Operation;
  plans: Plan;
  actions: UserAction;
  runs: Run;
  coverage: Coverage;
  events: AuditEvent;
}
