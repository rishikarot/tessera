-- Tessera core schema: tenants, user-defined modules and fields, records as JSONB.

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'creator', 'editor', 'commenter', 'readOnly')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- An "app" is a set of related modules (Airtable calls this a base).
create table apps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  icon text not null default 'grid',
  color text not null default 'blue',
  description text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index apps_workspace_idx on apps (workspace_id) where deleted_at is null;

-- A module is a user-defined table.
create table modules (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  name text not null,
  description text,
  primary_field_id uuid,
  position integer not null default 0,
  next_auto_number integer not null default 1,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index modules_app_idx on modules (app_id) where deleted_at is null;

create table fields (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules(id) on delete cascade,
  name text not null,
  type text not null,
  description text,
  config jsonb not null default '{}',
  position integer not null default 0,
  required boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index fields_module_idx on fields (module_id) where deleted_at is null;
create unique index fields_name_unique on fields (module_id, lower(name)) where deleted_at is null;

alter table modules
  add constraint modules_primary_field_fk foreign key (primary_field_id) references fields(id) deferrable initially deferred;

-- One row per record; stored cell values keyed by field id.
create table records (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules(id) on delete cascade,
  values jsonb not null default '{}',
  auto_number integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  deleted_at timestamptz
);
create index records_module_idx on records (module_id, auto_number) where deleted_at is null;
create index records_values_idx on records using gin (values jsonb_path_ops);

-- Linked-record edges, stored in both directions so each side reads cheaply.
create table record_links (
  field_id uuid not null references fields(id) on delete cascade,
  from_record uuid not null references records(id) on delete cascade,
  to_record uuid not null references records(id) on delete cascade,
  position integer not null default 0,
  primary key (field_id, from_record, to_record)
);
create index record_links_to_idx on record_links (to_record);

create table views (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules(id) on delete cascade,
  name text not null,
  type text not null,
  visibility text not null default 'collaborative' check (visibility in ('collaborative', 'personal', 'locked')),
  owner_id uuid references users(id) on delete cascade,
  config jsonb not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index views_module_idx on views (module_id);

create table comments (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references records(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index comments_record_idx on comments (record_id, created_at);

create table record_history (
  id bigserial primary key,
  record_id uuid not null references records(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  action text not null check (action in ('create', 'update', 'delete', 'restore')),
  changes jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index record_history_record_idx on record_history (record_id, id);
