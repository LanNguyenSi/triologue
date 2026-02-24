# Shared Secrets + Runner Execution Architecture Plan
**Date:** 2026-02-24  
**Audience:** Human maintainers + BYOA/Platform agents  
**Scope:** Secure usage of project-scoped secrets for repository operations and implementation workflows without exposing secret values to agents.

---

## 1. Executive Summary

The product promise is `team-scoped API keys & credentials`.  
For high-value use cases (clone/pull/push/PR/deploy), this only works safely if:

1. Agents reference secrets by `secretRef` (name or id), never by raw value.
2. Secret resolution happens server-side only.
3. Execution happens in Triologue-managed runner workspaces.
4. Agent receives result artifacts/logs, not credentials.

**Core pattern:**  
- `Agent = Brain` (planning, deciding, sequencing)  
- `Runner = Hands` (filesystem, commands, git, network to providers)

---

## 2. Current State Snapshot (Repository)

### 2.1 Existing models/routes
- Project secrets exist as `ProjectSecret` with `encryptedValue` and `permissions` JSON.
  - File: `server/prisma/schema.prisma`
- Project secret CRUD exists under project routes.
  - File: `server/src/routes/projects.ts`
  - Endpoints:
    - `POST /api/projects/:id/secrets`
    - `GET /api/projects/:id/secrets` (no value)
    - `PUT /api/projects/:id/secrets/:secretId`
    - `DELETE /api/projects/:id/secrets/:secretId`
    - `PUT /api/projects/:id/secrets/:secretId/permissions`
- Secret encryption helper exists (`encryptSecret`, `decryptSecret`).
  - File: `server/src/utils/encryption.ts`

### 2.2 Security-relevant observation
- `decryptSecret` is currently not used in runtime tool execution paths.
- There is no runner tool pipeline yet for secure secret consumption.
- Therefore current system stores secrets safely at rest, but does not yet provide secure secret-backed execution for BYOA implementation workflows.

---

## 3. Problem Statement

Target use case:
- Agent should use `GITHUB_PAT` to clone/pull/push and implement code.
- Agent must not see or exfiltrate secret value.

Constraint:
- If execution occurs inside external BYOA agent infrastructure, secret confidentiality cannot be guaranteed.

Conclusion:
- Secret-backed git and implementation operations MUST run in Triologue-controlled runtime.

---

## 4. Goals / Non-Goals

### 4.1 Goals
- Secret value is never returned to agents/clients.
- Agent can still perform end-to-end coding operations.
- Repo operations (`clone`, `pull`, `push`, `create_pr`) are policy-gated and auditable.
- Execution is reproducible and isolated per workspace.

### 4.2 Non-Goals (MVP)
- Full arbitrary shell access for external BYOA nodes.
- Multi-tenant distributed runner orchestration with autoscaling.
- Full secrets manager federation (Vault/KMS multi-provider) in first iteration.

---

## 5. Trust Boundaries

1. **Trusted boundary A: API + DB + Secret resolver** (Triologue backend)
2. **Trusted boundary B: Runner container/VM** (ephemeral controlled env)
3. **Untrusted boundary: external BYOA webhook service**

Rules:
- Secret plaintext may only exist transiently in A/B.
- Secret plaintext must never cross to untrusted boundary.

---

## 6. Threat Model

### 6.1 Threats
- T1: Agent prompt injection tries to print secret.
- T2: Runner logs accidentally include secret.
- T3: Agent calls tool for unauthorized repo.
- T4: Agent uses write operations with read-only secret.
- T5: Workspace residue leaks credentials across jobs.
- T6: Human member triggers dangerous operation with wrong permissions.

### 6.2 Required controls
- C1: Policy engine checks agent/tool/repo/host before execution.
- C2: Log redaction pass for known secret patterns and token-like substrings.
- C3: Ephemeral credential injection only (no persistent file token if avoidable).
- C4: Workspace isolation and lock ownership.
- C5: Full audit trail for secret usage and command intents.
- C6: Optional approvals for sensitive tool classes (`git.push`, `deploy`).

---

## 7. Reference Architecture

## 7.1 Components

1. **Tool Gateway API**
- Accepts tool requests from authenticated humans/agents.
- Performs authorization and policy checks.
- Creates asynchronous jobs.

2. **Secret Policy Engine**
- Evaluates `ProjectSecret.permissions` against:
  - caller identity (`userId` / agent `userId`)
  - tool capability (`git.clone`, `git.push`, etc.)
  - target (`repoUrl`, host, branch, env)

3. **Job Queue + Worker**
- Pulls pending jobs.
- Executes inside runner environment.

4. **Runner Runtime**
- Managed filesystem workspace.
- Executes command/tool operations.
- Injects secrets only in execution scope.

5. **Workspace Manager**
- Creates/reuses workspace by `projectId + repo + branch`.
- Handles locking and concurrency.

6. **Audit + Observability**
- Stores intent, policy decision, command metadata, result status, duration.

## 7.2 Design principle
- BYOA agent receives job outputs and artifacts.
- BYOA agent never receives credentials.

---

