# Capt Sitara

Backend and worker for the private daily-practice platform. Spec: `docs/PRD_v2.md`.

## What is built and tested
| Piece | File | Status |
|---|---|---|
| Schema, RLS, all business logic (RPC) | `supabase/migrations/001_schema.sql` | Tested on Postgres 16 with `supabase/test_behavior.sql` |
| Private image bucket | `supabase/migrations/002_storage.sql` | Not run (needs Supabase `storage` schema) |
| Email outbox worker, auto-reminders, expiry cleanup | `app/api/cron/route.ts` | Written, not run |
| Free scheduler (every 10 min) | `.github/workflows/cron.yml` | Written, not run |
| CSV template | `seed/questions_template.csv` | 4 sample rows, all `draft` |
| Automatic question bank | `005_ai.sql`, `lib/ai.ts`, `lib/gen.ts`, `lib/nonverbal.ts`, `app/api/generate/route.ts`, `.github/workflows/generate.yml` | DB tested on Postgres 16 (`supabase/test_ai.sql`); route tested end to end against a real database with simulated AI and storage; live AI calls not tried |

The test covers: resume same attempt, no answer leak in progress, scoring, unanswered counts as mistake, lock after submit, timeout closing, streak, today status, admin reset, reminders, similar question, publish gate.

The Next.js screens are built. The question bank fills itself (see `QUICKSTART.md`). Offline check: `npm run selftest`.

## Setup (all free tiers)
1. Create a Supabase project. Auth settings: **disable signups**. Invite two users (candidate, admin).
2. SQL editor: run `001_schema.sql`, then `002_storage.sql`.
3. Insert the two profiles, using the auth user ids:
   ```sql
   insert into profiles(id, name, email, role) values
     ('<candidate-uuid>', 'Sitara', 'her@email', 'candidate'),
     ('<admin-uuid>', 'Owner', 'you@email', 'admin');
   update app_settings set program_start = '2026-10-01';  -- her day 1
   ```
4. Edit `test_configs` to the real counts and timings for her intake (placeholders are 20 questions / 15 min).
5. Import questions (CSV template), review them, set `status = 'published'`.
6. Deploy the Next.js app to Vercel. Environment variables:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.
7. GitHub repo secrets: `CRON_SECRET`, `APP_URL`. The workflow then ticks every 10 minutes.
8. `npm i @supabase/supabase-js nodemailer`.

## RPC reference (what the UI calls)
| Function | Who | Returns |
|---|---|---|
| `start_attempt(category)` | candidate | attempt id (new, or today's existing one; check its status) |
| `get_attempt(id)` | candidate/admin | attempt + questions; answers and explanations only after finish |
| `save_answer(id, position, option, time_ms)` | candidate | `{ok, server_now, deadline_at}`, `ok:false` after finish or deadline |
| `submit_attempt(id)` | candidate | final `get_attempt` result |
| `today_status()` | both | 4 slots with status, score, attempt id, done count |
| `current_streak()` | both | integer |
| `get_mistakes()` | both | list with question, her answer, correct answer, both explanations |
| `set_mistake_status(question_id, status)` | candidate | |
| `similar_question(question_id)` / `check_similar(question_id, option)` | candidate | question without answer / result with explanations |
| `admin_reset_attempt(id, reason)` | admin | |
| `admin_send_reminder()` | admin | |

UI notes:
- Options come back in shuffled order. Each option has a `key` (the original letter). Show labels A-D by position, but send `key` to `save_answer`.
- Run a countdown from `deadline_at - server_now` (not from the device clock), and call `submit_attempt` when it hits zero.
- Debounce nothing on saves: call `save_answer` on every tap. It is one small update.

## Run the database test yourself
```
psql -d yourdb -f supabase/stub_auth.sql   # only outside Supabase (stubs auth.uid())
psql -d yourdb -f supabase/migrations/001_schema.sql -f supabase/test_behavior.sql
```

## Known limits
- Resetting an attempt keeps mistakes it already created, so `wrong_count` may run one high after a retake.
- A category with too few published questions makes `start_attempt` fail with a clear message. Watch question counts.
- Free Supabase projects pause after a week of inactivity. Daily use prevents this. Export regularly anyway.
