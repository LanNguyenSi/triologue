# Shared Secrets + Runner Backlog (Phase A-D)
**Date:** 2026-02-24  
**Companion doc:** `docs/SHARED_SECRETS_RUNNER_ARCHITECTURE_PLAN_2026-02-24.md`  
**Goal:** Deliver secure, policy-gated secret usage for agent-driven implementation workflows without exposing secret values.

---

## 1. Planning Conventions

## 1.1 Priority
- `P0` = foundational blocker
- `P1` = core MVP
- `P2` = enhancement / hardening

## 1.2 Effort (rough)
- `S` = 0.5-1 day
- `M` = 1-2 days
- `L` = 3-4 days

## 1.3 Status
- `todo`
- `in_progress`
- `done`
- `blocked`

---

## 2. Milestone View

## Phase A - Policy Foundation (Security Baseline)
Target outcome: Secret policies are explicit, validated, and enforceable.

## Phase B - Read-safe Runner Git (MVP runtime)
Target outcome: Agents can clone/pull securely through runner using secret refs.

## Phase C - Write Operations + PR (Controlled automation)
Target outcome: Push + PR creation with policy and optional approvals.

## Phase D - Agent Coding Workflow (End-to-end implementation)
Target outcome: Agent can implement changes via runner workspace and raise PRs.

---

## 3. Phase A Tickets

### A-01 - Secret permissions schema v2 + validator
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Scope:**
  - Define canonical schema for `ProjectSecret.permissions` (`version=2`).
  - Add server-side JSON validation and normalization.
  - Default-deny behavior for unknown/invalid policy.
- **Deliverables:**
  - Validator module in server (e.g. `services/secretPolicy.ts`).
  - Unit tests for allow/deny and malformed payloads.
- **Acceptance Criteria:**
  - Invalid permissions payload rejected with `400`.
  - Missing policy fields do not grant implicit access.
  - `expiresAt` denies after deadline.

### A-02 - Secret policy decision engine
- **Priority:** P0
- **Effort:** M
- **Depends on:** A-01
- **Scope:**
  - Implement `evaluateSecretPolicy()` API:
    - input: caller, tool, host/repo, method class (read/write)
    - output: allow/deny + reason code
  - Integrate deny reasons for audit and client feedback.
- **Deliverables:**
  - Pure policy evaluation function + fixtures.
  - Decision reason codes (e.g. `DENY_AGENT_NOT_ALLOWED`).
- **Acceptance Criteria:**
  - Deterministic decisions for same input.
  - Every deny includes machine-readable reason code.

### A-03 - Migration/backfill for existing permissions
- **Priority:** P1
- **Effort:** S
- **Depends on:** A-01
- **Scope:**
  - Add compatibility adapter from legacy permissions JSON to v2.
  - Backfill script for existing rows where possible.
- **Deliverables:**
  - Backfill script under server migration/scripts.
  - Runbook in docs.
- **Acceptance Criteria:**
  - Existing secrets remain usable for owner flows.
  - No row ends in permissive undefined state.

### A-04 - Secret usage audit model
- **Priority:** P1
- **Effort:** M
- **Depends on:** A-02
- **Scope:**
  - Add `secret_usage_logs` table/model.
  - Persist usage events for every secret-backed tool attempt.
- **Deliverables:**
  - Prisma schema + migration.
  - Write helper: `logSecretUsage()`.
- **Acceptance Criteria:**
  - Both success and deny events are logged.
  - Log includes caller, tool, target ref, decision, timestamp.

---

## 4. Phase B Tickets

### B-01 - Tool jobs data model + queue skeleton
- **Priority:** P0
- **Effort:** L
- **Depends on:** A-02
- **Scope:**
  - Create `tool_jobs` and `tool_job_events`.
  - Implement enqueue/start/finish lifecycle.
  - Define state machine (`queued/running/succeeded/failed/...`).
- **Deliverables:**
  - Prisma models + migration.
  - Job service with transition guards.
