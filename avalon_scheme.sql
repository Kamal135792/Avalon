-- AVALON CLEAN RESET — removes only this application's rooms and players.
-- Run the entire file in Supabase SQL Editor as postgres. Deploy the matching app.
-- All DDL is transactional: a failure rolls back the reset.
begin;
-- Remove legacy endpoints, including unsafe SECURITY DEFINER helpers.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
 ('request_session_id','is_game_member','is_game_host','is_player_owner','can_submit_mission',
 'get_mission_tally','get_my_hand','get_my_player_id','create_game','join_game','start_game',
 'submit_proposal','cast_vote','finalize_vote','submit_mission_card','resolve_mission','resolve_assassination',
 'avalon_create','avalon_join','avalon_state','avalon_action')
 loop execute format('drop function %s cascade',f.signature); end loop;
end $$;
drop table if exists public.mission_submissions, public.votes, public.proposals,
 public.missions, public.player_hands, public.players, public.games cascade;
drop schema if exists avalon_private cascade;
create schema avalon_private;
revoke all on schema avalon_private from public, anon, authenticated;

create table avalon_private.games (
 id uuid primary key default gen_random_uuid(), code text unique not null check(code ~ '^[A-Z]{4}$'),
 round_id uuid not null default gen_random_uuid(), phase text not null default 'lobby'
 check(phase in ('lobby','team','vote','quest','lady','assassination','finished')),
 quest integer not null default 1 check(quest between 1 and 5), rejections integer not null default 0 check(rejections between 0 and 5),
 leader_id uuid, lady_id uuid, lady_used uuid[] not null default '{}',
 options jsonb not null default '{"percival":true,"morgana":true,"mordred":false,"oberon":false,"lady":false,"targeting":false}',
 winner text check(winner in ('good','evil')), reason text, assassin_target uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table avalon_private.players (
 id uuid primary key default gen_random_uuid(), game_id uuid not null references avalon_private.games on delete cascade,
 secret uuid not null, name text not null check(length(name) between 2 and 24),
 host boolean not null default false, ready boolean not null default false,
 seat bigint generated always as identity, last_seen timestamptz not null default now(),
 role text check(role in ('merlin','percival','loyal_servant','assassin','morgana','mordred','oberon','minion')),
 unique(game_id,secret)
);
create unique index one_host on avalon_private.players(game_id) where host;
create unique index unique_player_name on avalon_private.players(game_id,lower(name));
create table avalon_private.proposals (
 id uuid primary key default gen_random_uuid(), game_id uuid not null references avalon_private.games on delete cascade,
 number integer not null, quest integer not null, leader_id uuid not null, team uuid[] not null,
 status text not null default 'pending', unique(game_id,number)
);
create table avalon_private.votes (
 proposal_id uuid not null references avalon_private.proposals on delete cascade,
 player_id uuid not null references avalon_private.players on delete cascade,
 card text not null check(card in ('approve','reject')), primary key(proposal_id,player_id)
);
create table avalon_private.quests (
 id uuid primary key default gen_random_uuid(), game_id uuid not null references avalon_private.games on delete cascade,
 number integer not null, team uuid[] not null, result text, fails integer,
 unique(game_id,number)
);
create table avalon_private.cards (
 quest_id uuid not null references avalon_private.quests on delete cascade,
 player_id uuid not null references avalon_private.players on delete cascade,
 card text not null check(card in ('success','fail')), primary key(quest_id,player_id)
);
create table avalon_private.inspections (
 id bigint generated always as identity primary key, game_id uuid not null references avalon_private.games on delete cascade,
 holder_id uuid not null, target_id uuid not null, alignment text not null
);
create table avalon_private.messages (
 id bigint generated always as identity primary key, game_id uuid not null references avalon_private.games on delete cascade,
 player_id uuid not null, name text not null, body text not null check(length(body) between 1 and 500),
 created_at timestamptz not null default now()
);
create index messages_room on avalon_private.messages(game_id,id);
-- Defense in depth: no client role can query private tables, including via PostgREST.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='avalon_private' loop
 execute format('alter table avalon_private.%I enable row level security',t.tablename);
 end loop;
end $$;
revoke all on all tables in schema avalon_private from public,anon,authenticated;
revoke all on all sequences in schema avalon_private from public,anon,authenticated;

create function avalon_private.identity() returns uuid language plpgsql stable set search_path=pg_catalog as $$
declare sid uuid; begin
 sid := nullif(current_setting('request.headers',true),'')::jsonb->>'x-session-id';
 if sid is null then raise exception 'Missing player identity. Reload the page.'; end if;
 return sid;
end $$;
create function avalon_private.evil(r text) returns boolean language sql immutable as $$
 select r in ('assassin','morgana','mordred','oberon','minion');
$$;
create function avalon_private.team_size(n integer,q integer) returns integer language sql immutable as $$
 select (case n when 5 then array[2,3,2,3,3] when 6 then array[2,3,4,3,4]
 when 7 then array[2,3,3,4,4] when 8 then array[3,4,4,5,5] when 9 then array[3,4,4,5,5]
 when 10 then array[3,4,4,5,5] end)[q];
$$;
create function avalon_private.next_leader(gid uuid,current_id uuid) returns uuid language sql stable set search_path=pg_catalog,avalon_private,pg_temp as $$
 select id from players where game_id=gid order by (seat <= (select seat from players where id=current_id)),seat limit 1;
$$;

create function public.avalon_create(p_name text) returns text language plpgsql security definer set search_path=pg_catalog,avalon_private,pg_temp as $$
declare sid uuid:=avalon_private.identity(); gid uuid; c text; i integer;
begin
 if p_name is null or length(trim(p_name)) not between 2 and 24 then raise exception 'Use a name with 2–24 characters.'; end if;
 -- Bound anonymous creation by identity. Abandoned rooms expire when accessed.
 if (select count(*) from players p join games g on g.id=p.game_id where p.secret=sid and p.host and g.created_at>now()-interval '1 hour')>=10 then raise exception 'Too many rooms created. Try again later.'; end if;
 for attempt in 1..20 loop
 c:=''; for i in 1..4 loop c:=c||chr(65+floor(random()*26)::integer); end loop;
 begin
 insert into games(code) values(c) returning id into gid;
 insert into players(game_id,secret,name,host) values(gid,sid,trim(p_name),true);
 return c;
 exception when unique_violation then if attempt=20 then raise; end if; end;
 end loop;
 raise exception 'Unable to create a room.';
end $$;

create function public.avalon_join(p_code text,p_name text) returns text language plpgsql security definer set search_path=pg_catalog,avalon_private,pg_temp as $$
declare sid uuid:=avalon_private.identity(); g games; pid uuid;
begin
 select * into g from games where code=upper(trim(p_code)) for update;
 if not found or g.updated_at<now()-interval '7 days' then raise exception 'Room not found or expired.'; end if;
 select id into pid from players where game_id=g.id and secret=sid;
 if pid is not null then update players set last_seen=now() where id=pid; return g.code; end if;
 if g.phase<>'lobby' then raise exception 'This game has started. Rejoin with the original browser or recovery key.'; end if;
 if p_name is null or length(trim(p_name)) not between 2 and 24 then raise exception 'Use a name with 2–24 characters.'; end if;
 if (select count(*) from players where game_id=g.id)>=10 then raise exception 'Room is full (10 players maximum).'; end if;
 if exists(select 1 from players where game_id=g.id and lower(name)=lower(trim(p_name))) then raise exception 'That name is taken in this room.'; end if;
 insert into players(game_id,secret,name) values(g.id,sid,trim(p_name));
 update players set ready=false where game_id=g.id;
 update games set updated_at=now() where id=g.id;
 return g.code;
end $$;

-- One consistent, sanitized snapshot. No credentials or another player's hand ever leave SQL.
create function public.avalon_state(p_code text) returns jsonb language plpgsql security definer set search_path=pg_catalog,avalon_private,pg_temp as $$
declare g games; me players; hand jsonb; roster jsonb; prs jsonb; qs jsonb;
begin
 select * into g from games where code=upper(trim(p_code)) for share;
 if not found or g.updated_at<now()-interval '7 days' then raise exception 'Room not found or expired.'; end if;
 select * into me from players where game_id=g.id and secret=avalon_private.identity();
 if not found then raise exception 'You are not in this room. Join from the home page.'; end if;
 if me.last_seen<now()-interval '15 seconds' then update players set last_seen=now() where id=me.id; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'host',host,'ready',ready,'seat',seat,
 'online',last_seen>now()-interval '60 seconds','role',case when g.phase='finished' then role end) order by seat),'[]') into roster from players where game_id=g.id;
 hand:=jsonb_build_object('role',me.role,'alignment',case when me.role is null then null when avalon_private.evil(me.role) then 'evil' else 'good' end,
 'knownEvilIds',coalesce((select jsonb_agg(id order by seat) from players where game_id=g.id and id<>me.id and
 ((me.role='merlin' and avalon_private.evil(role) and role<>'mordred') or
 (me.role in ('assassin','morgana','mordred','minion') and avalon_private.evil(role) and role<>'oberon'))),'[]'),
 'seenAsMerlinIds',coalesce((select jsonb_agg(id order by seat) from players where game_id=g.id and me.role='percival' and role in ('merlin','morgana')),'[]'),
 'inspections',coalesce((select jsonb_agg(jsonb_build_object('target',target_id,'alignment',alignment) order by id) from inspections where game_id=g.id and holder_id=me.id),'[]'));
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'quest',p.quest,'leader_id',p.leader_id,'team',p.team,'status',p.status,
 'votes',coalesce((select jsonb_agg(jsonb_build_object('player_id',v.player_id,'card',case when p.status<>'pending' or v.player_id=me.id then v.card end)) from votes v where v.proposal_id=p.id),'[]')) order by p.number),'[]') into prs from proposals p where p.game_id=g.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'number',q.number,'team',q.team,'result',q.result,'fails',q.fails,
 'submitted', (select count(*) from cards where quest_id=q.id),
 'my_card', (select card from cards where quest_id=q.id and player_id=me.id)) order by q.number),'[]') into qs from quests q where q.game_id=g.id;
 return jsonb_build_object('game',to_jsonb(g),'me',me.id,'players',roster,'hand',hand,'proposals',prs,'quests',qs,
 'can_claim_host',not exists(select 1 from players where game_id=g.id and host and last_seen>now()-interval '90 seconds'),
 'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from (select id,player_id,name,body,created_at from messages where game_id=g.id order by id desc limit 100)m),'[]'));
end $$;

-- All mutations take the same room lock. The last submission resolves the phase atomically.
create function public.avalon_action(p_code text,p_round uuid,p_action text,p_payload jsonb default '{}') returns void
language plpgsql security definer set search_path=pg_catalog,avalon_private,pg_temp as $$
declare g games; me players; pr proposals; q quests; n int; ev int; good_n int; roles text[]; ids uuid[]; i int;
 target uuid; team uuid[]; opts jsonb; chosen int; total int; yes_n int; fails_n int; wins int; losses int; value text; new_host uuid;
begin
 select * into g from games where code=upper(trim(p_code)) for update;
 if not found or g.updated_at<now()-interval '7 days' then raise exception 'Room not found or expired.'; end if;
 select * into me from players where game_id=g.id and secret=avalon_private.identity();
 if not found then raise exception 'You are not in this room.'; end if;
 if p_round is distinct from g.round_id then raise exception 'A new game has started. Your screen is refreshing.'; end if;
 select count(*) into n from players where game_id=g.id;
 update players set last_seen=now() where id=me.id;
 update games set updated_at=now() where id=g.id;
 if p_action='chat' then
 value:=trim(p_payload->>'body');
 if value is null or length(value) not between 1 and 500 then raise exception 'Messages must be 1–500 characters.'; end if;
 if exists(select 1 from messages where game_id=g.id and player_id=me.id and created_at>clock_timestamp()-interval '1 second') then raise exception 'Please wait a second before sending another message.'; end if;
 insert into messages(game_id,player_id,name,body) values(g.id,me.id,me.name,value); return;
 elsif p_action='claim_host' then
 if exists(select 1 from players where game_id=g.id and host and last_seen>now()-interval '90 seconds') then raise exception 'The host is still connected.'; end if;
 update players set host=false where game_id=g.id;
 update players set host=true where id=me.id; return;
 elsif p_action='transfer_host' then
 if not me.host then raise exception 'Only the host can transfer hosting.'; end if;
 target:=(p_payload->>'target')::uuid;
 if not exists(select 1 from players where id=target and game_id=g.id) then raise exception 'Choose a player in this room.'; end if;
 update players set host=false where game_id=g.id;
 update players set host=true where id=target; return;
 elsif p_action in ('leave','kick') then
 if g.phase not in ('lobby','finished') then raise exception 'Finish or abandon the current game before changing the roster.'; end if;
 target:=case when p_action='leave' then me.id else (p_payload->>'target')::uuid end;
 if p_action='kick' and (not me.host or target=me.id) then raise exception 'Only the host can remove another player.'; end if;
 if not exists(select 1 from players where id=target and game_id=g.id) then raise exception 'Player not found.'; end if;
 if exists(select 1 from players where id=target and host) then
 select id into new_host from players where game_id=g.id and id<>target order by seat limit 1;
 end if;
 delete from players where id=target;
 if new_host is not null then update players set host=true where id=new_host; end if;
 update players set ready=false where game_id=g.id;
 if not exists(select 1 from players where game_id=g.id) then delete from games where id=g.id; end if;
 return;
 elsif p_action in ('rematch','abort') then
 if not me.host then raise exception 'Only the host can return everyone to the lobby.'; end if;
 if p_action='rematch' and g.phase<>'finished' then raise exception 'The game has not finished.'; end if;
 if p_action='abort' and g.phase in ('lobby','finished') then raise exception 'There is no active game to abandon.'; end if;
 delete from proposals where game_id=g.id; delete from quests where game_id=g.id; delete from inspections where game_id=g.id; delete from messages where game_id=g.id;
 update players set role=null,ready=false where game_id=g.id;
 update games set round_id=gen_random_uuid(),phase='lobby',quest=1,rejections=0,leader_id=null,lady_id=null,lady_used='{}',winner=null,reason=null,assassin_target=null where id=g.id; return;
 elsif p_action='options' then
 if not me.host or g.phase<>'lobby' then raise exception 'Only the host can configure the lobby.'; end if;
 opts:=p_payload->'options';
 if opts is null or jsonb_typeof(opts)<>'object' then raise exception 'Invalid options.'; end if;
 if exists(select 1 from jsonb_each(opts) e where e.key not in ('percival','morgana','mordred','oberon','lady','targeting') or jsonb_typeof(e.value)<>'boolean') then raise exception 'Invalid options.'; end if;
 update games set options=options||opts where id=g.id; update players set ready=false where game_id=g.id; return;
 elsif p_action='ready' then
 if g.phase<>'lobby' then raise exception 'The game has already started.'; end if;
 update players set ready=coalesce((p_payload->>'ready')::boolean,false) where id=me.id; return;
 elsif p_action='start' then
 if not me.host or g.phase<>'lobby' then raise exception 'Only the host can start from the lobby.'; end if;
 if n not between 5 and 10 then raise exception 'Avalon requires 5–10 players.'; end if;
 if exists(select 1 from players where game_id=g.id and (not ready or last_seen<now()-interval '60 seconds')) then raise exception 'Everyone must be connected and ready.'; end if;
 ev:=case when n<=6 then 2 when n<=9 then 3 else 4 end; good_n:=n-ev;
 roles:=array['merlin']; if (g.options->>'percival')::boolean then roles:=array_append(roles,'percival'); end if;
 while cardinality(roles)<good_n loop roles:=array_append(roles,'loyal_servant'); end loop;
 roles:=array_append(roles,'assassin');
 foreach value in array array['morgana','mordred','oberon'] loop
 if (g.options->>value)::boolean then roles:=array_append(roles,value); end if; end loop;
 if cardinality(roles)>n then raise exception 'Too many evil roles selected for this player count.'; end if;
 if n=5 and (g.options->>'percival')::boolean and not ((g.options->>'morgana')::boolean or (g.options->>'mordred')::boolean) then raise exception 'At 5 players, Percival requires Morgana or Mordred.'; end if;
 while cardinality(roles)<n loop roles:=array_append(roles,'minion'); end loop;
 select array_agg(id order by gen_random_uuid()) into ids from players where game_id=g.id;
 for i in 1..n loop update players set role=roles[i] where id=ids[i]; end loop;
 select id into target from players where game_id=g.id order by gen_random_uuid() limit 1;
 select id into new_host from players where game_id=g.id order by (seat >= (select seat from players where id=target)),seat desc limit 1;
 update games set phase='team',leader_id=target,lady_id=case when (g.options->>'lady')::boolean then new_host end where id=g.id; return;
 elsif p_action='propose' then
 if g.phase<>'team' or g.leader_id<>me.id then raise exception 'Wait for your turn to propose a team.'; end if;
 if (p_payload->>'turn')::integer is distinct from (select count(*)::integer from proposals where game_id=g.id) then raise exception 'This turn has already changed.'; end if;
 chosen:=coalesce((p_payload->>'quest')::int,g.quest);
 if chosen not between 1 and 5 or (not (g.options->>'targeting')::boolean and chosen<>g.quest) or exists(select 1 from quests where game_id=g.id and number=chosen) then raise exception 'Choose an available quest.'; end if;
 if (g.options->>'targeting')::boolean and chosen=5 and (select count(*) from quests where game_id=g.id and result='success')<2 then raise exception 'Quest 5 requires two successful quests first.'; end if;
 select array_agg(x::uuid) into team from jsonb_array_elements_text(p_payload->'team')x;
 if coalesce(cardinality(team),0)<>avalon_private.team_size(n,chosen) or (select count(distinct x) from unnest(team)x)<>cardinality(team) or exists(select 1 from unnest(team)x where not exists(select 1 from players where id=x and game_id=g.id)) then raise exception 'Choose the required number of different players.'; end if;
 insert into proposals(game_id,number,quest,leader_id,team) values(g.id,(select count(*)+1 from proposals where game_id=g.id),chosen,me.id,team);
 update games set phase='vote',quest=chosen where id=g.id; return;
 elsif p_action='vote' then
 select * into pr from proposals where id=(p_payload->>'proposal')::uuid and game_id=g.id;
 if not found then raise exception 'Proposal not found.'; end if;
 value:=p_payload->>'card'; if value is null or value not in ('approve','reject') then raise exception 'Invalid vote.'; end if;
 if exists(select 1 from votes where proposal_id=pr.id and player_id=me.id) then return; end if;
 if g.phase<>'vote' or pr.status<>'pending' then raise exception 'Voting has closed.'; end if;
 insert into votes values(pr.id,me.id,value);
 select count(*),count(*) filter(where card='approve') into total,yes_n from votes where proposal_id=pr.id;
 if total=n then
 if yes_n>n/2 then
 update proposals set status='approved' where id=pr.id;
 insert into quests(game_id,number,team) values(g.id,pr.quest,pr.team);
 update games set phase='quest',rejections=0 where id=g.id;
 else
 update proposals set status='rejected' where id=pr.id;
 update games set rejections=rejections+1,leader_id=avalon_private.next_leader(g.id,g.leader_id),
 phase=case when rejections=4 then 'finished' else 'team' end,
 winner=case when rejections=4 then 'evil' end,reason=case when rejections=4 then 'Five teams were rejected in a row.' end where id=g.id;
 end if; end if; return;
 elsif p_action='card' then
 select * into q from quests where id=(p_payload->>'quest_id')::uuid and game_id=g.id;
 if not found then raise exception 'Quest not found.'; end if;
 if not me.id=any(q.team) then raise exception 'You are not on this quest team.'; end if;
 value:=p_payload->>'card'; if value is null or value not in ('success','fail') then raise exception 'Invalid quest card.'; end if;
 if value='fail' and not avalon_private.evil(me.role) then raise exception 'Good players must play Success.'; end if;
 if exists(select 1 from cards where quest_id=q.id and player_id=me.id) then return; end if;
 if g.phase<>'quest' or q.result is not null or q.number<>g.quest then raise exception 'Quest is closed.'; end if;
 insert into cards values(q.id,me.id,value);
 select count(*),count(*) filter(where card='fail') into total,fails_n from cards where quest_id=q.id;
 if total=cardinality(q.team) then
 update quests set fails=fails_n,result=case when fails_n>=case when n>=7 and q.number=4 then 2 else 1 end then 'fail' else 'success' end where id=q.id;
 select count(*) filter(where result='success'),count(*) filter(where result='fail'),count(*) into wins,losses,total from quests where game_id=g.id;
 if losses=3 then update games set phase='finished',winner='evil',reason='Three quests failed.' where id=g.id;
 elsif wins=3 then update games set phase='assassination' where id=g.id;
 else
 select s into chosen from generate_series(1,5)s where not exists(select 1 from quests where game_id=g.id and number=s) order by s limit 1;
 update games set phase=case when (options->>'lady')::boolean and total between 2 and 4 then 'lady' else 'team' end,
 quest=chosen,leader_id=avalon_private.next_leader(g.id,g.leader_id) where id=g.id;
 end if; end if; return;
 elsif p_action='inspect' then
 if g.phase<>'lady' or g.lady_id<>me.id then raise exception 'Only the Lady holder can inspect now.'; end if;
 target:=(p_payload->>'target')::uuid;
 if target=me.id or target=any(g.lady_used) or not exists(select 1 from players where id=target and game_id=g.id) then raise exception 'Choose someone who has not used the Lady.'; end if;
 insert into inspections(game_id,holder_id,target_id,alignment) select g.id,me.id,target,case when avalon_private.evil(role) then 'evil' else 'good' end from players where id=target;
 update games set phase='team',lady_id=target,lady_used=array_append(lady_used,me.id) where id=g.id; return;
 elsif p_action='assassinate' then
 if g.phase<>'assassination' or me.role<>'assassin' then raise exception 'Only the Assassin can make the final guess.'; end if;
 target:=(p_payload->>'target')::uuid;
 if not exists(select 1 from players where id=target and game_id=g.id and id<>me.id) then raise exception 'Choose another player as Merlin.'; end if;
 select role into value from players where id=target;
 update games set phase='finished',assassin_target=target,winner=case when value='merlin' then 'evil' else 'good' end,
 reason=case when value='merlin' then 'The Assassin identified Merlin.' else 'Three quests succeeded and Merlin survived.' end where id=g.id; return;
 end if;
 raise exception 'Unknown game action.';
end $$;
-- Explicit allowlist, including revoking the default PUBLIC execute privilege.
revoke all on all functions in schema avalon_private from public,anon,authenticated;
revoke all on function public.avalon_create(text),public.avalon_join(text,text),public.avalon_state(text),public.avalon_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.avalon_create(text),public.avalon_join(text,text),public.avalon_state(text),public.avalon_action(text,uuid,text,jsonb) to anon,authenticated;
-- The client polls authorized snapshots every two seconds. No private tables are published.
notify pgrst, 'reload schema';
commit;
