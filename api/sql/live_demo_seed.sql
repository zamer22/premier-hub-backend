-- Seed opcional para restaurar el partido demo que se muestra cuando no hay partidos live reales.
-- Ejecutar despues de api/sql/live_feature_schema.sql.

delete from premier.live_activation_claims where fixture_id = 990000001;
delete from premier.live_chat_messages where fixture_id = 990000001;
delete from premier.live_activations where fixture_id = 990000001;
delete from premier.live_h2h where fixture_id = 990000001;
delete from premier.live_events where fixture_id = 990000001;
delete from premier.live_stat_snapshots where fixture_id = 990000001;
delete from premier.live_stats where fixture_id = 990000001;
delete from premier.live_lineups where fixture_id = 990000001;
delete from premier.live_matches where id = 990000001;

insert into premier.live_matches (
  id, league, minute, minute_number, stadium, status,
  home_team_id, home_name, home_logo, home_score,
  away_team_id, away_name, away_logo, away_score,
  source, is_demo, is_visible, sort_order, updated_at
) values (
  990000001, 'Premier League', '0''', 0, 'Emirates Stadium', 'Not Started',
  42, 'Arsenal', 'https://media.api-sports.io/football/teams/42.png', 0,
  40, 'Liverpool', 'https://media.api-sports.io/football/teams/40.png', 0,
  'manual', true, true, 100, now()
);

insert into premier.live_lineups
  (fixture_id, team, player_number, player_name, player_grid, player_position, is_sub, sort_order)
values
  (990000001, 'home', 22, 'David Raya', '1:1', 'GK', false, 1),
  (990000001, 'home', 4, 'Ben White', '2:1', 'RB', false, 2),
  (990000001, 'home', 2, 'William Saliba', '2:2', 'CB', false, 3),
  (990000001, 'home', 6, 'Gabriel Magalhaes', '2:3', 'CB', false, 4),
  (990000001, 'home', 12, 'Jurrien Timber', '2:4', 'LB', false, 5),
  (990000001, 'home', 8, 'Martin Odegaard', '3:1', 'CM', false, 6),
  (990000001, 'home', 41, 'Declan Rice', '3:2', 'DM', false, 7),
  (990000001, 'home', 29, 'Kai Havertz', '3:3', 'CM', false, 8),
  (990000001, 'home', 7, 'Bukayo Saka', '4:1', 'RW', false, 9),
  (990000001, 'home', 11, 'Gabriel Martinelli', '4:2', 'LW', false, 10),
  (990000001, 'home', 9, 'Gabriel Jesus', '4:3', 'ST', false, 11),
  (990000001, 'home', 1, 'Aaron Ramsdale', null, 'GK', true, 12),
  (990000001, 'home', 19, 'Leandro Trossard', null, 'LW', true, 13),
  (990000001, 'home', 5, 'Thomas Partey', null, 'DM', true, 14),
  (990000001, 'home', 14, 'Eddie Nketiah', null, 'ST', true, 15),
  (990000001, 'home', 18, 'Takehiro Tomiyasu', null, 'DF', true, 16),
  (990000001, 'away', 1, 'Alisson Becker', '1:1', 'GK', false, 1),
  (990000001, 'away', 66, 'Trent Alexander-Arnold', '2:1', 'RB', false, 2),
  (990000001, 'away', 5, 'Ibrahima Konate', '2:2', 'CB', false, 3),
  (990000001, 'away', 4, 'Virgil van Dijk', '2:3', 'CB', false, 4),
  (990000001, 'away', 26, 'Andrew Robertson', '2:4', 'LB', false, 5),
  (990000001, 'away', 10, 'Alexis Mac Allister', '3:1', 'CM', false, 6),
  (990000001, 'away', 8, 'Dominik Szoboszlai', '3:2', 'CM', false, 7),
  (990000001, 'away', 17, 'Curtis Jones', '3:3', 'CM', false, 8),
  (990000001, 'away', 11, 'Mohamed Salah', '4:1', 'RW', false, 9),
  (990000001, 'away', 7, 'Luis Diaz', '4:2', 'LW', false, 10),
  (990000001, 'away', 9, 'Darwin Nunez', '4:3', 'ST', false, 11),
  (990000001, 'away', 62, 'Caoimhin Kelleher', null, 'GK', true, 12),
  (990000001, 'away', 20, 'Diogo Jota', null, 'FW', true, 13),
  (990000001, 'away', 18, 'Cody Gakpo', null, 'LW', true, 14),
  (990000001, 'away', 3, 'Wataru Endo', null, 'DM', true, 15),
  (990000001, 'away', 21, 'Kostas Tsimikas', null, 'LB', true, 16);

