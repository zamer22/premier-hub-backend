create table if not exists premier.usuario_equipamiento (
  id_usuario integer primary key references premier.usuario(id_usuario) on delete cascade,
  marco_inventario_id integer null references premier.inventario_producto(id) on delete set null,
  titulo_inventario_id integer null references premier.inventario_producto(id) on delete set null,
  banner_inventario_id integer null references premier.inventario_producto(id) on delete set null,
  trofeo_inventario_id integer null references premier.inventario_producto(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists usuario_equipamiento_marco_idx
  on premier.usuario_equipamiento (marco_inventario_id);

create index if not exists usuario_equipamiento_titulo_idx
  on premier.usuario_equipamiento (titulo_inventario_id);

create index if not exists usuario_equipamiento_banner_idx
  on premier.usuario_equipamiento (banner_inventario_id);

create index if not exists usuario_equipamiento_trofeo_idx
  on premier.usuario_equipamiento (trofeo_inventario_id);
