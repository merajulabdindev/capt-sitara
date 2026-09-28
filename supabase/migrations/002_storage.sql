-- Private bucket for non-verbal images. Use random file names (uuid.png) so paths never hint at answers.
insert into storage.buckets (id, name, public) values ('question-images', 'question-images', false)
on conflict (id) do nothing;

create policy "auth read question images" on storage.objects for select to authenticated
  using (bucket_id = 'question-images');
create policy "admin write question images" on storage.objects for all to authenticated
  using (bucket_id = 'question-images' and public.is_admin())
  with check (bucket_id = 'question-images' and public.is_admin());
