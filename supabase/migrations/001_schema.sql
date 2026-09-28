-- Capt Sitara: core schema (Supabase / Postgres 15+)
-- All candidate writes go through RPC functions (security definer). No direct table writes.

create extension if not exists pgcrypto;

create type category_t as enum ('verbal','nonverbal','education','gk');
create type role_t as enum ('candidate','admin');
create type attempt_status_t as enum ('in_progress','submitted','timed_out','reset');
create type question_status_t as enum ('draft','reviewed','published','retired');

-- ---------- users: exactly one candidate and one admin ----------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  email text not null,
  role role_t not null,
  timezone text not null default 'Asia/Karachi',
  active boolean not null default true
);
create unique index one_candidate on profiles(role) where role = 'candidate';
create unique index one_admin on profiles(role) where role = 'admin';

create table app_settings (
  id boolean primary key default true check (id),
  program_start date not null default ((now() at time zone 'Asia/Karachi')::date),
  grace_seconds int not null default 5,
  streak_rule text not null default 'all_four' check (streak_rule in ('all_four','any_one')),
  reminder_hour_local int not null default 20 check (reminder_hour_local between 0 and 23)
);
insert into app_settings default values;

create function pk_today() returns date language sql stable as
$$ select (now() at time zone 'Asia/Karachi')::date $$;

create function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active) $$;

create function is_candidate() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'candidate' and active) $$;

-- ---------- test configuration (no code change needed to tune) ----------
create table test_configs (
  id bigint generated always as identity primary key,
  category category_t not null,
  month_from int not null default 1 check (month_from between 1 and 6),
  month_to int not null default 6 check (month_to between 1 and 6),
  question_count int not null check (question_count > 0),
  duration_seconds int not null check (duration_seconds > 0),
  difficulty_mix jsonb not null,            -- e.g. {"1":0.6,"2":0.4}
  active boolean not null default true,
  check (month_from <= month_to)
);

-- ---------- question bank ----------
create table questions (
  id bigint generated always as identity primary key,
  category category_t not null,
  topic text not null,
  subtopic text,
  difficulty int not null check (difficulty between 1 and 5),
  stem text not null,
  stem_image text,                          -- storage path
  options jsonb not null check (options ?& array['A','B','C','D']),
  option_images jsonb,                      -- {"A":"path",...}
  shuffle_options boolean not null default true,  -- false for "All of the above" style
  correct_option char(1) not null check (correct_option in ('A','B','C','D')),
  exam_explanation text,                    -- fastest method + common trap
  plain_explanation text,                   -- plain-language idea + tiny example
  similar_group text,                       -- links questions for "Try a similar question"
  source_title text,
  source_url text,
  source_date date,
  active_until date,                        -- current affairs expiry
  status question_status_t not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or (
    exam_explanation is not null and plain_explanation is not null
    and exam_explanation <> plain_explanation))
);
create index questions_pick on questions(category, difficulty) where status = 'published';
create index questions_similar on questions(category, similar_group);

create function questions_bump() returns trigger language plpgsql as $$
begin
  if (new.stem, new.options, new.correct_option, new.exam_explanation, new.plain_explanation, new.stem_image, new.option_images)
     is distinct from
     (old.stem, old.options, old.correct_option, old.exam_explanation, old.plain_explanation, old.stem_image, old.option_images)
  then new.version := old.version + 1; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger questions_bump_t before update on questions for each row execute function questions_bump();

-- ---------- attempts (one per user/category/PK day, unless admin-reset) ----------
create table attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  category category_t not null,
  date_local date not null,                 -- PK date of START time
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,         -- server-side truth for the timer
  submitted_at timestamptz,
  status attempt_status_t not null default 'in_progress',
  score int,
  total int not null,
  duration_seconds int not null,
  config_id bigint references test_configs,
  reset_reason text
);
create unique index one_attempt_per_day on attempts(user_id, category, date_local) where status <> 'reset';

-- Frozen copy of each question as shown (survives later edits) + shuffled option order
create table attempt_questions (
  attempt_id uuid not null references attempts on delete cascade,
  position int not null,
  question_id bigint not null references questions,
  question_version int not null,
  snapshot jsonb not null,
  option_order text[] not null,             -- original keys in display order
  selected_option char(1),
  is_correct boolean,
  time_spent_ms int,
  answered_at timestamptz,
  primary key (attempt_id, position)
);
create index aq_question on attempt_questions(question_id);

