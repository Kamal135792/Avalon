-- Avalon anonymous multiplayer schema and RLS policies.
-- Apply in Supabase SQL editor or psql.

create extension if not exists "pgcrypto";

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  status text not null default 'lobby' check (status in ('lobby', 'in_progress', 'finished')),
  current_mission integer not null default 1 check (current_mission between 1 and 5),
  vote_track integer not null default 0 check (vote_track between 0 and 5),
  winner text check (winner in ('good', 'evil')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_code_format check (room_code ~ '^[A-Z]{4}$')
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  session_id uuid not null,
  name text not null,
  role text,
  is_host boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id, session_id)
);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  mission_number integer not null check (mission_number between 1 and 5),
  team_player_ids uuid[] not null,
  success_count integer not null default 0,
  fail_count integer not null default 0,
  result text check (result in ('success', 'fail')),
  created_at timestamptz not null default now(),
  unique (game_id, mission_number)
);

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  mission_number integer not null check (mission_number between 1 and 5),
  proposal_number integer not null check (proposal_number between 1 and 5),
  proposer_id uuid references public.players(id) on delete set null,
  team_player_ids uuid[] not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (game_id, mission_number, proposal_number)
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  vote text not null check (vote in ('approve', 'reject')),
  created_at timestamptz not null default now(),
  unique (proposal_id, player_id)
);

create table if not exists public.mission_submissions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  card text not null check (card in ('success', 'fail')),
  created_at timestamptz not null default now(),
  unique (mission_id, player_id)
);

create or replace function public.request_session_id()
returns uuid
language sql
stable
as $$
  select nullif((current_setting('request.headers', true)::json->>'x-session-id'), '')::uuid;
$$;

-- Helper: check membership without invoking RLS (security definer)
create or replace function public.is_game_member(gid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.players p
    where p.game_id = gid
      and p.session_id = public.request_session_id()
  );
$$;

create or replace function public.is_game_host(gid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.players p
    where p.game_id = gid
      and p.session_id = public.request_session_id()
      and p.is_host = true
  );
$$;

create or replace function public.is_player_owner(player_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.players p
    where p.id = player_id
      and p.session_id = public.request_session_id()
  );
$$;

create or replace function public.can_submit_mission(m_id uuid, p_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.players p
    join public.missions m on m.id = m_id
    where p.id = p_id
      and p.session_id = public.request_session_id()
      and p.id = any (m.team_player_ids)
  );
$$;

grant execute on function public.is_game_member(uuid) to anon, authenticated;
grant execute on function public.is_game_host(uuid) to anon, authenticated;
grant execute on function public.is_player_owner(uuid) to anon, authenticated;
grant execute on function public.can_submit_mission(uuid, uuid) to anon, authenticated;

alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.missions enable row level security;
alter table public.proposals enable row level security;
alter table public.votes enable row level security;
alter table public.mission_submissions enable row level security;

-- Games policies
create policy games_select_all on public.games
  for select
  using (true);

create policy games_insert_any on public.games
  for insert
  with check (true);

create policy games_update_host on public.games
  for update
  using (public.is_game_host(games.id))
  with check (public.is_game_host(games.id));

create policy games_delete_host on public.games
  for delete
  using (public.is_game_host(games.id));

-- Players policies
create policy players_select_game on public.players
  for select
  using (public.is_game_member(players.game_id));

create policy players_insert_self on public.players
  for insert
  with check (
    session_id = public.request_session_id()
    and exists (select 1 from public.games g where g.id = game_id)
  );

create policy players_update_self on public.players
  for update
  using (session_id = public.request_session_id())
  with check (session_id = public.request_session_id());

create policy players_delete_self on public.players
  for delete
  using (session_id = public.request_session_id());

-- Missions policies
create policy missions_select_game on public.missions
  for select
  using (public.is_game_member(missions.game_id));

create policy missions_insert_host on public.missions
  for insert
  with check (public.is_game_host(missions.game_id));

create policy missions_update_host on public.missions
  for update
  using (public.is_game_host(missions.game_id))
  with check (public.is_game_host(missions.game_id));

-- Proposals policies
create policy proposals_select_game on public.proposals
  for select
  using (public.is_game_member(proposals.game_id));

create policy proposals_insert_member on public.proposals
  for insert
  with check (public.is_game_member(proposals.game_id));

create policy proposals_update_member on public.proposals
  for update
  using (public.is_game_member(proposals.game_id))
  with check (public.is_game_member(proposals.game_id));

-- Votes policies
create policy votes_select_game on public.votes
  for select
  using (public.is_game_member(votes.game_id));

create policy votes_insert_self on public.votes
  for insert
  with check (public.is_player_owner(votes.player_id));

create policy mission_submissions_select_none on public.mission_submissions
  for select using (false);

create policy mission_submissions_insert_self on public.mission_submissions
  for insert
  with check (public.can_submit_mission(mission_submissions.mission_id, mission_submissions.player_id));

-- Mission tally helper (returns counts only, no player info)
create or replace function public.get_mission_tally(mission_id uuid)
returns table (
  success_count integer,
  fail_count integer,
  submitted_count integer
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select
      m.team_player_ids,
      count(*) filter (where ms.card = 'success')::integer as success_count,
      count(*) filter (where ms.card = 'fail')::integer as fail_count,
      count(*)::integer as submitted_count
    from public.missions m
    left join public.mission_submissions ms on ms.mission_id = m.id
    where m.id = mission_id
      and exists (
        select 1 from public.players p
        where p.game_id = m.game_id
          and p.session_id = public.request_session_id()
      )
    group by m.team_player_ids
  )
  select
    case
      when submitted_count = coalesce(array_length(team_player_ids, 1), 0) then success_count
      else 0
    end as success_count,
    case
      when submitted_count = coalesce(array_length(team_player_ids, 1), 0) then fail_count
      else 0
    end as fail_count,
    submitted_count
  from base;
$$;

grant execute on function public.get_mission_tally(uuid) to anon, authenticated;

-- Assassin resolution helper
create or replace function public.resolve_assassination(
  game_id uuid,
  guessed_player_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  merlin_id uuid;
  outcome text;
  caller_is_assassin boolean;
begin
  select exists (
    select 1
    from public.players p
    where p.game_id = resolve_assassination.game_id
      and p.session_id = public.request_session_id()
      and p.role = 'assassin'
  ) into caller_is_assassin;

  if caller_is_assassin is not true then
    raise exception 'Only the assassin can resolve the assassination';
  end if;

  select id into merlin_id
  from public.players
  where game_id = resolve_assassination.game_id
    and role = 'merlin'
  limit 1;

  if merlin_id is null then
    raise exception 'Merlin not assigned';
  end if;

  if merlin_id = guessed_player_id then
    outcome := 'evil';
  else
    outcome := 'good';
  end if;

  update public.games
  set winner = outcome,
      status = 'finished'
  where id = resolve_assassination.game_id;

  return outcome;
end;
$$;

grant execute on function public.resolve_assassination(uuid, uuid) to anon, authenticated;
