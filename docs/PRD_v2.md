# Capt Sitara: PRD v2 (fixed)

Private two-user daily practice platform for Pakistan Army initial-test preparation.
Goal: **make her practice every day for six months.** Everything else serves that.

This version keeps v1's intent and fixes the gaps found in review. Changes are marked **[NEW]** or **[FIXED]**.

## 1. Users
- **Candidate** (exactly one) and **Admin** (exactly one). Enforced in the database by unique partial indexes on `role`. Public signup disabled; both accounts are invited.
- Candidate: take today's four tests, review results, mistakes, history, streak.
- Admin: see today's status and full history, manage questions/configs, send reminders, reset an attempt.
- **[NEW] Transparency:** the candidate sees a plain note on the dashboard: "Your admin can see your scores, timing, answers and mistakes."

## 2. Daily slots
Verbal, Non-Verbal, Education & Academic, General Knowledge. Plus a locked **ISSB Preparation** tab showing exactly:
`Sabr kru Gudiya waqt aaany pr y bhi hu jay ga`

## 3. Daily rules
- One attempt per slot per **Pakistan-time (Asia/Karachi) date**. Enforced by a unique index on `(user, category, date_local)`.
- **[FIXED] Midnight rule:** an attempt belongs to the PK date on which it **started**. Its timer keeps running past midnight.
- **[FIXED] Server-side timer:** at start the server stores `deadline_at = started_at + duration`. The browser clock is display only.
  - Answers are autosaved individually; any save after `deadline_at + grace` (default 5 s, configurable) is rejected.
  - Submit before the deadline = `submitted`. Submit after it, or abandoned = `timed_out`, scored from saved answers only.
  - A cron job closes abandoned attempts, so a closed browser tab still produces a result and emails.
- **[FIXED] Resume:** reloading or reopening the app returns the same in-progress attempt. It never generates a new one.
- Unanswered questions count as wrong and create mistakes.
- **[NEW] Admin reset:** if a real problem happens (power cut, device failure), the admin can reset an attempt with a **required reason**. The reset attempt is kept (status `reset`), audited, and frees the slot. Mistakes already recorded are kept.

## 4. Streak
- **[NEW]** A day counts toward the streak when **all four** tests are done (setting `streak_rule`: `all_four` or `any_one`).
- Today being incomplete does not break the streak until the day ends.
- No rest-day exceptions in v1.

## 5. Difficulty plan (real-exam calibrated from day 1)
Same intent as v1: no childish content, ever. "Easy" means fewer traps, not simpler subject matter.

**[NEW] Selection algorithm** (was undefined). Each `test_configs` row has a month range and a `difficulty_mix`. Program month = `floor(days since program_start / 30) + 1`, capped at 6.

| Month | Mix (difficulty level: share) |
|---|---|
| 1 | L1 60%, L2 40% |
| 2 | L2 60%, L3 40% |
| 3-4 | L3 60%, L4 40% |
| 5 | L4 60%, L5 40% |
| 6 | L3 20%, L4 40%, L5 40% |

- Questions never seen before come first; after that the least-recently-seen are reused (controlled revision).
- If a level runs short, the test tops up from the nearest available questions. If the whole category is too small, the start fails with a clear admin-facing error (see Content pipeline).
- These mixes are placeholders. The admin edits them in `test_configs` with no code change.

## 6. Question bank
- **[NEW] Frozen attempts:** when a test starts, each question is copied into `attempt_questions` (text, image paths, options, explanations, correct answer, question version) with a shuffled option order. Later edits never change history.
- `questions.version` increments when content changes.
- Publish gate: a question can only be `published` if it has both explanations and they are not identical.
- **[NEW]** `shuffle_options = false` for "All of the above" style questions.
- Fields: category, topic, subtopic, difficulty 1-5, stem, optional stem image, options A-D (text and/or image), correct option, exam explanation, plain explanation, `similar_group`, source title/url/date, `active_until` (current affairs), status (draft, reviewed, published, retired).
- Import via CSV (template in `seed/`). Imports land as `draft`; nothing is published without admin review.

