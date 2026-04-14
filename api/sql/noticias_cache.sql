create table if not exists premier.noticias_cache (
  cache_key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

create index if not exists noticias_cache_expires_at_idx
  on premier.noticias_cache (expires_at);
