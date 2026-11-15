-- Save team accounts, contacts, deals, tasks and an activity log; only approved team members can read or change them, and only admins change roles.
-- Applied by ThatCode on 2026-11-15 01:35:03 UTC, while building the app's first version.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role text not null default 'pending' check (role in ('admin','member','pending')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;

grant select on public.profiles to authenticated;

create policy "Signed-in people can read team names" on public.profiles for select to authenticated using (true);

create function public.is_team() returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = (select auth.uid()) and role in ('admin','member'));
$$;

revoke execute on function public.is_team() from public, anon;

grant execute on function public.is_team() to authenticated;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name, role)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), 'New member'), 40),
    case when exists (select 1 from public.profiles) then 'pending' else 'admin' end
  );
  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create function public.set_member_role(target uuid, new_role text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where user_id = (select auth.uid()) and role = 'admin') then
    raise exception 'Only admins can change roles';
  end if;
  if new_role not in ('admin','member','pending') then
    raise exception 'Unknown role';
  end if;
  if target = (select auth.uid()) then
    raise exception 'You cannot change your own role';
  end if;
  update public.profiles set role = new_role where user_id = target;
end $$;

revoke execute on function public.set_member_role(uuid, text) from public, anon;

grant execute on function public.set_member_role(uuid, text) to authenticated;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text,
  phone text,
  notes text,
  status text not null default 'Lead' check (status in ('Lead','Customer','Partner','Other')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  value numeric not null default 0 check (value >= 0),
  stage text not null default 'Lead' check (stage in ('Lead','Qualified','Proposal','Won','Lost')),
  owner_id uuid default auth.uid(),
  contact_id uuid references public.contacts (id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  due_date date,
  done boolean not null default false,
  contact_id uuid references public.contacts (id) on delete set null,
  deal_id uuid references public.deals (id) on delete set null,
  assigned_to uuid default auth.uid(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  actor_name text not null,
  action text not null,
  entity text not null,
  entity_name text,
  detail text,
  created_at timestamptz not null default now()
);

create index on public.deals (stage);

create index on public.tasks (due_date);

create index on public.activity_log (created_at desc);

alter table public.contacts enable row level security;

alter table public.deals enable row level security;

alter table public.tasks enable row level security;

alter table public.activity_log enable row level security;

revoke all on public.contacts, public.deals, public.tasks, public.activity_log from anon, authenticated;

grant select, insert, update, delete on public.contacts, public.deals, public.tasks to authenticated;

grant select on public.activity_log to authenticated;

create policy "Team reads contacts" on public.contacts for select to authenticated using ((select public.is_team()));

create policy "Team adds contacts" on public.contacts for insert to authenticated with check ((select public.is_team()));

create policy "Team edits contacts" on public.contacts for update to authenticated using ((select public.is_team())) with check ((select public.is_team()));

create policy "Team deletes contacts" on public.contacts for delete to authenticated using ((select public.is_team()));

create policy "Team reads deals" on public.deals for select to authenticated using ((select public.is_team()));

create policy "Team adds deals" on public.deals for insert to authenticated with check ((select public.is_team()));

create policy "Team edits deals" on public.deals for update to authenticated using ((select public.is_team())) with check ((select public.is_team()));

create policy "Team deletes deals" on public.deals for delete to authenticated using ((select public.is_team()));

create policy "Team reads tasks" on public.tasks for select to authenticated using ((select public.is_team()));

create policy "Team adds tasks" on public.tasks for insert to authenticated with check ((select public.is_team()));

create policy "Team edits tasks" on public.tasks for update to authenticated using ((select public.is_team())) with check ((select public.is_team()));

create policy "Team deletes tasks" on public.tasks for delete to authenticated using ((select public.is_team()));

create policy "Team reads the activity log" on public.activity_log for select to authenticated using ((select public.is_team()));

create function public.set_deal_closed() returns trigger language plpgsql set search_path = '' as $$
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
  return new;
end $$;

create trigger deals_closed before insert or update on public.deals for each row execute function public.set_deal_closed();

create function public.log_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb; o jsonb; det text; actor text; ent text; act text;
begin
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  ent := case tg_table_name when 'contacts' then 'contact' when 'deals' then 'deal' else 'task' end;
  act := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    if tg_table_name = 'deals' and (o->>'stage') <> (r->>'stage') then
      det := 'moved from ' || (o->>'stage') || ' to ' || (r->>'stage');
    elsif tg_table_name = 'tasks' and (o->>'done') <> (r->>'done') then
      det := case when (r->>'done') = 'true' then 'marked done' else 'reopened' end;
    end if;
  end if;
  select display_name into actor from public.profiles where user_id = (select auth.uid());
  insert into public.activity_log (user_id, actor_name, action, entity, entity_name, detail)
  values ((select auth.uid()), coalesce(actor, 'Someone'), act, ent, coalesce(r->>'name', r->>'title'), det);
  return null;
end $$;

revoke execute on function public.log_change() from public, anon, authenticated;

create trigger contacts_log after insert or update or delete on public.contacts for each row execute function public.log_change();

create trigger deals_log after insert or update or delete on public.deals for each row execute function public.log_change();

create trigger tasks_log after insert or update or delete on public.tasks for each row execute function public.log_change();
