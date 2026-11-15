-- Starter data for this app's database, kept by ThatCode: the rows each
-- approved change inserted, in the order they were applied. Supabase runs
-- this file after the migrations on `supabase db reset`.

-- thatcode change cmwh6t39900130109jyi49en6: Add Ada Park, Ben Ortiz and Cara Singh from your file as contacts, visible to approved team members only (applied 2026-11-15 02:00:05 UTC)
insert into public.contacts (name, company, email, phone) values
('Ada Park','Lumen Co','ada@example.com','555-0101'),
('Ben Ortiz','Kite Labs','ben@example.com','555-0102'),
('Cara Singh','Mesa Foods','cara@example.com','555-0103');