-- One row per (user, question); history lives in attempt_questions
create table mistakes (
  user_id uuid not null references profiles,
  question_id bigint not null references questions,
  first_wrong_at timestamptz not null default now(),
  last_wrong_at timestamptz not null default now(),
  wrong_count int not null default 1,
  last_attempt_id uuid references attempts,
  review_status text not null default 'new' check (review_status in ('new','reviewed','mastered')),
  primary key (user_id, question_id)
);

-- ---------- email / reminders / audit ----------
create table email_outbox (
  id bigint generated always as identity primary key,
  attempt_id uuid references attempts,
  recipient_id uuid not null references profiles,
  template text not null check (template in ('result','reminder')),
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  tries int not null default 0,
  next_try_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbox_due on email_outbox(status, next_try_at);

create table reminders (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references profiles,
  type text not null check (type in ('manual','auto')),
  sent_by uuid references profiles,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  target text,
  details jsonb,
  created_at timestamptz not null default now()
);

create function audit_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(actor, action, target, details)
  values (auth.uid(), tg_op || ' ' || tg_table_name,
          coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, ''),
          jsonb_build_object('old', case when tg_op <> 'INSERT' then to_jsonb(old) end,
                             'new', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  return coalesce(new, old);
end $$;
create trigger audit_questions after insert or update or delete on questions for each row execute function audit_change();
create trigger audit_configs after insert or update or delete on test_configs for each row execute function audit_change();

-- ---------- core logic ----------

-- Score an attempt, store mistakes, queue result emails. Idempotent.
create function finalize_attempt(p_attempt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a attempts; v_score int; v_status attempt_status_t; v_payload jsonb; cand profiles;
begin
  select * into a from attempts where id = p_attempt for update;
  if not found or a.status <> 'in_progress' then return; end if;

  update attempt_questions
     set is_correct = (selected_option is not null and selected_option = snapshot->>'correct_option')
   where attempt_id = p_attempt;
  select count(*) filter (where is_correct) into v_score from attempt_questions where attempt_id = p_attempt;

  v_status := case when now() > a.deadline_at then 'timed_out' else 'submitted' end;
  update attempts set status = v_status, score = v_score,
         submitted_at = case when now() > a.deadline_at then a.deadline_at else now() end
   where id = p_attempt;

  -- wrong or unanswered = mistake
  insert into mistakes(user_id, question_id, last_attempt_id)
  select a.user_id, question_id, p_attempt from attempt_questions
   where attempt_id = p_attempt and not is_correct
  on conflict (user_id, question_id) do update
     set wrong_count = mistakes.wrong_count + 1, last_wrong_at = now(),
         last_attempt_id = excluded.last_attempt_id, review_status = 'new';

  select * into cand from profiles where id = a.user_id;
  select jsonb_build_object(
    'candidate_name', cand.name, 'category', a.category, 'date_local', a.date_local,
    'score', v_score, 'total', a.total,
    'percentage', round(100.0 * v_score / a.total, 1),
    'elapsed_seconds', extract(epoch from (least(now(), a.deadline_at) - a.started_at))::int,
    'timed_out', v_status = 'timed_out',
    'mistakes', coalesce((select jsonb_agg(jsonb_build_object('topic', t, 'count', c) order by c desc)
                            from (select snapshot->>'topic' t, count(*) c from attempt_questions
                                   where attempt_id = p_attempt and not is_correct group by 1) x), '[]'))
    into v_payload;

  insert into email_outbox(attempt_id, recipient_id, template, payload)
  select p_attempt, id, 'result', v_payload from profiles where active;
end $$;

-- Pick n question ids for one difficulty, never-seen first, then least-recently-seen
create function pick_questions(p_user uuid, p_cat category_t, p_diff int, p_n int, p_exclude bigint[])
returns setof bigint language sql stable security definer set search_path = public as $$
  select q.id from questions q
   where q.category = p_cat and q.difficulty = p_diff and q.status = 'published'
     and (q.active_until is null or q.active_until >= pk_today())
     and q.id <> all (p_exclude)
   order by (select max(a.started_at) from attempt_questions aq join attempts a on a.id = aq.attempt_id
              where aq.question_id = q.id and a.user_id = p_user) nulls first, random()
   limit p_n
$$;

-- Start (or resume) today's attempt for a category. Returns the attempt id; client checks status.
create function start_attempt(p_category category_t) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); today date := pk_today();
  ex attempts; cfg test_configs; ps date; gs int; m int;
  att uuid; picked bigint[] := '{}'; got bigint[]; remaining int; n int; r record;
begin
  if not is_candidate() then raise exception 'not allowed'; end if;

  select * into ex from attempts
   where user_id = uid and category = p_category and date_local = today and status <> 'reset';
  if found then
    if ex.status = 'in_progress' then
      select grace_seconds into gs from app_settings;
      if now() > ex.deadline_at + make_interval(secs => gs) then perform finalize_attempt(ex.id); end if;
    end if;
    return ex.id;
  end if;

  select program_start into ps from app_settings;
  m := least(6, greatest(1, ((today - ps) / 30) + 1));

  select * into cfg from test_configs
   where category = p_category and active and m between month_from and month_to
   order by id desc limit 1;
  if not found then raise exception 'no active test config for % in month %', p_category, m; end if;

  remaining := cfg.question_count;
  for r in select key::int as d, value::numeric as share,
                  row_number() over (order by key) as rn, count(*) over () as cnt
             from jsonb_each_text(cfg.difficulty_mix) loop
    n := case when r.rn = r.cnt then remaining else least(remaining, round(cfg.question_count * r.share)::int) end;
    select coalesce(array_agg(x), '{}') into got from pick_questions(uid, p_category, r.d, n, picked) x;
    picked := picked || got;
    remaining := cfg.question_count - coalesce(array_length(picked, 1), 0);
  end loop;

  -- top up from any difficulty if a level ran short
  if remaining > 0 then
    select coalesce(array_agg(id), '{}') into got from (
      select q.id from questions q
       where q.category = p_category and q.status = 'published'
         and (q.active_until is null or q.active_until >= today) and q.id <> all (picked)
       order by (select max(a.started_at) from attempt_questions aq join attempts a on a.id = aq.attempt_id
                  where aq.question_id = q.id and a.user_id = uid) nulls first,
                abs(q.difficulty - 3), random()
       limit remaining) s;
    picked := picked || got;
  end if;

  if coalesce(array_length(picked, 1), 0) < cfg.question_count then
    raise exception 'question bank too small for % (need %, have %)', p_category, cfg.question_count,
                    coalesce(array_length(picked, 1), 0);
  end if;

  insert into attempts(user_id, category, date_local, deadline_at, total, duration_seconds, config_id)
  values (uid, p_category, today, now() + make_interval(secs => cfg.duration_seconds),
          cfg.question_count, cfg.duration_seconds, cfg.id)
  returning id into att;

  insert into attempt_questions(attempt_id, position, question_id, question_version, snapshot, option_order)
  select att, row_number() over (order by random()), q.id, q.version,
         jsonb_build_object('stem', q.stem, 'stem_image', q.stem_image, 'options', q.options,
                            'option_images', q.option_images, 'correct_option', q.correct_option,
                            'exam_explanation', q.exam_explanation, 'plain_explanation', q.plain_explanation,
                            'topic', q.topic, 'subtopic', q.subtopic, 'difficulty', q.difficulty,
                            'similar_group', q.similar_group),
         case when q.shuffle_options
              then (select array_agg(l order by random(), q.id) from unnest(array['A','B','C','D']) l)
              else array['A','B','C','D'] end
    from questions q where q.id = any (picked);

  return att;
end $$;

-- Attempt view for the client. Hides answers/explanations until the attempt is finished.
create function get_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a attempts; gs int; done boolean;
begin
  select * into a from attempts where id = p_attempt and (user_id = auth.uid() or is_admin());
  if not found then raise exception 'not found'; end if;
  if a.status = 'in_progress' then
    select grace_seconds into gs from app_settings;
    if now() > a.deadline_at + make_interval(secs => gs) then
      perform finalize_attempt(a.id);
      select * into a from attempts where id = p_attempt;
    end if;
  end if;
  done := a.status <> 'in_progress';

  return jsonb_build_object(
    'id', a.id, 'category', a.category, 'status', a.status, 'date_local', a.date_local,
    'started_at', a.started_at, 'deadline_at', a.deadline_at, 'submitted_at', a.submitted_at,
    'server_now', now(), 'score', a.score, 'total', a.total,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'position', aq.position, 'stem', aq.snapshot->>'stem', 'stem_image', aq.snapshot->>'stem_image',
          'options', (select jsonb_agg(jsonb_build_object('key', k, 'text', aq.snapshot->'options'->>k,
                                                           'image', aq.snapshot->'option_images'->>k) order by ord)
                        from unnest(aq.option_order) with ordinality as t(k, ord)),
          'selected', aq.selected_option)
        || case when done then jsonb_build_object(
             'correct_option', aq.snapshot->>'correct_option', 'is_correct', aq.is_correct,
             'topic', aq.snapshot->>'topic', 'time_spent_ms', aq.time_spent_ms,
             'exam_explanation', aq.snapshot->>'exam_explanation',
             'plain_explanation', aq.snapshot->>'plain_explanation') else '{}'::jsonb end
        order by aq.position)
      from attempt_questions aq where aq.attempt_id = a.id), '[]'::jsonb));
