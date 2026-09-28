-- Capt Sitara: automatic question bank (AI + code generated). Run AFTER 001-004.

-- ---------- columns ----------
alter table questions add column origin text not null default 'manual';   -- manual | ai | code
alter table questions add column sig text;                                 -- duplicate guard
create unique index questions_sig_uniq on questions(category, sig) where sig is not null;

alter table app_settings add column gen_lock_until timestamptz;            -- stops two generator runs overlapping
alter table app_settings add column bank_days_ahead int not null default 4 check (bank_days_ahead between 1 and 30);

-- Old CSV import now also fills sig and skips exact duplicates instead of failing.
create or replace function import_questions() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into questions(category, topic, subtopic, difficulty, stem, stem_image, options, correct_option,
                        exam_explanation, plain_explanation, similar_group, source_title, source_url, source_date, status, sig)
  select category, topic, nullif(subtopic,''), difficulty, stem, nullif(stem_image,''),
         jsonb_build_object('A', coalesce(option_a,''), 'B', coalesce(option_b,''), 'C', coalesce(option_c,''), 'D', coalesce(option_d,'')),
         upper(trim(correct_option)), nullif(exam_explanation,''), nullif(plain_explanation,''), nullif(similar_group,''),
         nullif(source_title,''), nullif(source_url,''), source_date, 'draft',
         md5(lower(trim(stem)) || coalesce(stem_image, ''))
    from questions_import
  on conflict do nothing;
  get diagnostics n = row_count;
  delete from questions_import;
  return n;
end $$;
revoke all on function import_questions() from public, anon, authenticated;

-- ---------- generator log ----------
create table gen_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  category category_t,
  difficulty int,
  origin text,
  made int not null default 0,
  rejected int not null default 0,
  error text
);
alter table gen_log enable row level security;
create policy gen_log_admin on gen_log for select using (is_admin());

-- ---------- lock ----------
create function gen_acquire(p_seconds int default 100) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update app_settings set gen_lock_until = now() + make_interval(secs => p_seconds)
   where gen_lock_until is null or gen_lock_until < now();
  get diagnostics n = row_count;
  return n > 0;
end $$;

create function gen_release() returns void language sql security definer set search_path = public as
$$ update app_settings set gen_lock_until = null $$;

-- ---------- what is missing? ----------
-- For the current month and the next one, how many UNSEEN published questions does the candidate
-- need per category and difficulty to cover bank_days_ahead days of tests? Returns only shortages.
create function bank_needs() returns table(cat category_t, diff int, want int, have int, deficit int)
language sql stable security definer set search_path = public as $$
  with s as (select program_start ps, bank_days_ahead days from app_settings),
  m as (select least(6, greatest(1, ((pk_today() - ps) / 30) + 1)) cur, days from s),
  cand as (select id from profiles where role = 'candidate' limit 1),
  cfg as (
    select c.category cat, e.key::int diff, ceil(c.question_count * e.value::numeric)::int per_day
      from test_configs c, m, jsonb_each_text(c.difficulty_mix) e
     where c.active and (m.cur between c.month_from and c.month_to
                         or least(6, m.cur + 1) between c.month_from and c.month_to)
  ),
  w as (select cat, diff, max(per_day) * (select days from m) as want from cfg group by cat, diff),
  h as (
    select w.cat, w.diff, w.want,
           (select count(*)::int from questions q
             where q.category = w.cat and q.difficulty = w.diff and q.status = 'published'
               and (q.active_until is null or q.active_until >= pk_today())
               and not exists (select 1 from attempt_questions aq join attempts a on a.id = aq.attempt_id
                                where aq.question_id = q.id and a.user_id = (select id from cand)
                                  and a.status <> 'reset')) as have
      from w)
  select cat, diff, want, have, want - have from h where want - have > 0 order by want - have desc, cat, diff
$$;

-- ---------- store verified questions ----------
-- p_rows: array of {category,topic,subtopic,difficulty,stem,stem_image,options,option_images,correct_option,
--                   exam_explanation,plain_explanation,similar_group,origin,sig}
-- Inserted one by one so a single bad row never loses the rest. Returns how many were stored.
create function add_generated_questions(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; c int;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      insert into questions(category, topic, subtopic, difficulty, stem, stem_image, options, option_images,
                            correct_option, exam_explanation, plain_explanation, similar_group, origin, sig, status)
      values ((r->>'category')::category_t, r->>'topic', nullif(r->>'subtopic',''), (r->>'difficulty')::int,
              r->>'stem', nullif(r->>'stem_image',''), r->'options', r->'option_images',
              upper(r->>'correct_option'), r->>'exam_explanation', r->>'plain_explanation',
              nullif(r->>'similar_group',''), coalesce(r->>'origin', 'ai'), r->>'sig', 'published')
      on conflict do nothing;
      get diagnostics c = row_count;
      n := n + c;
    exception when others then
      null;   -- skip this row only
    end;
  end loop;
  return n;
end $$;

create function gen_note(p_category category_t, p_diff int, p_origin text, p_made int, p_rejected int, p_error text)
returns void language sql security definer set search_path = public as
$$ insert into gen_log(category, difficulty, origin, made, rejected, error)
   values (p_category, p_diff, p_origin, p_made, p_rejected, left(p_error, 500)) $$;

-- Admin dashboard: stock of unseen questions per category + last generator activity
create function bank_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'stock', (select coalesce(jsonb_object_agg(c::text, jsonb_build_object(
                'published', (select count(*) from questions q where q.category = c and q.status = 'published'),
                'unseen', (select count(*) from questions q where q.category = c and q.status = 'published'
                            and not exists (select 1 from attempt_questions aq join attempts a on a.id = aq.attempt_id
                                             where aq.question_id = q.id and a.status <> 'reset')))), '{}')
                from unnest(enum_range(null::category_t)) c),
    'last_run', (select max(created_at) from gen_log),
    'last_error', (select error from gen_log where error is not null order by id desc limit 1));
end $$;

-- ---------- privileges ----------
revoke all on function gen_acquire(int), gen_release(), bank_needs(), add_generated_questions(jsonb),
  gen_note(category_t, int, text, int, int, text) from public, anon, authenticated;
grant execute on function gen_acquire(int), gen_release(), bank_needs(), add_generated_questions(jsonb),
  gen_note(category_t, int, text, int, int, text) to service_role;
revoke all on function bank_stats() from public, anon;
grant execute on function bank_stats() to authenticated;
