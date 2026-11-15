-- Let team members add dated notes to a deal, save a reason when a deal is won or lost, and remember the furthest stage each deal reached for reports.
-- Approved by ydb and applied by ThatCode on 2026-11-15 01:48:09 UTC.

alter table public.deals
  add column close_reason text,
  add column furthest_stage text not null default 'Lead'
    constraint deals_furthest_stage_check check (furthest_stage in ('Lead','Qualified','Proposal','Won'));

update public.deals set furthest_stage = case when stage = 'Lost' then 'Lead' else stage end;

create or replace function public.set_deal_closed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare ord text[] := array['Lead','Qualified','Proposal','Won'];
begin
  if new.stage = 'Won' then
    if tg_op = 'INSERT' then
      new.closed_at := now();
    elsif old.stage is distinct from 'Won' then
      new.closed_at := now();
    end if;
  else
    new.closed_at := null;
  end if;
  if new.stage not in ('Won','Lost') then
    new.close_reason := null;
  end if;
  if tg_op = 'INSERT' then
    new.furthest_stage := case when new.stage = 'Lost' then 'Lead' else new.stage end;
  else
    new.furthest_stage := old.furthest_stage;
    if new.stage <> 'Lost' and array_position(ord, new.stage) > array_position(ord, old.furthest_stage) then
      new.furthest_stage := new.stage;
    end if;
  end if;
  return new;
end $$;

create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r jsonb; o jsonb; det text; actor text; ent text; act text;
begin
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  ent := case tg_table_name when 'contacts' then 'contact' when 'deals' then 'deal' else 'task' end;
  act := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    if tg_table_name = 'deals' and (o->>'stage') <> (r->>'stage') then
      det := 'moved from ' || (o->>'stage') || ' to ' || (r->>'stage');
      if coalesce(r->>'close_reason', '') <> '' then
        det := det || ': ' || (r->>'close_reason');
      end if;
    elsif tg_table_name = 'tasks' and (o->>'done') <> (r->>'done') then
      det := case when (r->>'done') = 'true' then 'marked done' else 'reopened' end;
    end if;
  end if;
  select display_name into actor from public.profiles where user_id = (select auth.uid());
  insert into public.activity_log (user_id, actor_name, action, entity, entity_name, detail)
  values ((select auth.uid()), coalesce(actor, 'Someone'), act, ent, coalesce(r->>'name', r->>'title'), det);
  return null;
end $$;

create table public.deal_notes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  body text not null check (length(trim(body)) > 0 and length(body) <= 5000),
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index deal_notes_deal_id_idx on public.deal_notes (deal_id, created_at desc);

alter table public.deal_notes enable row level security;

revoke all on public.deal_notes from anon, authenticated;

grant select, insert, delete on public.deal_notes to authenticated;

create policy "Team reads deal notes" on public.deal_notes for select to authenticated
  using ((select public.is_team()));

create policy "Team adds own deal notes" on public.deal_notes for insert to authenticated
  with check ((select public.is_team()) and author_id = (select auth.uid()));

create policy "Authors delete their deal notes" on public.deal_notes for delete to authenticated
  using ((select public.is_team()) and author_id = (select auth.uid()));
