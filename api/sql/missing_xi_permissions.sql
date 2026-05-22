grant usage on schema premier to service_role;

grant select, insert, update, delete
on table premier.missing_xi_challenges
to service_role;

grant select, insert, update, delete
on table premier.missing_xi_players
to service_role;
