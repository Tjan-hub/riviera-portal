-- RIVIERA – Supabase Schema
-- Im Supabase SQL Editor als Projekt-Owner ausführen.
create extension if not exists pgcrypto;

create table if not exists public.riviera_settings (
  singleton boolean primary key default true check (singleton),
  registration_open boolean not null default true,
  founder_admin_id uuid,
  second_admin_id uuid,
  created_at timestamptz not null default now()
);
insert into public.riviera_settings(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  rank int not null default 1 check(rank between 1 and 12),
  role text not null default 'member' check(role in ('member','admin','founder_admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.riviera_settings add constraint founder_profile_fk foreign key(founder_admin_id) references public.profiles(id) on delete set null;
alter table public.riviera_settings add constraint second_admin_profile_fk foreign key(second_admin_id) references public.profiles(id) on delete set null;

create table if not exists public.member_permissions(
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission text not null,
  primary key(user_id,permission)
);
create table if not exists public.attendance(
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  status smallint not null check(status between 0 and 3),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(user_id,day)
);
create table if not exists public.inventory_items(
  id uuid primary key default gen_random_uuid(),
  storage text not null check(storage in ('main_storage','leader_storage','weapon_storage')),
  name text not null,
  quantity bigint not null default 0 check(quantity>=0),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(storage,name)
);
create table if not exists public.inventory_logs(
  id uuid primary key default gen_random_uuid(),
  storage text not null,
  item_id uuid references public.inventory_items(id),
  item_name text not null,
  action text not null check(action in ('in','out')),
  quantity bigint not null check(quantity>0),
  note text not null default '',
  actor_id uuid references public.profiles(id),
  actor_name text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.has_permission(p text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles where id=auth.uid() and active and role in ('admin','founder_admin'))
 or exists(select 1 from member_permissions where user_id=auth.uid() and permission=p);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles where id=auth.uid() and active and role in ('admin','founder_admin'));
$$;

-- Erstes Konto wird atomar Gründer-Admin. Die Registrierung wird vor dem Profil-Insert geprüft.
-- Hilfsfunktion: prüft, ob dieses Konto Gründer wurde (über Settings).
create or replace function public.founder_found_by(p_user uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select founder_admin_id=p_user from riviera_settings where singleton=true;
$$;
-- Trigger-Funktion neu definieren, damit sie die Hilfsfunktion nutzt.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public,auth as $$
begin
  if not (select registration_open from public.riviera_settings where singleton=true) then
    raise exception 'Die Registrierung ist derzeit geschlossen.';
  end if;
  insert into public.profiles(id,email,display_name,rank,role)
  values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'display_name',''),1,'member');
  update public.riviera_settings set founder_admin_id=new.id
   where singleton=true and founder_admin_id is null;
  if public.founder_found_by(new.id) then
    update public.profiles set role='founder_admin' where id=new.id;
  end if;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.get_registration_open() returns boolean
language sql stable security definer set search_path=public as $$
 select registration_open from riviera_settings where singleton=true;
$$;

create or replace function public.set_registration_open(new_open boolean) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if not public.has_permission('registration.manage') then raise exception 'Keine Berechtigung.'; end if;
 update riviera_settings set registration_open=new_open where singleton=true;
 return new_open;
end; $$;

create or replace function public.set_member_permissions(target_user uuid,new_permissions text[]) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.has_permission('permissions.grant') then raise exception 'Keine Berechtigung.'; end if;
 if target_user=(select founder_admin_id from riviera_settings where singleton=true) then
   raise exception 'Berechtigungen des Gründer-Admins können nicht geändert werden.';
 end if;
 delete from member_permissions where user_id=target_user;
 insert into member_permissions(user_id,permission)
 select target_user,unnest(new_permissions);
end; $$;

create or replace function public.admin_update_member(target_user uuid,new_display_name text,new_rank int) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.has_permission('members.manage') then raise exception 'Keine Berechtigung.'; end if;
 if new_rank<1 or new_rank>12 then raise exception 'Rang muss zwischen 1 und 12 liegen.'; end if;
 update profiles set display_name=new_display_name,rank=new_rank where id=target_user and active;
end; $$;

create or replace function public.set_attendance(target_user uuid,attendance_day date,new_status smallint) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.has_permission('attendance.edit') then raise exception 'Keine Berechtigung.'; end if;
 if new_status not between 0 and 3 then raise exception 'Ungültiger Status.'; end if;
 insert into attendance(user_id,day,status,updated_by) values(target_user,attendance_day,new_status,auth.uid())
 on conflict(user_id,day) do update set status=excluded.status,updated_by=excluded.updated_by,updated_at=now();
end; $$;

create or replace function public.add_inventory_item(storage_name text,item_name text) returns uuid
language plpgsql security definer set search_path=public as $$
declare new_id uuid; perm text;
begin
 perm:=storage_name||'.items';
 if storage_name not in ('main_storage','leader_storage','weapon_storage') then raise exception 'Ungültiges Lager.'; end if;
 if not public.has_permission(perm) then raise exception 'Keine Berechtigung.'; end if;
 insert into inventory_items(storage,name,created_by) values(storage_name,trim(item_name),auth.uid()) returning id into new_id;
 return new_id;
end; $$;

create or replace function public.move_inventory_item(item_id uuid,move_action text,move_quantity bigint,move_note text) returns void
language plpgsql security definer set search_path=public as $$
declare it inventory_items%rowtype; perm text; actor text;
begin
 select * into it from inventory_items where id=item_id and active=true for update;
 if not found then raise exception 'Item nicht gefunden.'; end if;
 perm:=it.storage||'.move';
 if not public.has_permission(perm) then raise exception 'Keine Berechtigung.'; end if;
 if move_quantity<=0 or move_action not in ('in','out') then raise exception 'Ungültige Buchung.'; end if;
 if move_action='out' and it.quantity<move_quantity then raise exception 'Nicht genügend Bestand.'; end if;
 update inventory_items set quantity=quantity + case when move_action='in' then move_quantity else -move_quantity end where id=item_id;
 select coalesce(display_name,email) into actor from profiles where id=auth.uid();
 insert into inventory_logs(storage,item_id,item_name,action,quantity,note,actor_id,actor_name)
 values(it.storage,it.id,it.name,move_action,move_quantity,coalesce(move_note,''),auth.uid(),coalesce(actor,'Mitglied'));
end; $$;

create or replace view public.attendance_stats as
 select p.id as user_id,
 count(a.*) filter(where a.status=0) as present_count,
 count(a.*) filter(where a.status=1) as absent_count,
 count(a.*) filter(where a.status=2) as unexcused_count,
 count(a.*) filter(where a.status=3) as excused_count
 from public.profiles p left join public.attendance a on a.user_id=p.id
 where p.active group by p.id;

create or replace function public.appoint_second_admin(target_user uuid) returns void
language plpgsql security definer set search_path=public as $$
declare founder uuid;
begin
 select founder_admin_id into founder from riviera_settings where singleton=true;
 if auth.uid() is distinct from founder then raise exception 'Nur der Gründer-Admin darf den zweiten Admin ernennen.'; end if;
 if target_user=founder then raise exception 'Der Gründer ist bereits Admin.'; end if;
 if not exists(select 1 from profiles where id=target_user and active) then raise exception 'Mitglied nicht gefunden.'; end if;
 update profiles set role='member' where id=(select second_admin_id from riviera_settings where singleton=true) and id<>target_user;
 update profiles set role='admin' where id=target_user;
 update riviera_settings set second_admin_id=target_user where singleton=true;
end; $$;

create or replace function public.remove_member(target_user uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.has_permission('members.remove') then raise exception 'Keine Berechtigung.'; end if;
 if target_user=(select founder_admin_id from riviera_settings where singleton=true) then raise exception 'Der Gründer-Admin ist geschützt.'; end if;
 if target_user=auth.uid() then raise exception 'Du kannst dich nicht selbst entfernen.'; end if;
 if target_user=(select second_admin_id from riviera_settings where singleton=true) then
   update riviera_settings set second_admin_id=null where singleton=true;
   update profiles set role='member',active=false where id=target_user;
 else
   update profiles set active=false where id=target_user;
 end if;
end; $$;

-- RLS: Frontend darf nur Daten sehen; Änderungen an geschützten Daten laufen über RPCs.
alter table profiles enable row level security;
alter table member_permissions enable row level security;
alter table attendance enable row level security;
alter table inventory_items enable row level security;
alter table inventory_logs enable row level security;
alter table riviera_settings enable row level security;

create policy "profiles visible to authenticated" on profiles for select to authenticated
using (active and (id=auth.uid() or has_permission('members.view') or is_admin()));
create policy "permissions self or grantor" on member_permissions for select to authenticated
using (user_id=auth.uid() or has_permission('permissions.grant') or is_admin());
create policy "attendance visible by permission" on attendance for select to authenticated
using (has_permission('attendance.view') or has_permission('attendance.edit') or is_admin());
create policy "items visible by permission" on inventory_items for select to authenticated
using (has_permission(storage||'.view') or has_permission(storage||'.items') or has_permission(storage||'.move') or is_admin());
create policy "logs visible by permission" on inventory_logs for select to authenticated
using (has_permission(storage||'.view') or has_permission(storage||'.move') or is_admin());
create policy "settings readable" on riviera_settings for select to authenticated
using (is_admin() or has_permission('registration.manage'));

grant usage on schema public to authenticated;
grant select on profiles,member_permissions,attendance,inventory_items,inventory_logs,riviera_settings to authenticated;
grant execute on function public.get_registration_open() to anon,authenticated;
grant execute on function public.set_registration_open(boolean) to authenticated;
grant execute on function public.set_member_permissions(uuid,text[]) to authenticated;
grant execute on function public.admin_update_member(uuid,text,int) to authenticated;
grant execute on function public.set_attendance(uuid,date,smallint) to authenticated;
grant execute on function public.add_inventory_item(text,text) to authenticated;
grant execute on function public.move_inventory_item(uuid,text,bigint,text) to authenticated;
grant select on public.attendance_stats to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.appoint_second_admin(uuid) to authenticated;

-- Hinweis: Der Gründer-Admin muss den zweiten Admin über eine gesonderte, abgesicherte
-- Ernennungsfunktion erhalten. Diese Funktion wird bewusst nicht über das Frontend freigegeben,
-- bis die konkrete Admin-Ernennungs-/Entfernungsregel abschließend implementiert ist.