end $$;

-- Autosave one answer. Rejected after deadline + grace (server clock decides).
create function save_answer(p_attempt uuid, p_position int, p_option char, p_time_ms int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a attempts; gs int;
begin
  select * into a from attempts where id = p_attempt and user_id = auth.uid();
  if not found then raise exception 'not found'; end if;
  if p_option is not null and p_option not in ('A','B','C','D') then raise exception 'bad option'; end if;
  if a.status <> 'in_progress' then return jsonb_build_object('ok', false, 'status', a.status); end if;
  select grace_seconds into gs from app_settings;
  if now() > a.deadline_at + make_interval(secs => gs) then
    perform finalize_attempt(a.id);
    return jsonb_build_object('ok', false, 'status', 'timed_out');
  end if;
  update attempt_questions
     set selected_option = p_option, time_spent_ms = coalesce(p_time_ms, time_spent_ms), answered_at = now()
   where attempt_id = p_attempt and position = p_position;
  return jsonb_build_object('ok', true, 'server_now', now(), 'deadline_at', a.deadline_at);
end $$;

create function submit_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from attempts where id = p_attempt and user_id = auth.uid();
  if not found then raise exception 'not found'; end if;
  perform finalize_attempt(p_attempt);
  return get_attempt(p_attempt);
end $$;

-- Cron (service role): close abandoned attempts
create function close_expired_attempts() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; gs int;
begin
  select grace_seconds into gs from app_settings;
  for r in select id from attempts where status = 'in_progress'
                and now() > deadline_at + make_interval(secs => gs) loop
    perform finalize_attempt(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- status, streak, mistakes ----------
create function today_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if is_admin() then select id into target from profiles where role = 'candidate';
  else target := auth.uid(); end if;
  return (select jsonb_build_object(
      'date', pk_today(), 'user_id', target,
      'done_count', count(*) filter (where x.status in ('submitted','timed_out')),
      'slots', jsonb_object_agg(c::text, jsonb_build_object(
          'status', coalesce(x.status::text, 'not_started'), 'attempt_id', x.id,
          'score', x.score, 'total', x.total)),
      'last_activity', (select max(coalesce(submitted_at, started_at)) from attempts where user_id = target))
    from unnest(enum_range(null::category_t)) c
    left join attempts x on x.user_id = target and x.category = c
                        and x.date_local = pk_today() and x.status <> 'reset');
end $$;

create function current_streak(p_user uuid default null) returns int
language plpgsql stable security definer set search_path = public as $$
declare u uuid; need int; res int;
begin
  if is_admin() then u := coalesce(p_user, (select id from profiles where role = 'candidate'));
  else u := auth.uid(); end if;
  select case streak_rule when 'all_four' then 4 else 1 end into need from app_settings;
  with q as (
    select date_local d from attempts
     where user_id = u and status in ('submitted','timed_out')
     group by date_local having count(distinct category) >= need),
  g as (select d, d - (row_number() over (order by d))::int as grp from q),
  i as (select count(*) len, max(d) last_d from g group by grp)
  select coalesce((select len from i where last_d >= pk_today() - 1 order by last_d desc limit 1), 0) into res;
  return res;
end $$;

create function get_mistakes(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid;
begin
  if is_admin() then u := coalesce(p_user, (select id from profiles where role = 'candidate'));
  else u := auth.uid(); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'question_id', m.question_id, 'wrong_count', m.wrong_count, 'review_status', m.review_status,
      'last_wrong_at', m.last_wrong_at, 'category', a.category, 'topic', aq.snapshot->>'topic',
      'stem', aq.snapshot->>'stem', 'stem_image', aq.snapshot->>'stem_image',
      'options', aq.snapshot->'options', 'option_images', aq.snapshot->'option_images',
      'selected', aq.selected_option, 'correct_option', aq.snapshot->>'correct_option',
      'exam_explanation', aq.snapshot->>'exam_explanation',
      'plain_explanation', aq.snapshot->>'plain_explanation') order by m.last_wrong_at desc)
    from mistakes m
    join attempt_questions aq on aq.attempt_id = m.last_attempt_id and aq.question_id = m.question_id
    join attempts a on a.id = m.last_attempt_id
    where m.user_id = u), '[]'::jsonb);
