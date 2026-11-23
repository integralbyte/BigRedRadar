create table if not exists academic_plans (
  user_id bigint primary key references users(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
