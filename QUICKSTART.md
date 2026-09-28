# Capt Sitara: Quick Start (questions are made automatically)

You do NOT need to write questions. The app fills its own question bank:
- **Verbal, Education, General Knowledge**: written by an AI, then checked by a second AI pass that solves each question without seeing the answer key. Only questions where both agree are kept.
- **Non-Verbal**: figure puzzles drawn by code. The answer is worked out from the rule, so it is always right.

Logins (change them, see the end): username `admin` / password `Sitarailu`, username `candidate` / password `Merajilu`.

You need free accounts on: Supabase, Vercel, GitHub, and Google AI Studio. Also Node.js 18.18+ (nodejs.org) if you want to test on your computer.

## 1. Database (Supabase)
1. supabase.com > New project. Save the database password. Then Authentication > Sign In / Providers > Email: turn OFF "Allow new users to sign up".
2. SQL Editor: run these in order, each as a new query (copy the whole file, paste, Run):
   `001_schema.sql`, `002_storage.sql`, `003_seed_users.sql` (first replace the two CHANGE_ME emails), `004_import.sql`, `005_ai.sql`
3. Table Editor > `test_configs`: set `question_count` and `duration_seconds` to her real test sizes. Example for all rows: `update test_configs set question_count = 30, duration_seconds = 1200;`
4. Supabase > Project Settings > API: copy the Project URL, the `anon` key and the `service_role` key (secret).

## 2. Free AI key
Go to aistudio.google.com/apikey, sign in, Create API key, copy it. No card needed. (Prefer Claude? See "Options" below.)

## 3. Put the app online (Vercel + GitHub)
1. Create a GitHub repository and upload this folder (a `.gitignore` is included so secrets are never uploaded).
2. vercel.com > Add New Project > import the repo. Add these Environment Variables:

| Name | Value |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | anon key |
| SUPABASE_URL | Project URL (same again) |
| SUPABASE_SERVICE_ROLE_KEY | service_role key (secret) |
| CRON_SECRET | any long random text you invent |
| AI_PROVIDER | gemini |
| GEMINI_API_KEY | your Google AI key |

3. Deploy. Vercel gives you an address like `https://capt-sitara.vercel.app`.

## 4. Turn on the automatic question filler (GitHub)
1. GitHub repo > Settings > Secrets and variables > Actions > New repository secret. Add `CRON_SECRET` (same text as above) and `APP_URL` (your Vercel address, no `/` at the end).
2. Actions tab > **generate** > Run workflow. It keeps calling the app until the bank is full. The first fill takes roughly 10 to 30 minutes on the free AI tier. If it stops early, run it again.
3. Log in as `admin`: the dashboard shows a **Question bank** table (published and unseen per category) and the last generator run or error.
4. After that it tops up by itself every 20 minutes. It keeps about 4 days of unseen questions ready, for this month and next month's difficulty.

If a test can't start yet she sees "Questions for this section are still being prepared". Wait a few minutes and try again.

## 5. Emails and auto-close (optional but recommended)
1. Gmail: Google Account > Security > 2-Step Verification > App passwords. Create one (16 characters).
2. Add to Vercel: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER` (Gmail address), `SMTP_PASS` (the 16 characters), `MAIL_FROM` (same Gmail address). Redeploy.
3. The `cron` workflow (every 10 minutes) then closes timed-out tests, sends reminders and result emails.

## 6. Before she starts
- **Change both passwords.** In the SQL Editor (do not use the dashboard reset button, it emails a fake address):
  `update auth.users set encrypted_password = crypt('YourLongPassword', gen_salt('bf')) where email = 'admin@captsitara.app';`
  and again with `candidate@captsitara.app`.
- Day 1 is set when you run 003. To change it: `update app_settings set program_start = '2026-10-01';`
- Log in as `candidate`, start one test in each category, and check the result and mistakes pages.

## Testing on your own computer (optional)
`npm install`, copy `.env.example` to `.env.local` and fill it, `npm run dev`, open http://localhost:3000.
To fill the bank from your computer, run this repeatedly until it says `"done":true`:
`curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/generate`
Offline self-check (no keys needed): `npm run selftest`.

## Options
- **Better accuracy with Claude (paid, a few cents a day):** in Vercel set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. You can also use one for writing and the other for checking: set `AI_VERIFY_PROVIDER` (needs both keys).
- **Different Gemini model:** set `GEMINI_MODEL` (default `gemini-2.5-flash`). If Google retires a model name, the dashboard shows the error; change this value.
- **How much to keep in stock:** `update app_settings set bank_days_ahead = 7;` (default 4).

## Honest limits (please read)
- AI questions can still contain a mistake. The second pass catches most, not all. When you spot a bad one: `update questions set status = 'retired' where id = 123;` (find the id in Table Editor > questions).
- General Knowledge uses stable facts only (history, geography, science, Pakistan studies). It does **not** cover recent news or current affairs, because the AI cannot know today's news.
- Non-verbal covers figure series (turning, sides, shading, dots, moving squares). Other non-verbal types (mirror images, paper folding, cubes) are not included.
- The free Gemini tier allows only a few requests per minute. That is why the filler works in small steps and the first fill is not instant. Google may use free-tier prompts to improve its models; these prompts contain only question-writing instructions, no personal data.
- Manual CSV import still works (`004_import.sql`, `seed/questions_template.csv`) if you ever want to add your own questions.