## 7. Mistake learning
- Every wrong or unanswered question upserts one row per `(user, question)` with `wrong_count`. Full history stays in `attempt_questions`. **[FIXED]** (v1 had no uniqueness rule.)
- Review shows: question, her answer, correct answer, **exam explanation** (fastest method + common trap), **plain-language explanation** (core idea, tiny example).
- **[FIXED] Naming:** "child-simple" renamed **plain-language explanation**. Content must be clear and short, never childish.
- **[NEW] Try a similar question:** the server picks another published question with the same `similar_group` (or the same topic/subtopic) and checks her answer without touching test history.
- Status per mistake: new, reviewed, mastered.

## 8. Email and reminders
- **[FIXED] Outbox pattern:** finishing a test writes email rows to `email_outbox` in the same database transaction as the score. A worker sends them with retry (5 tries, growing delay). A mail outage can never lose or delay a result.
- Result email (both users): candidate, date, category, score, percentage, time used, mistakes by topic, timed-out flag.
- Admin **Send Reminder** (limit one per hour). Auto-reminder after a configurable local hour if slots remain (limit one per 3 hours).
- Admin can see outbox status and last error.
- Optional later: single daily digest instead of four emails.

## 9. Security
- HTTPS, hashed passwords (Supabase Auth), session expiry.
- **[FIXED]** The candidate has no direct read access to `questions` or `attempt_questions`. All reads go through RPC functions that hide the correct answer and explanations until the attempt is finished.
- Row-level security on every table; admin actions check role server-side.
- **[NEW] Audit log:** edits to questions and test configs, and attempt resets, are logged with actor and old/new values.
- Private storage bucket for images with random file names.
- Suspicious behavior (repeated start attempts, rejected late saves) is recorded in the application log.

## 10. Non-functional targets (**[NEW]** measurable)
- Dashboard interactive in under 3 s on a 3G-class connection.
- Answer autosave acknowledged in under 500 ms on normal broadband.
- Zero lost results: every started attempt ends in `submitted`, `timed_out` or `reset`.
- Mobile-first layout; images legible at 360 px width.
- Weekly automatic export of results and mistakes (admin download at any time).

## 11. Content pipeline (**[NEW]**, this is the real project)
Estimated need: 4 slots x ~180 days x 20 questions is about 14,000 question-slots. Even with reuse you need thousands of reviewed questions.
- Plan for **~2 months of content at launch** (about 2,500 questions), then add monthly.
- Draft with AI or own writing, then **human review before publish**. Decide who reviews and how many per week.
- Do not copy copyrighted MCQ books or sites. Use original items or licensed content.
- Current-affairs items always carry source URL and date plus `active_until`.
- Official recruitment instructions override every count and timing here.

## 12. Build phases (**[FIXED]** order)
1. **Core:** auth, question schema, CSV import, timed test, server lock, scoring, **mistake storage**, candidate and admin today screens.
2. **Learning:** mistake review with both explanations, similar question, difficulty mix, dashboards.
3. **Communication:** outbox worker, reminders.
4. **Content tools:** image questions, review workflow, source fields, export.
5. **Hardening:** backups, audit review, PWA, acceptance testing.

## 13. Open decisions (defaults used until answered)
| Decision | Default |
|---|---|
| Real question counts and timings for her intake | 20 questions, 15 min per slot (placeholder) |
| Streak rule | all four tests |
| Midnight rule | start date |
| Late-save grace | 5 seconds |
| Email volume | four result emails per day, digest later |

## 14. Acceptance criteria (updated)
All v1 criteria, plus:
- A closed tab or lost connection still yields a scored result after the deadline.
- Reloading a test never changes its questions or option order.
- Editing a question never changes past attempts.
- Candidate cannot retrieve correct answers or explanations for an in-progress test by any API call.
- Admin reset requires a reason and appears in the audit log.
- Email failure leaves the result intact and visibly queued for retry.
