alter table public.broadcasts add column link_click_count integer;
alter table public.broadcast_recipients add column first_link_click_at timestamptz;
create table public.broadcast_button_links (
  token uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.broadcast_recipients(id) on delete cascade,
  destination text not null check (destination like 'https://%')
);
create index broadcast_button_links_recipient on public.broadcast_button_links(recipient_id);
alter table public.broadcast_button_links enable row level security;
revoke all on public.broadcast_button_links from anon, authenticated;
grant select, insert on public.broadcast_button_links to service_role;

create function public.follow_broadcast_button(p_token uuid) returns text
language plpgsql security invoker set search_path = public as $$
declare link broadcast_button_links; campaign uuid;
begin
  select * into link from broadcast_button_links where token = p_token;
  if not found then return null; end if;
  update broadcast_recipients set first_link_click_at = now()
    where id = link.recipient_id and first_link_click_at is null returning broadcast_id into campaign;
  if campaign is not null then
    update broadcasts set link_click_count = coalesce(link_click_count, 0) + 1 where id = campaign;
  end if;
  return link.destination;
end;
$$;
revoke all on function public.follow_broadcast_button(uuid) from public, anon, authenticated;
grant execute on function public.follow_broadcast_button(uuid) to service_role;
