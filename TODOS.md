# TODOS

## WeChat Mini Program

### WeChat subscription messages

**What:** Add optional subscription messages for card expiry and study reminders after the mini program is stable.

**Why:** Remind users about time-sensitive account expiry and planned study without blocking the first mini-program release.

**Context:** The first release focuses on migrating the existing student App features. WeChat subscription messages require separate message templates, user opt-in, review, and operating rules. Revisit this only after login, account binding, study, exam, forum, and production monitoring are stable.

**Effort:** M
**Priority:** P3
**Depends on:** Mini-program production release and stable WeChat account binding

## M1 Chapter Learning

### Complete M1 release hardening

**What:** Finish the remaining managed-release safeguards: scoped recovery package and restore rehearsal, MySQL concurrency/failure tests, Web/admin E2E coverage, stale-question tombstones, batch history/details, worker-isolated workbook parsing, and code-driven 409/410/422/503 recovery UI.

**Why:** The current release has atomic replacement, generation locks, snapshots and production backups, but these remaining controls reduce recovery time and make rare concurrency or damaged-workbook failures reproducible before the next question-set replacement.

**Context:** Deferred from the 2026-08-24 M1 chapter-learning plan after the production M1 data replacement. Before the next managed M1 workbook publish, validate the scoped recovery artifact in MySQL 8, add concurrent publish/study/exam cases, cover Web/admin flows with browser automation, move XLSX parsing off the request event loop, and complete the remaining batch/history and stable-error UX.

**Effort:** XL
**Priority:** P1
**Depends on:** Current M1 chapter release deployed and production usage observed

### Chapter mastery statistics

**What:** Show per-chapter answered count, accuracy, and mastery after chapter learning is stable.

**Why:** Help learners identify weak chapters instead of seeing only the most recent study position.

**Context:** The M1 chapter release intentionally stores only the latest position. Define repeated-answer, retry, and accuracy semantics from real usage before adding aggregate queries and UI.

**Effort:** M
**Priority:** P3
**Depends on:** M1 chapter learning production release and stable question-practice data

### One-click question-set rollback

**What:** Keep multiple published question-set versions and allow an operator to switch back to the previous version.

**Why:** Reduce recovery time when future high-frequency content releases contain a serious error.

**Context:** The first M1 release uses an atomic replacement transaction plus a validated scoped recovery package. Build online version activation only after update frequency or recovery incidents prove the additional query and cache complexity is justified.

**Effort:** L
**Priority:** P3
**Depends on:** Repeated managed question-set releases and measured rollback need

### Chapter-specific exams

**What:** Allow learners to generate an exam from one selected M1 chapter.

**Why:** Connect chapter learning to immediate assessment without changing the whole-subject exam flow.

**Context:** Reuse the chapter fields introduced by the M1 learning release. Design paper rules, snapshots, scoring, historical compatibility, and chapter selection as a separate feature with its own regression testing.

**Effort:** L
**Priority:** P2
**Depends on:** M1 chapter data and chapter learning APIs stable in production

### Semantic design-token migration

**What:** Migrate the existing Web `sky`/`steel` palette and uni-app page-local colors to the semantic green tokens defined in `DESIGN.md`.

**Why:** New M1 chapter controls can follow the design system, but the surrounding legacy study/admin surfaces still use older blue tokens; a deliberate migration avoids a permanent mixed visual language.

**Context:** Do not turn the M1 content replacement into a whole-site retheme. During the M1 release, use semantic design tokens for newly added or directly touched controls and preserve unrelated screens. Migrate shared Tailwind tokens, uni-app variables, contrast states, and screenshots as a separate visual change with regression QA.

**Effort:** M
**Priority:** P3
**Depends on:** M1 chapter learning release and an approved whole-site visual regression window

## Completed