- **Acceptance Criteria:**
  - Invalid state transitions are blocked.
  - Terminal jobs always have `finishedAt`.

### B-02 - Runner workspace manager (create/reuse/lock)
- **Priority:** P0
- **Effort:** L
- **Depends on:** B-01
- **Scope:**
  - Add `project_workspaces` model.
  - Workspace lock per active job.
  - Reuse strategy by project+repo+branch.
- **Deliverables:**
  - Workspace manager service.
  - Lock conflict handling and retry strategy.
- **Acceptance Criteria:**
  - No concurrent write jobs on same workspace.
  - Lock release guaranteed on job terminal state.

### B-03 - Git clone tool endpoint + worker action
- **Priority:** P0
- **Effort:** L
- **Depends on:** A-02, B-01, B-02
- **Scope:**
  - Add `POST /api/projects/:id/tools/git/clone`.
  - Resolve secret by `secretRef`, evaluate policy, execute clone in runner.
  - Return `jobId`.
- **Deliverables:**
  - API route + worker action.
  - Policy gate + secret usage logging.
- **Acceptance Criteria:**
  - Agent can clone allowed repo with allowed secret.
  - Agent cannot clone disallowed repo (clear deny code).
  - Secret value never appears in response or logs.

### B-04 - Git pull tool endpoint + worker action
- **Priority:** P1
- **Effort:** M
- **Depends on:** B-03
- **Scope:**
  - Add `POST /api/projects/:id/tools/git/pull`.
  - Use existing workspace and secret policy.
- **Deliverables:**
  - Pull route and worker implementation.
  - Tests for stale workspace recovery.
- **Acceptance Criteria:**
  - Pull succeeds in valid workspace.
  - Pull fails gracefully if workspace lock held by another job.

### B-05 - Redaction middleware for tool logs
- **Priority:** P0
- **Effort:** M
- **Depends on:** B-01
- **Scope:**
  - Redact token-like patterns and known secret values in logs/events.
  - Enforce redaction before persistence and before API return.
- **Deliverables:**
  - `redactSensitiveOutput()` utility + tests.
- **Acceptance Criteria:**
  - Secret values never appear in stored job events.
  - Regression test proves redaction of known injected token.

---

## 5. Phase C Tickets

### C-01 - Git push tool endpoint + worker action
- **Priority:** P1
- **Effort:** M
- **Depends on:** B-03, B-05
- **Scope:**
  - Add `POST /api/projects/:id/tools/git/push`.
  - Enforce `allowWrite` + tool allowlist + repo allowlist.
- **Deliverables:**
  - Push route + policy checks + audit.
- **Acceptance Criteria:**
  - Read-only secrets cannot push.
  - Push to unauthorized repo is denied.

### C-02 - PR creation endpoint (GitHub PAT mode first)
- **Priority:** P1
- **Effort:** L
- **Depends on:** C-01
- **Scope:**
  - Add `POST /api/projects/:id/tools/git/create-pr`.
  - Generate PR title/body from payload.
  - Return PR URL in job result.
- **Deliverables:**
  - GitHub provider adapter (PAT mode).
  - Job result schema with PR metadata.
- **Acceptance Criteria:**
  - PR successfully created in allowed repo.
  - Deny when policy excludes `git.create_pr`.

### C-03 - Approval gate for sensitive actions
- **Priority:** P2
- **Effort:** M
- **Depends on:** C-01
- **Scope:**
  - Add approval requirement for configured tools (`git.push`, `deploy.run`).
  - Pending jobs wait until owner approval.
- **Deliverables:**
  - `approval_requests` model + API.
  - UI action for owner approve/reject.
- **Acceptance Criteria:**
  - Sensitive jobs cannot run without explicit approval when required.
  - Approval decision is auditable.

### C-04 - Repo connection model + connect/disconnect API
- **Priority:** P2
- **Effort:** M
- **Depends on:** B-03
- **Scope:**
  - Add `repo_connections` model.
  - Add connect/disconnect endpoints for project repo metadata.
