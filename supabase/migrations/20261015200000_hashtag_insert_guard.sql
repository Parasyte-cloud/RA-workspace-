-- Audit 2026-10-15: any employee could insert any row into social_hashtags
-- (an always-true check). Keep posting working, but only accept well-formed tags.
drop policy if exists "social hashtag manage" on public.social_hashtags;
create policy "social hashtag manage" on public.social_hashtags
  for insert to authenticated
  with check (
    tag = lower(tag)
    and char_length(tag) between 1 and 50
    and tag ~ '^[[:alnum:]_]+$'
  );
