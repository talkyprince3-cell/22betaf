-- Buckets.
--
-- Deposit screenshots are private: they are a player's payment record, read
-- only by the operator through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('deposit-screenshots', 'deposit-screenshots', false)
on conflict (id) do nothing;
