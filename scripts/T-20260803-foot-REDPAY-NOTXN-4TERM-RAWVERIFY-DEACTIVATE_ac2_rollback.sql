-- ROLLBACK for AC-2 deactivation (restore active=true + original source/updated_at)
-- generated 2026-08-03 (dev-foot) 
UPDATE public.redpay_terminal_registry SET active=true, source=$$redpay_foot_terminal_registry.md §2 (authoritative, DA read-only prod probe, last_verified 2026-07-11)$$, updated_at='2026-07-17 17:36:49.945489+00' WHERE id='fd593131-154e-4ade-a4d4-cf559c0b99e9'; -- tid 1047479148
UPDATE public.redpay_terminal_registry SET active=true, source=$$redpay_foot_terminal_registry.md §2 (authoritative, DA read-only prod probe, last_verified 2026-07-11)$$, updated_at='2026-07-17 17:36:49.945489+00' WHERE id='4140ab3f-4b17-40d5-b81a-61dfb54ca174'; -- tid 1047479155
UPDATE public.redpay_terminal_registry SET active=true, source=$$redpay_foot_terminal_registry.md §2 (authoritative, DA read-only prod probe, last_verified 2026-07-11)$$, updated_at='2026-07-17 17:36:49.945489+00' WHERE id='75735b93-1ab6-425f-9453-8124b56e902f'; -- tid 1047479476
