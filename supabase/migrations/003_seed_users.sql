-- Creates the two accounts. Run once in the Supabase SQL editor AFTER 001 and 002.
--
-- Login username -> auth email mapping (the login screen appends the domain):
--   admin     -> admin@captsitara.app      password: Sitarailu
--   candidate -> candidate@captsitara.app  password: Merajilu
--
-- EDIT the two notification emails below (where result emails and reminders are delivered).

create extension if not exists pgcrypto;

do $$
declare
  admin_notify_email     text := 'merajulabdindev@gmail.com';
  candidate_notify_email text := 'sitrailam9@gmail.com';
  aid uuid := gen_random_uuid();
  cid uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values
    ('00000000-0000-0000-0000-000000000000', aid, 'authenticated', 'authenticated',
     'admin@captsitara.app', crypt('Sitarailu', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', cid, 'authenticated', 'authenticated',
     'candidate@captsitara.app', crypt('Merajilu', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values
    (gen_random_uuid(), aid, aid::text, jsonb_build_object('sub', aid::text, 'email', 'admin@captsitara.app'), 'email', now(), now(), now()),
    (gen_random_uuid(), cid, cid::text, jsonb_build_object('sub', cid::text, 'email', 'candidate@captsitara.app'), 'email', now(), now(), now());

  insert into public.profiles (id, name, email, role) values
    (aid, 'Admin',     admin_notify_email,     'admin'),
    (cid, 'Candidate', candidate_notify_email, 'candidate');
end $$;

-- Her day 1 (change if she starts on a different date)
update public.app_settings set program_start = (now() at time zone 'Asia/Karachi')::date;