- **Deliverables:**
  - Persisted repo config with auth mode.
- **Acceptance Criteria:**
  - Project can store one active repo connection.
  - Disconnect disables new git jobs tied to that connection.

---

## 6. Phase D Tickets

### D-01 - Runner file tools (read/list/write/apply patch)
- **Priority:** P1
- **Effort:** L
- **Depends on:** B-02
- **Scope:**
  - Implement workspace file APIs for agent workflows.
  - Restrict operations to workspace root.
- **Deliverables:**
  - Tool endpoints:
    - `workspace.list_files`
    - `workspace.read_file`
    - `workspace.write_file`
    - `workspace.apply_patch`
- **Acceptance Criteria:**
  - Agent can modify files in workspace only.
  - Path traversal attempts are blocked.

### D-02 - Runner command execution tool (allowlist)
- **Priority:** P1
- **Effort:** M
- **Depends on:** D-01
- **Scope:**
  - Add `workspace.run_command` with command allowlist.
  - Capture and redact output.
- **Deliverables:**
  - Command policy config.
  - Timeout and max-output protections.
- **Acceptance Criteria:**
  - Allowed commands run successfully.
  - Disallowed commands are rejected with reason code.

### D-03 - End-to-end "Implement Task" orchestrator
- **Priority:** P1
- **Effort:** L
- **Depends on:** D-01, D-02, C-01, C-02
- **Scope:**
  - Compose clone -> edit -> test -> commit -> push -> PR flow.
  - Link results back to task/project context.
- **Deliverables:**
  - Orchestrator service + job template.
- **Acceptance Criteria:**
  - Agent can complete code-change loop without secret exposure.
  - Task receives PR URL and final status.

### D-04 - UX for tool jobs and audits in project page
- **Priority:** P2
- **Effort:** M
- **Depends on:** B-01, A-04
- **Scope:**
  - Add project tab/panel for:
    - active jobs
    - job history
    - secret usage events
- **Deliverables:**
  - UI list + details view.
- **Acceptance Criteria:**
  - Team can inspect what agent ran and when.
  - No secret values visible in UI payloads.

---

## 7. Cross-Cutting Hardening Tickets

### X-01 - Structured reason codes + error contract
- **Priority:** P1
- **Effort:** S
- **Depends on:** A-02
- **Acceptance Criteria:**
  - Every deny/failure returns stable `code`.

### X-02 - Rate limiting for tool endpoints
- **Priority:** P1
- **Effort:** S
- **Depends on:** B-01
- **Acceptance Criteria:**
  - Abuse-protection in place for agent and user callers.

### X-03 - Observability dashboards
- **Priority:** P2
- **Effort:** M
- **Depends on:** B-01, A-04
- **Acceptance Criteria:**
  - Metrics for job volume, duration, denies, failures.

---

## 8. Suggested Sprint Breakdown

## Sprint 1 (Security + foundation)
- A-01, A-02, A-04, B-01

## Sprint 2 (MVP runtime read path)
- B-02, B-03, B-04, B-05

## Sprint 3 (Write path + PR)
- C-01, C-02, X-01

## Sprint 4 (End-to-end implementation)
- D-01, D-02, D-03

## Sprint 5 (Hardening + UX)
- C-03, C-04, D-04, X-02, X-03

---

## 9. Definition of Done (Backlog Level)

A ticket is `done` only if:
1. Code merged with tests.
2. Security constraints validated (no secret leakage).
3. Audit entries emitted where required.
4. API contract documented (OpenAPI or internal spec).
5. Feature flag behavior documented if flag-protected.

---

## 10. Immediate Next 5 Tickets (Execution Order)

1. **A-01** Secret permissions schema v2 + validator  
2. **A-02** Secret policy decision engine  
3. **B-01** Tool jobs data model + queue skeleton  
4. **B-02** Runner workspace manager  
5. **B-03** Git clone endpoint + worker action