## 8. Secret Permission Schema (ProjectSecret.permissions v2)

Current `permissions` is generic JSON. Standardize with this schema:

```json
{
  "version": 2,
  "allowedAgents": ["user_cuid_1", "user_cuid_2"],
  "allowedUsers": ["user_cuid_owner"],
  "allowedTools": ["git.clone", "git.pull", "git.push", "git.create_pr"],
  "allowedHosts": ["github.com"],
  "allowedRepos": [
    "github.com/org/repo-a",
    "github.com/org/repo-b"
  ],
  "allowWrite": true,
  "requiresApprovalFor": ["git.push", "deploy.run"],
  "expiresAt": "2026-12-31T23:59:59.000Z"
}
```

Validation rules:
- Missing arrays default to empty deny-set.
- `allowWrite=false` MUST block write-class tools.
- `expiresAt` MUST hard-fail after deadline.

---

## 9. Data Model Additions (MVP)

Add tables (names are suggestions):

1. `tool_jobs`
- `id`, `projectId`, `requestedBy`, `requestedByType`, `tool`, `status`
- `inputJson` (without secrets), `resultJson`, `errorJson`
- `workspaceId`, `startedAt`, `finishedAt`, `createdAt`

2. `tool_job_events`
- `id`, `jobId`, `level`, `message`, `metaJson`, `createdAt`
- Store redacted logs only.

3. `project_workspaces`
- `id`, `projectId`, `repoUrl`, `branch`, `path`, `status`, `lockedByJobId`
- `lastUsedAt`, `createdAt`, `updatedAt`

4. `secret_usage_logs`
- `id`, `projectSecretId`, `projectId`, `toolJobId`, `usedBy`
- `tool`, `targetRef`, `success`, `createdAt`

5. `repo_connections` (optional in first pass, recommended)
- `id`, `projectId`, `provider`, `repoOwner`, `repoName`, `defaultBranch`
- `authMode` (`github_app` | `secret_ref`)
- `installationId` (for GitHub App)

---

## 10. API Contract (MVP)

All endpoints project-scoped and authenticated (JWT or BYOA token where allowed).

## 10.1 Git tool endpoints

1. `POST /api/projects/:id/tools/git/clone`
```json
{
  "repoUrl": "https://github.com/org/repo.git",
  "branch": "main",
  "secretRef": "GITHUB_PAT",
  "workspaceMode": "create_or_reuse"
}
```

2. `POST /api/projects/:id/tools/git/pull`
```json
{
  "workspaceId": "ws_123",
  "branch": "main",
  "secretRef": "GITHUB_PAT"
}
```

3. `POST /api/projects/:id/tools/git/push`
```json
{
  "workspaceId": "ws_123",
  "branch": "task/tri-123-fix-auth",
  "secretRef": "GITHUB_PAT",
  "force": false
}
```

4. `POST /api/projects/:id/tools/git/create-pr`
```json
{
  "workspaceId": "ws_123",
  "baseBranch": "main",
  "headBranch": "task/tri-123-fix-auth",
  "title": "fix(auth): handle expired token refresh",
  "body": "Auto-generated from Task tri-123",
  "secretRef": "GITHUB_PAT"
}
```

## 10.2 Job inspection

`GET /api/projects/:id/tool-jobs/:jobId`
```json
{
  "id": "job_123",
  "status": "succeeded",
  "tool": "git.clone",
  "workspaceId": "ws_123",
  "result": {
    "repoPath": "/runner/workspaces/ws_123",
    "headCommit": "abc123"
  },
  "events": []
}
```

## 10.3 Error shape

```json
{
  "error": "Secret policy denies git.push for this caller",
  "code": "SECRET_POLICY_DENIED"
}
```

---

## 11. Job State Machine

Allowed states:
- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `timed_out`

Transitions:
- `queued -> running`
- `running -> succeeded|failed|cancelled|timed_out`

Rules:
- MUST be monotonic (no backward transition).
- MUST set `startedAt` on first `running`.
- MUST set `finishedAt` on terminal states.

---

## 12. Runner Secret Injection Strategy

For git operations, prefer one of:

1. `GIT_ASKPASS` helper script with token from environment.
2. In-memory credential helper process.

Avoid:
- Writing token into persistent remote URL in `.git/config`.
- Printing token-containing command line.

Cleanup requirements:
- Remove temporary helper files.
- Zero/unset environment variables after command.
- Ensure terminal output is redacted before persistence.

---

## 13. Agent Interaction Model

## 13.1 Agent-visible contract
- Agent sees:
  - secret metadata (`name`, `lastUsedAt`, capabilities) if allowed
  - tool endpoints and job statuses
  - workspace handles and redacted logs
- Agent does not see:
  - plaintext secret
  - decrypted value
  - raw credential artifacts

## 13.2 Recommended orchestration loop
1. Agent asks: `git.clone(secretRef=GITHUB_PAT)`
2. Polls job until `succeeded`
3. Uses filesystem/code tools in same workspace
4. Runs tests
5. Calls `git.push` / `git.create-pr`
6. Posts PR result back to room/task

---

## 14. GitHub Connect Repo Flow