insert into premier.live_stats (fixture_id, label, home_value, away_value)
values
  (990000001, 'Shots on Goal', '0', '0'),
  (990000001, 'Total Shots', '0', '0'),
  (990000001, 'Ball Possession', '50%', '50%'),
  (990000001, 'Corner Kicks', '0', '0'),
  (990000001, 'Fouls', '0', '0'),
  (990000001, 'Yellow Cards', '0', '0'),
  (990000001, 'Total passes', '0', '0'),
  (990000001, 'Passes accurate', '0', '0');

insert into premier.live_events
  (fixture_id, event_order, minute, extra, display_minute, team, team_name, player, assist, type, detail, source)
values
  (990000001, 1, 8, null, '8''', 'home', 'Arsenal', 'Bukayo Saka', 'Martin Odegaard', 'Chance', 'Shot on target', 'manual'),
  (990000001, 2, 17, null, '17''', 'away', 'Liverpool', 'Mohamed Salah', 'Darwin Nunez', 'Goal', 'Normal Goal', 'manual'),
  (990000001, 3, 28, null, '28''', 'home', 'Arsenal', 'Declan Rice', null, 'Card', 'Yellow Card', 'manual'),
  (990000001, 4, 41, null, '41''', 'home', 'Arsenal', 'Gabriel Jesus', 'Bukayo Saka', 'Goal', 'Normal Goal', 'manual'),
  (990000001, 5, 45, null, 'HT', null, null, null, null, 'Half', 'Half Time', 'manual'),
  (990000001, 6, 58, null, '58''', 'home', 'Arsenal', 'Leandro Trossard', 'Gabriel Martinelli', 'subst', 'Substitution', 'manual'),
  (990000001, 7, 63, null, '63''', 'away', 'Liverpool', 'Ibrahima Konate', null, 'Card', 'Yellow Card', 'manual'),
  (990000001, 8, 67, null, '67''', 'home', 'Arsenal', 'Bukayo Saka', 'Leandro Trossard', 'Goal', 'Normal Goal', 'manual'),
  (990000001, 9, 74, null, '74''', 'away', 'Liverpool', 'Diogo Jota', 'Darwin Nunez', 'subst', 'Substitution', 'manual'),
  (990000001, 10, 83, null, '83''', 'away', 'Liverpool', 'Diogo Jota', 'Trent Alexander-Arnold', 'Goal', 'Normal Goal', 'manual');

