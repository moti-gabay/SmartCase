# Team Agent Responsibility Contract (ARC)
> **Document Status:** Active Standard | **Version:** 1.1 (Includes Active Hooks) | **Scope:** All Developers & AI Agents

---

## 1. Purpose & Core Philosophy
This contract defines the operational boundaries, autonomy limits, security guardrails, and human accountability framework for using autonomous AI Agents (e.g., Claude Code, Cursor, CLI agents) within our team's codebase.

> ⚠️ **The Golden Rule:** AI Agents are untrusted code-generation tools. They bear no legal or professional accountability. **The engineer who invokes an agent holds 100% ownership and accountability for every line of code merged.**

---

## 2. Autonomy Matrix & Operational Permissions

| Activity / Command Scope | Action Description | Permission & Control Mechanism | Autonomy Status |
| :--- | :--- | :--- | :--- |
| **Read & Analyze** | Reading files, architecture exploration, analyzing errors, drafting specs. | Read-Only (Unrestricted) | 🟢 **Full Auto** |
| **Quality & Harness Checks** | Running `tsc --noEmit`, ESLint/Prettier, local unit tests. | Autonomous within feature branch | 🟢 **Full Auto** |
| **Local Code Modification** | Writing code, creating services, components, and tests in `feature/*`. | Allowed per-session / Auto-Edit mode | 🟡 **Requires Supervision** |
| **Git Commits & PRs** | Creating local commits and pushing feature branches. | Explicit human approval for commit text | 🟡 **Human Approved** |
| **Database & Schema Changes**| Modifying Prisma schemas, running migrations, executing mutation scripts. | Explicit human confirmation per execution | 🟡 **Strict Confirmation** |
| **Secrets & `.env` Access** | Accessing `.env`, reading API keys, exposing token credentials. | Hard-blocked by `PreToolUse` Hooks | 🔴 **STRICTLY PROHIBITED** |
| **Direct Push to `main`** | Bypassing PR process, force-pushing, merging without code review. | Blocked by Branch Protection & Deny Rules | 🔴 **STRICTLY PROHIBITED** |

---

## 3. Implemented Active Security Guardrails & Hooks
Our repository incorporates an active multi-layered defense system to enforce safety during autonomous agent runs:

* **PreToolUse Hook (`security-bash-env-check.sh`):** An active PreToolUse hook intercepts all Bash commands prior to execution. It programmatically scans and blocks any attempt to inspect, display, or leak environment variables or `.env` files.
* **Hardcoded Deny Rules (`.claude/settings.json`):** Strict CLI-level rules prevent destructive file system operations (e.g., `rm -rf`), raw database mutations, or direct main branch pushes—overriding all CLI flags.
* **UserPromptSubmit Hook & Prompt Scanning:** Active input-sanitization hooks scan user prompts to prevent secret leakage or malicious instruction injections before reaching the model context.
* **Structured Audit Trail (`logs/security-audit.jsonl`):** All blocked tool invocations, security breaches, and permission denials are appended to an immutable JSONL audit trail for post-run evaluation.

---

## 4. Harness-Ready & Definition of Done (DoD)
No agent-generated code shall be submitted as a Pull Request unless it strictly satisfies all four quality gates:

1. **Zero Type Errors:** Clean compilation via `tsc --noEmit`.
2. **Zero Lint Debt:** `eslint` passes with **0 errors and 0 warnings** (no unapproved suppressions).
3. **100% Deterministic Test Suite:** All unit and integration tests pass consistently with zero flakiness.
4. **Visual UI Verification:** For UI-related features, automated screenshots must be rendered to `_bmad-output/screenshots/` and visually verified.

---

## 5. Human Ownership & Review Protocol
* **100% Code Ownership:** "The AI wrote it this way" is an invalid explanation in Code Reviews. The author of the PR is fully responsible for security, performance, and maintainability.
* **Mandatory Human Code Review:** Every agent-generated PR requires at least one human peer review before merging to `main`.
* **Git Hygiene:** Feature branches must be kept clean, rebased against `main`, and squashed upon merge. Temporary branches must be deleted post-merge.

---

### Team Sign-off
- **Engineering Lead Signature:** ______________________
- **Developer Signature:** ______________________