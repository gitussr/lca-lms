# Contributing to LCA LMS

This project follows the process defined in
`docs/LCA LMS — Master Project Prompt v1.0.md`. Read it first. The essentials:

## 1. One feature per day

Work proceeds as **one meaningful feature at a time**, taken from the
[MVP Feature Backlog](docs/LCA%20LMS%20%E2%80%94%20MVP%20Feature%20Backlog%20and%20User%20Stories%20v1.0.md).
Do not bundle unrelated changes. Do not pull P1/P2 work forward without a scope decision
(Master Prompt §27).

Before writing code for a feature, expand it into the **Daily Development Format**
(Master Prompt §25): Goal, Scope, Out of Scope, Acceptance Criteria, Architecture / DB / API
/ UI impact, Security, Test Plan.

## 2. Branch model

- `main` is always releasable. No direct pushes for feature work — use a branch and a PR.
- Branch naming: `feat/F-00X-short-slug`, `fix/short-slug`, `chore/short-slug`,
  `docs/short-slug`, `test/short-slug`, `refactor/short-slug`.
- Keep branches short-lived; rebase on `main` before opening the PR.

> `main` branch protection (require PR + green CI) should be enabled in the GitHub repo
> settings once CI exists (F-009). Until then, small-team rule: **no unreviewed commits to
> `main` for feature work; foundation scaffolding commits are allowed with a clear message.**

## 3. Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/). Format:

```
<type>(<scope>): <summary in imperative mood>

<body: what and why, not how>
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `build`, `ci`.

**Scopes** follow the backend modules and areas: `auth`, `users`, `students`, `teachers`,
`courses`, `batches`, `enrollment`, `syllabus`, `lessons`, `videos`, `live-classes`,
`progress`, `db`, `api`, `frontend`, `infra`, `deps`.

Examples (from Master Prompt §34):

```
feat(auth): add student login
feat(course): create course management
fix(auth): prevent unauthorized access
test(enrollment): add enrollment authorization tests
refactor(video): isolate video access service
```

Do not make giant commits containing unrelated features.

## 4. Definition of Done

A feature is **DONE** only when (Master Prompt §24):

- [ ] Requirements understood; scope controlled.
- [ ] Implementation complete; happy path works.
- [ ] Important edge cases tested.
- [ ] **Authorization tested** (role + object-level / IDOR).
- [ ] **Input validation tested.**
- [ ] Errors handled; no sensitive data leaked in errors or logs.
- [ ] No obvious security vulnerability remains (Master Prompt §19 checklist answered).
- [ ] Existing functionality still works; relevant automated tests pass.
- [ ] Code reviewed / refactored.
- [ ] Documentation and project state updated (backlog status, README status table).
- [ ] Git commit(s) made with conventional messages.

"Works on my machine" is not the Definition of Done.

## 5. Security is not optional

Every protected endpoint enforces authentication **and** explicit authorization on the
backend. Frontend restrictions are never a security control (invariant 7). Never commit
secrets — use `.env` (git-ignored) and keep `.env.example` current.

## 6. Local checks before pushing

```bash
npm run format:check
npm run lint
# plus the backend/frontend test suites once they exist
```