insert into premier.live_stat_snapshots (fixture_id, minute, label, home_value, away_value)
values
  (990000001, 0, 'Shots on Goal', '0', '0'),
  (990000001, 0, 'Total Shots', '0', '0'),
  (990000001, 0, 'Ball Possession', '50%', '50%'),
  (990000001, 0, 'Corner Kicks', '0', '0'),
  (990000001, 0, 'Fouls', '0', '0'),
  (990000001, 0, 'Yellow Cards', '0', '0'),
  (990000001, 0, 'Total passes', '0', '0'),
  (990000001, 0, 'Passes accurate', '0', '0'),
  (990000001, 17, 'Shots on Goal', '1', '2'),
  (990000001, 17, 'Total Shots', '3', '4'),
  (990000001, 17, 'Ball Possession', '48%', '52%'),
  (990000001, 17, 'Corner Kicks', '1', '1'),
  (990000001, 17, 'Fouls', '2', '1'),
  (990000001, 17, 'Yellow Cards', '0', '0'),
  (990000001, 17, 'Total passes', '92', '101'),
  (990000001, 17, 'Passes accurate', '78', '88'),
  (990000001, 41, 'Shots on Goal', '4', '3'),
  (990000001, 41, 'Total Shots', '8', '7'),
  (990000001, 41, 'Ball Possession', '52%', '48%'),
  (990000001, 41, 'Corner Kicks', '3', '2'),
  (990000001, 41, 'Fouls', '5', '4'),
  (990000001, 41, 'Yellow Cards', '1', '0'),
  (990000001, 41, 'Total passes', '234', '218'),
  (990000001, 41, 'Passes accurate', '203', '188'),
  (990000001, 67, 'Shots on Goal', '6', '4'),
  (990000001, 67, 'Total Shots', '14', '10'),
  (990000001, 67, 'Ball Possession', '54%', '46%'),
  (990000001, 67, 'Corner Kicks', '5', '3'),
  (990000001, 67, 'Fouls', '8', '11'),
  (990000001, 67, 'Yellow Cards', '1', '2'),
  (990000001, 67, 'Total passes', '412', '351'),
  (990000001, 67, 'Passes accurate', '359', '298'),
  (990000001, 90, 'Shots on Goal', '7', '6'),
  (990000001, 90, 'Total Shots', '16', '14'),
  (990000001, 90, 'Ball Possession', '51%', '49%'),
  (990000001, 90, 'Corner Kicks', '6', '5'),
  (990000001, 90, 'Fouls', '10', '13'),
  (990000001, 90, 'Yellow Cards', '1', '2'),
  (990000001, 90, 'Total passes', '563', '529'),
  (990000001, 90, 'Passes accurate', '489', '454');

insert into premier.live_activations
  (id, fixture_id, type, title, description, payload, reward_points, starts_at_minute, expires_at_minute, status)
values
  (9901001, 990000001, 'poll', 'Quien llega arriba al medio tiempo?', 'Elige antes del minuto 20 y gana si aciertas.', '{"options":[{"id":"home","label":"Arsenal"},{"id":"away","label":"Liverpool"},{"id":"draw","label":"Empate"}],"correct_option":"draw"}', 300, 10, 20, 'active'),
  (9901002, 990000001, 'drop', 'Gol en vivo: estabas aqui', 'Claim del gol de Gabriel Jesus.', '{"event_minute":41,"event_type":"goal"}', 500, 41, 47, 'active'),
  (9901003, 990000001, 'poll', 'Habra otro gol antes del 75''?', 'Predice el siguiente tramo del partido.', '{"options":[{"id":"yes","label":"Si"},{"id":"no","label":"No"}],"correct_option":"yes"}', 300, 52, 61, 'active'),
  (9901004, 990000001, 'drop', 'Drop relampago por gol', 'Saka acaba de mover el marcador.', '{"event_minute":67,"event_type":"goal"}', 500, 67, 73, 'active'),
  (9901005, 990000001, 'poll', 'Quien controla el cierre?', 'Vota por el equipo con mejor momento.', '{"options":[{"id":"home","label":"Arsenal"},{"id":"away","label":"Liverpool"}]}', 100, 78, 86, 'active');

insert into premier.live_h2h
  (fixture_id, related_fixture_id, match_date, league, home_team_id, home_name, home_logo, home_goals, away_team_id, away_name, away_logo, away_goals)
