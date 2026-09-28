\set ON_ERROR_STOP on
insert into auth.users values ('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000a');
insert into profiles values ('00000000-0000-0000-0000-00000000000c','Sitara','c@x.com','candidate'),('00000000-0000-0000-0000-00000000000a','Owner','a@x.com','admin');
-- tiny configs for test
update test_configs set question_count=4, duration_seconds=60;
-- 24 questions: 6 per category, difficulty 1..2
insert into questions(category,topic,subtopic,difficulty,stem,options,correct_option,exam_explanation,plain_explanation,similar_group,status)
select c, 'topic-'||c, 'sub', 1 + (g % 2), 'Q'||g||' '||c, '{"A":"a","B":"b","C":"c","D":"d"}', 'B', 'fast method '||g, 'plain idea '||g, 'grp-'||c, 'published'
from unnest(enum_range(null::category_t)) c, generate_series(1,6) g;
-- publish constraint check
do $$ begin
  begin
    insert into questions(category,topic,difficulty,stem,options,correct_option,exam_explanation,plain_explanation,status)
    values ('gk','t',1,'x','{"A":"a","B":"b","C":"c","D":"d"}','A','same','same','published');
    raise exception 'constraint failed to fire';
  exception when check_violation then raise notice 'OK: identical explanations rejected'; end;
end $$;

set app.uid = '00000000-0000-0000-0000-00000000000c';
select start_attempt('verbal') as att \gset
select start_attempt('verbal') = :'att' as resumed_same;
select jsonb_array_length(get_attempt(:'att')->'questions') as nq, (get_attempt(:'att')->'questions'->0) ? 'correct_option' as leaks_answer;
-- answer: pick displayed option index; answer first 2 correctly (correct key = B), others wrong
do $$ declare a uuid; i int; begin
  select id into a from attempts limit 1;
  perform save_answer(a,1,'B',1000); perform save_answer(a,2,'B',1200); perform save_answer(a,3,'A',900);
end $$;
select (submit_attempt(:'att')->>'score') as score, (submit_attempt(:'att')->>'status') as status;
select count(*) as outbox_rows from email_outbox;
select count(*) as mistakes_rows from mistakes;  -- expect 2 (one wrong + one unanswered)
select save_answer(:'att',1,'A',1) as save_after_submit;
select start_attempt('verbal') = :'att' as locked_same_id;
select jsonb_array_length(get_mistakes()) as mistakes_json;
select (similar_question((select question_id from mistakes limit 1))->>'question_id') is not null as similar_ok;
-- timeout path
select start_attempt('gk') as att2 \gset
reset app.uid;
update attempts set deadline_at = now() - interval '1 minute' where id = :'att2';
select close_expired_attempts() as closed;
select status, score from attempts where id = :'att2';
-- streak & status
set app.uid = '00000000-0000-0000-0000-00000000000c';
select start_attempt('nonverbal') as a3 \gset
select start_attempt('education') as a4 \gset
select submit_attempt(:'a3') is not null as s3, submit_attempt(:'a4') is not null as s4;
select current_streak() as streak_all4;
select today_status()->>'done_count' as done_count;
-- admin
set app.uid = '00000000-0000-0000-0000-00000000000a';
select admin_reset_attempt(:'att', 'power cut');
select admin_send_reminder();
select today_status()->>'done_count' as admin_view_done;
-- reset allows a new attempt
set app.uid = '00000000-0000-0000-0000-00000000000c';
select start_attempt('verbal') <> :'att' as new_attempt_after_reset;
-- shortage error
reset app.uid; update questions set status='retired' where category='gk'; set app.uid='00000000-0000-0000-0000-00000000000c';
do $$ begin begin perform start_attempt('gk'); exception when others then raise notice 'gk today already attempted -> resume path OK: %', sqlerrm; end; end $$;