Preferred auth order:
1. GitHub App installation (best)
2. `secretRef` PAT fallback

Flow:
1. Owner connects repo in project settings.
2. Save repo connection metadata.
3. Validate first clone via runner.
4. Attach default workflow policy for git tools.

Stored object (example):
```json
{
  "provider": "github",
  "repoOwner": "org",
  "repoName": "repo",
  "defaultBranch": "main",
  "authMode": "secret_ref",
  "secretRef": "GITHUB_PAT"
}
```

---

## 15. Automated PR Flow (Post-MVP ready)

Trigger options:
- Task status enters `in_review`
- Manual "Create PR" action
- Scheduled batch run

Flow:
1. Ensure workspace branch exists.
2. Apply changes from agent tool sequence.
3. Run quality gates (`lint/test/build`).
4. Create commit(s) with conventional format.
5. Push branch and open PR.
6. Update task with PR URL and check status.

Guardrails:
- No direct push to protected branches.
- Max changed files/LOC threshold.
- Approval requirement for write operations when configured.

---

## 16. Access Control Matrix

| Actor | List secrets | Use `git.clone` | Use `git.push` | Edit secret |
|---|---|---|---|---|
| Project Owner | Yes | Yes (if policy) | Yes (if policy) | Yes |
| Team Human | Yes (metadata only if policy allows) | Yes (if policy) | Optional by policy | No |
| BYOA Agent user | Yes (metadata subset) | Yes (if `allowedAgents`) | Optional by policy | No |
| Runner service | Internal only | Executes | Executes | No |

Notes:
- Secret value never exposed to Owner/Team/Agent via API once saved.
- Owner may overwrite value, but never read plaintext back.

---

## 17. Audit and Observability

Minimum logs:
- Who requested (`userId`, `agentId`)
- Tool + target repo/host
- Secret ref used (name/id, not value)
- Policy decision + reason
- Duration, status, failure class

Metrics:
- `tool_jobs_total{tool,status}`
- `tool_job_duration_ms{tool}`
- `secret_usage_total{secretRef,tool,success}`
- `policy_denials_total{tool}`

Alerts:
- Excess policy denials spike
- Redaction failures
- Repeated failed pushes/clones

---

## 18. Rollout Plan

## Phase A: Policy foundation
- Standardize `permissions` schema v2.
- Add policy evaluator and validation.
- Keep feature flag off for agents.

## Phase B: Read-safe git operations
- Implement `git.clone` + `git.pull` via runner.
- Add job table and event stream.
- Add audit logging.

## Phase C: Write operations + approvals
- Implement `git.push` + `create-pr`.
- Add approval workflow for configured operations.

## Phase D: Agent coding workflow
- Wire workspace file tools.
- Add branch strategy and PR templates.
- Integrate with task workflow/project context.

---

## 19. Test Plan

### 19.1 Unit tests
- Policy evaluator allow/deny matrix
- Secret permission expiration
- Redaction engine behavior

### 19.2 Integration tests
- Agent requests clone with allowed secret
- Denied clone for unauthorized repo
- Push denied with read-only secret
- PR creation with allowed write policy

### 19.3 Security tests
- Prompt-injection attempt to print token
- Log scraping for token-like strings
- Workspace reuse cross-project isolation

---

## 20. Migration Notes

1. Existing secrets remain valid.
2. For existing `permissions` objects:
- apply compatibility adapter to v2 schema.
3. No plaintext migration needed.
4. Backfill `version=2` where missing (safe default deny for sensitive tools).

---

## 21. Open Questions

1. GitHub App rollout timeline vs PAT-only MVP?
2. Runner topology: per-project container vs shared pool?
3. Default approval policy for `git.push` by BYOA agents?
4. Max workspace retention duration?
5. Required human approval before `deploy.run`?

---

## 22. Agent Execution Checklist (Normative)

Agents implementing this plan MUST:
1. Never request or store plaintext secrets.
2. Use only `secretRef` in tool requests.
3. Treat secret-related errors as policy/security events, not retry blindly.
4. Keep all code changes in runner workspaces, not agent-local infra.
5. Link outputs (commit/PR URLs, logs) back to the originating task/project.

Platform implementation MUST:
1. Enforce policy before every secret-backed tool call.
2. Redact logs and persist only redacted output.
3. Record usage in audit logs for every secret-backed job.
4. Deny operations when policy is missing or ambiguous (default deny).

---

## 23. Immediate Next Steps (Suggested Ticket Order)

1. Define and validate `permissions v2` schema in backend.
2. Add `tool_jobs` + `tool_job_events` tables and basic worker loop.
3. Implement `git.clone` runner action with `secretRef` and policy gate.
4. Add `git.pull`, workspace lock/reuse.
5. Implement redaction middleware and `secret_usage_logs`.
6. Implement `git.push` + optional approval gate.
7. Implement `create-pr` with provider adapter.
8. Expose lightweight UI on project page: tool runs, status, audit trail.

---

## 24. Status

This document is a design and implementation blueprint.  
It does not claim that runner-based secret-backed git execution is already fully implemented in this repository.