values
  (990000001, 1208021, '2025-05-11T15:30:00+00:00', 'Premier League', 40, 'Liverpool', 'https://media.api-sports.io/football/teams/40.png', 2, 42, 'Arsenal', 'https://media.api-sports.io/football/teams/42.png', 2),
  (990000001, 1207943, '2024-10-27T16:30:00+00:00', 'Premier League', 42, 'Arsenal', 'https://media.api-sports.io/football/teams/42.png', 2, 40, 'Liverpool', 'https://media.api-sports.io/football/teams/40.png', 2),
  (990000001, 1035277, '2024-02-04T16:30:00+00:00', 'Premier League', 42, 'Arsenal', 'https://media.api-sports.io/football/teams/42.png', 3, 40, 'Liverpool', 'https://media.api-sports.io/football/teams/40.png', 1);

insert into premier.live_stat_labels (api_label, display_label, sort_order, is_enabled)
values
  ('Shots on Goal', 'Tiros a puerta', 10, true),
  ('Shots off Goal', 'Tiros fuera', 20, true),
  ('Total Shots', 'Tiros totales', 30, true),
  ('Blocked Shots', 'Tiros bloqueados', 40, true),
  ('Shots insidebox', 'Tiros dentro del area', 50, true),
  ('Shots outsidebox', 'Tiros fuera del area', 60, true),
  ('Fouls', 'Faltas', 70, true),
  ('Corner Kicks', 'Tiros de esquina', 80, true),
  ('Offsides', 'Fueras de juego', 90, true),
  ('Ball Possession', 'Posesion del balon', 100, true),
  ('Yellow Cards', 'Tarjetas amarillas', 110, true),
  ('Red Cards', 'Tarjetas rojas', 120, true),
  ('Goalkeeper Saves', 'Atajadas', 130, true),
  ('Total passes', 'Pases totales', 140, true),
  ('Passes accurate', 'Pases precisos', 150, true),
  ('Passes %', 'Precision de pases', 160, true),
  ('expected_goals', 'Goles esperados (xG)', 170, true),
  ('goals_prevented', 'Goles evitados', 180, true)
on conflict (api_label) do update set
  display_label = excluded.display_label,
  sort_order = excluded.sort_order,
  is_enabled = excluded.is_enabled;

insert into premier.live_chat_emotes (token, label, src, kind, sort_order, is_enabled)
values
  (':pog:', 'KomodoHype', 'https://static-cdn.jtvnw.net/emoticons/v2/81274/default/dark/2.0', 'sticker', 10, true),
  (':kappa:', 'Kappa', 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', 'emote', 20, true),
  (':lul:', 'LUL', 'https://static-cdn.jtvnw.net/emoticons/v2/425618/default/dark/2.0', 'emote', 30, true),
  (':hey:', 'HeyGuys', 'https://static-cdn.jtvnw.net/emoticons/v2/30259/default/dark/2.0', 'emote', 40, true),
  (':good:', 'SeemsGood', 'https://static-cdn.jtvnw.net/emoticons/v2/64138/default/dark/2.0', 'emote', 50, true),
  (':sleep:', 'ResidentSleeper', 'https://static-cdn.jtvnw.net/emoticons/v2/245/default/dark/2.0', 'emote', 60, true),
  (':cry:', 'BibleThump', 'https://static-cdn.jtvnw.net/emoticons/v2/86/default/dark/2.0', 'emote', 70, true),
  (':rage:', 'SwiftRage', 'https://static-cdn.jtvnw.net/emoticons/v2/34/default/dark/2.0', 'sticker', 80, true)
on conflict (token) do update set
  label = excluded.label,
  src = excluded.src,
  kind = excluded.kind,
  sort_order = excluded.sort_order,
  is_enabled = excluded.is_enabled;

insert into premier.live_runtime_settings (key, value)
values
  ('demo_speed_ms', '2000'::jsonb),
  ('details_refresh_ms', '60000'::jsonb),
  ('events_refresh_ms', '15000'::jsonb),
  ('lineups_refresh_ms', '180000'::jsonb),
  ('chat_refresh_ms', '5000'::jsonb),
  ('live_summary_refresh_ms', '15000'::jsonb)
on conflict (key) do update set
  value = excluded.value,
  updated_at = now();
