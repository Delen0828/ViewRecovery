insert into public.studies(id,name,protocol_version,consent_version,tasks,active)
values ('00000000-0000-0000-0000-000000000001','Local acceptance fixture','legacy-2026-10-04','fixture-only',array['Motion','Orientation','Centrality','Bar'],false)
on conflict(id) do nothing;
-- Activate only in a staging fixture with approved consent and explicit enrollments.