end $$;

create function set_mistake_status(p_question bigint, p_status text) returns void
language sql security definer set search_path = public as
$$ update mistakes set review_status = p_status where user_id = auth.uid() and question_id = p_question $$;

-- "Try a similar question": same similar_group, else same topic+subtopic. Answer not exposed here.
create function similar_question(p_question bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare src questions; q questions;
begin
  perform 1 from mistakes where user_id = auth.uid() and question_id = p_question;
  if not found then raise exception 'not allowed'; end if;
  select * into src from questions where id = p_question;
  select * into q from questions
   where category = src.category and status = 'published' and id <> src.id
     and (active_until is null or active_until >= pk_today())
     and ((src.similar_group is not null and similar_group = src.similar_group)
          or (src.similar_group is null and topic = src.topic and subtopic is not distinct from src.subtopic))
   order by random() limit 1;
  if not found then return null; end if;
  return jsonb_build_object('question_id', q.id, 'stem', q.stem, 'stem_image', q.stem_image,
                            'options', q.options, 'option_images', q.option_images);
end $$;

create function check_similar(p_question bigint, p_option char) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q questions;
begin
  if not is_candidate() then raise exception 'not allowed'; end if;
  select * into q from questions where id = p_question and status = 'published';
  if not found then raise exception 'not found'; end if;
  return jsonb_build_object('correct', p_option = q.correct_option, 'correct_option', q.correct_option,
                            'exam_explanation', q.exam_explanation, 'plain_explanation', q.plain_explanation);
end $$;

-- ---------- admin actions ----------
create function admin_reset_attempt(p_attempt uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  update attempts set status = 'reset', reset_reason = p_reason where id = p_attempt;
  insert into audit_log(actor, action, target, details)
  values (auth.uid(), 'reset_attempt', p_attempt::text, jsonb_build_object('reason', p_reason));
end $$;

create function admin_send_reminder() returns void
language plpgsql security definer set search_path = public as $$
declare cand profiles;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  select * into cand from profiles where role = 'candidate';
  if exists (select 1 from reminders where type = 'manual' and created_at > now() - interval '1 hour') then
    raise exception 'reminder already sent in the last hour';
  end if;
  insert into reminders(recipient_id, type, sent_by) values (cand.id, 'manual', auth.uid());
  insert into email_outbox(recipient_id, template, payload)
  values (cand.id, 'reminder', jsonb_build_object('candidate_name', cand.name, 'remaining', (
    select coalesce(jsonb_agg(c::text), '[]') from unnest(enum_range(null::category_t)) c
     where not exists (select 1 from attempts a where a.user_id = cand.id and a.category = c
                        and a.date_local = pk_today() and a.status in ('submitted','timed_out')))));
end $$;

-- Cron (service role): evening nudge if today is incomplete
create function enqueue_auto_reminder() returns boolean
language plpgsql security definer set search_path = public as $$
declare cand profiles; hr int; rem jsonb;
begin
  select * into cand from profiles where role = 'candidate' and active;
  select reminder_hour_local into hr from app_settings;
  if not found or extract(hour from (now() at time zone 'Asia/Karachi')) < hr then return false; end if;
  if exists (select 1 from reminders where recipient_id = cand.id and created_at > now() - interval '3 hours') then return false; end if;
  select coalesce(jsonb_agg(c::text), '[]') into rem from unnest(enum_range(null::category_t)) c
   where not exists (select 1 from attempts a where a.user_id = cand.id and a.category = c
                      and a.date_local = pk_today() and a.status in ('submitted','timed_out'));
  if jsonb_array_length(rem) = 0 then return false; end if;
  insert into reminders(recipient_id, type) values (cand.id, 'auto');
  insert into email_outbox(recipient_id, template, payload)
  values (cand.id, 'reminder', jsonb_build_object('candidate_name', cand.name, 'remaining', rem));
  return true;
end $$;

-- ---------- derived view (no stored daily_status table) ----------
create view daily_status with (security_invoker = true) as
select user_id, date_local,
  bool_or(category = 'verbal' and status in ('submitted','timed_out')) as verbal_done,
  bool_or(category = 'nonverbal' and status in ('submitted','timed_out')) as nonverbal_done,
  bool_or(category = 'education' and status in ('submitted','timed_out')) as education_done,
  bool_or(category = 'gk' and status in ('submitted','timed_out')) as gk_done
from attempts where status <> 'reset' group by user_id, date_local;

-- ---------- RLS ----------
alter table profiles enable row level security;
alter table app_settings enable row level security;
alter table test_configs enable row level security;
alter table questions enable row level security;
alter table attempts enable row level security;
alter table attempt_questions enable row level security;
alter table mistakes enable row level security;
alter table email_outbox enable row level security;
alter table reminders enable row level security;
alter table audit_log enable row level security;

create policy profiles_read on profiles for select using (id = auth.uid() or is_admin());
create policy settings_read on app_settings for select using (auth.uid() is not null);
create policy settings_admin on app_settings for update using (is_admin());
create policy configs_read on test_configs for select using (auth.uid() is not null);
create policy configs_admin on test_configs for all using (is_admin()) with check (is_admin());
create policy questions_admin on questions for all using (is_admin()) with check (is_admin());  -- candidate never reads this table
create policy attempts_read on attempts for select using (user_id = auth.uid() or is_admin());
create policy aq_admin on attempt_questions for select using (is_admin());  -- candidate reads via get_attempt()
create policy mistakes_read on mistakes for select using (user_id = auth.uid() or is_admin());
create policy outbox_admin on email_outbox for select using (is_admin());
create policy reminders_admin on reminders for select using (is_admin());
create policy audit_admin on audit_log for select using (is_admin());

-- ---------- function privileges ----------
revoke all on function finalize_attempt(uuid), pick_questions(uuid, category_t, int, int, bigint[]),
  close_expired_attempts(), enqueue_auto_reminder() from public, anon, authenticated;
revoke all on function start_attempt(category_t), get_attempt(uuid), save_answer(uuid, int, char, int),
  submit_attempt(uuid), today_status(), current_streak(uuid), get_mistakes(uuid), set_mistake_status(bigint, text),
  similar_question(bigint), check_similar(bigint, char), admin_reset_attempt(uuid, text), admin_send_reminder()
  from public, anon;
grant execute on function start_attempt(category_t), get_attempt(uuid), save_answer(uuid, int, char, int),
  submit_attempt(uuid), today_status(), current_streak(uuid), get_mistakes(uuid), set_mistake_status(bigint, text),
  similar_question(bigint), check_similar(bigint, char), admin_reset_attempt(uuid, text), admin_send_reminder()
  to authenticated;

-- ---------- placeholder test configs (EDIT to match her real intake instructions) ----------
insert into test_configs(category, month_from, month_to, question_count, duration_seconds, difficulty_mix)
select c, b.f, b.t, 20, 15 * 60, b.mix::jsonb
  from unnest(enum_range(null::category_t)) c,
       (values (1, 1, '{"1":0.6,"2":0.4}'), (2, 2, '{"2":0.6,"3":0.4}'), (3, 4, '{"3":0.6,"4":0.4}'),
               (5, 5, '{"4":0.6,"5":0.4}'), (6, 6, '{"3":0.2,"4":0.4,"5":0.4}')) as b(f, t, mix);
