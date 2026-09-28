-- Easy question import: upload the CSV into table "questions_import" (Table Editor -> Import data from CSV),
-- then run:  select import_questions();   and later:  select publish_drafts();
create table questions_import (
  category category_t, topic text, subtopic text, difficulty int, stem text, stem_image text,
  option_a text, option_b text, option_c text, option_d text, correct_option text,
  exam_explanation text, plain_explanation text, similar_group text,
  source_title text, source_url text, source_date date, status text
);
alter table questions_import enable row level security;
create policy import_admin on questions_import for all using (is_admin()) with check (is_admin());

create function import_questions() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into questions(category, topic, subtopic, difficulty, stem, stem_image, options, correct_option,
                        exam_explanation, plain_explanation, similar_group, source_title, source_url, source_date, status)
  select category, topic, nullif(subtopic,''), difficulty, stem, nullif(stem_image,''),
         jsonb_build_object('A', coalesce(option_a,''), 'B', coalesce(option_b,''), 'C', coalesce(option_c,''), 'D', coalesce(option_d,'')),
         upper(trim(correct_option)), nullif(exam_explanation,''), nullif(plain_explanation,''), nullif(similar_group,''),
         nullif(source_title,''), nullif(source_url,''), source_date, 'draft'
    from questions_import;
  get diagnostics n = row_count;
  delete from questions_import;
  return n;
end $$;

-- Publishes every draft that has two different explanations. Returns how many were published.
create function publish_drafts() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update questions set status = 'published'
   where status in ('draft','reviewed') and exam_explanation is not null and plain_explanation is not null
     and exam_explanation <> plain_explanation;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function import_questions(), publish_drafts() from public, anon, authenticated;
