-- Tests for 005_ai.sql. Run AFTER test_behavior.sql on the same scratch database (needs the test users it creates).
\set ON_ERROR_STOP on
select gen_acquire() as got1, gen_acquire() as got2_should_be_f;
select gen_release();
select gen_acquire() as got_after_release;
select gen_release();
-- needs with current data (test data: 24 published q, configs 4 q/test)
select cat, diff, want, have, deficit from bank_needs() order by 1,2 limit 6;
-- insert generated rows
select add_generated_questions('[
 {"category":"verbal","topic":"Analogies","difficulty":1,"stem":"Cat : Kitten :: Dog : ?","options":{"A":"Puppy","B":"Cub","C":"Calf","D":"Foal"},"correct_option":"a","exam_explanation":"Young of the animal.","plain_explanation":"A kitten is a baby cat; a puppy is a baby dog.","similar_group":"young-of","origin":"ai","sig":"s1"},
 {"category":"verbal","topic":"Analogies","difficulty":1,"stem":"dup","options":{"A":"1","B":"2","C":"3","D":"4"},"correct_option":"A","exam_explanation":"x","plain_explanation":"y","origin":"ai","sig":"s1"},
 {"category":"verbal","topic":"Bad","difficulty":1,"stem":"same expl","options":{"A":"1","B":"2","C":"3","D":"4"},"correct_option":"A","exam_explanation":"x","plain_explanation":"x","origin":"ai","sig":"s2"},
 {"category":"verbal","topic":"Bad","difficulty":9,"stem":"bad diff","options":{"A":"1","B":"2","C":"3","D":"4"},"correct_option":"A","exam_explanation":"x","plain_explanation":"y","origin":"ai","sig":"s3"},
 {"category":"nonverbal","topic":"Series","difficulty":2,"stem":"Which next?","stem_image":"nv/a.svg","options":{"A":"","B":"","C":"","D":""},"option_images":{"A":"nv/1.svg","B":"nv/2.svg","C":"nv/3.svg","D":"nv/4.svg"},"correct_option":"C","exam_explanation":"e","plain_explanation":"p","origin":"code","sig":"n1"}
]'::jsonb) as stored_should_be_2;
select origin, count(*) from questions where origin <> 'manual' group by 1 order by 1;
select gen_note('verbal', 1, 'ai', 5, 2, null); select gen_note('gk', 2, 'ai', 0, 0, 'boom');
select count(*) as log_rows from gen_log;
-- import dedupe
insert into questions_import(category,topic,difficulty,stem,option_a,option_b,option_c,option_d,correct_option,exam_explanation,plain_explanation)
values ('gk','t',1,'Capital of Pakistan?','Islamabad','Lahore','Karachi','Quetta','A','e1','p1'),('gk','t',1,'Capital of Pakistan?','Islamabad','Lahore','Karachi','Quetta','A','e1','p1');
select import_questions() as imported_should_be_1;
select publish_drafts() as published;
-- admin stats
set app.uid = '00000000-0000-0000-0000-00000000000a';
select bank_stats();
set app.uid = '00000000-0000-0000-0000-00000000000c';
do $$ begin perform bank_stats(); raise exception 'candidate should not pass'; exception when others then raise notice 'OK candidate blocked: %', sqlerrm; end $$;
