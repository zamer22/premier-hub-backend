alter table if exists premier.live_lineups
  add column if not exists player_grid text;
