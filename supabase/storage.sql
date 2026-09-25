-- Buckets.
--
-- The deposit-screenshots bucket is deliberately not created here any more:
-- the manual transfer rail it served has been removed. The bucket is left in
-- place on deployments that already have one, because it still holds the
-- payment records of deposits taken while that rail was open.

-- Team crests are public: they are rendered on the board for every visitor, so
-- signing a URL per crest per page view would be waste. The upload route is
-- admin-only and names the file itself, so nothing private lands here.
insert into storage.buckets (id, name, public)
values ('team-crests', 'team-crests', true)
on conflict (id) do nothing;
