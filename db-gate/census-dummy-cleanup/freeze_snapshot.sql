-- DA-20260721-foot-TEST-DUMMY-CLEANUP-GATE — FREEZE SNAPSHOT (§2-2 VALUES freeze)
-- Phase-1 census output. Execution keyed on THESE fixed ids only (not on LIKE re-scan).
-- READ-ONLY here. Any Phase-2 DELETE gated on: DA 2차 apply-GO + freeze re-verify abort (§2-3)
--   + supervisor DB-GATE (4-field + dry-run no-persistence) + off-git archive (§4-B/§1 per DA C4).
-- Full-fidelity (incl phone PII): OFF-GIT ~/.config/medibuilder-secrets/backfill-snapshots/foot-test-dummy-cleanup-20260721/

-- FREEZE: customers (9)
-- id                                   | name                  | chart_number | created_kst
-- d7be9306-524b-4d40-8e25-a455a632bbf8 | 단계이동_1783967359323 | F-4710 | 2026-07-14 03:29
-- 44f4f14c-be85-4ef3-bc93-56a883447b67 | 단계이동_1784051960090 | F-4765 | 2026-07-15 02:59
-- b23a2267-1aff-438a-bf7d-f87838a4e870 | 단계이동_1784138614576 | F-4800 | 2026-07-16 03:03
-- 7c385221-0a48-41be-bd2e-dadb5eedec54 | 단계이동_1784224882250 | F-4835 | 2026-07-17 03:01
-- 47be6e07-25fc-476a-a561-acba2ee6e3c1 | 단계이동_1784311192303 | F-4867 | 2026-07-18 02:59
-- ac0748ea-8c2f-400f-98cd-9436d3f76e3e | 단계이동_1784483430874 | F-4890 | 2026-07-20 02:50
-- 64b2f7f0-0140-4bb8-ba9c-918d87a0f538 | 단계이동_1784573543898 | F-4932 | 2026-07-21 03:52
-- a24f706c-c06e-4668-b259-d4d53c56d13f | 단계이동_1784573557930 | F-4933 | 2026-07-21 03:52
-- 641637ff-a07e-4001-ae35-a5a3255f7319 | 단계이동_1784573572353 | F-4934 | 2026-07-21 03:52

-- FREEZE: check_ins (6) — all customer_id ∈ freeze customers
-- cc1842dc-0ebd-4a7b-9359-ea25f139f453  (cust d7be9306)
-- bf2b0e94-e855-4c32-bc2d-bf73d78eb676  (cust 44f4f14c)
-- dfae725c-7a6b-4409-95c6-bcf4e81e5e41  (cust 7c385221)
-- 0bbbd3b3-0c3d-45b2-afcb-1b5979f3275a  (cust 47be6e07)
-- 39e297aa-8fc3-430f-9131-493a0098df4b  (cust ac0748ea)
-- 14c29c0c-c2fa-4d73-9a9a-e63551f67be9  (cust 64b2f7f0)

-- FREEZE: reservations = 0 (none reference freeze customers)

-- Freeze VALUES (for Phase-2 re-verify + apply keying)
with freeze_customers(id) as (values
  ('d7be9306-524b-4d40-8e25-a455a632bbf8'::uuid),
  ('44f4f14c-be85-4ef3-bc93-56a883447b67'),
  ('b23a2267-1aff-438a-bf7d-f87838a4e870'),
  ('7c385221-0a48-41be-bd2e-dadb5eedec54'),
  ('47be6e07-25fc-476a-a561-acba2ee6e3c1'),
  ('ac0748ea-8c2f-400f-98cd-9436d3f76e3e'),
  ('64b2f7f0-0140-4bb8-ba9c-918d87a0f538'),
  ('a24f706c-c06e-4668-b259-d4d53c56d13f'),
  ('641637ff-a07e-4001-ae35-a5a3255f7319')),
freeze_checkins(id) as (values
  ('cc1842dc-0ebd-4a7b-9359-ea25f139f453'::uuid),
  ('bf2b0e94-e855-4c32-bc2d-bf73d78eb676'),
  ('dfae725c-7a6b-4409-95c6-bcf4e81e5e41'),
  ('0bbbd3b3-0c3d-45b2-afcb-1b5979f3275a'),
  ('39e297aa-8fc3-430f-9131-493a0098df4b'),
  ('14c29c0c-c2fa-4d73-9a9a-e63551f67be9'))
-- §2-3 re-verify guard (Phase-2, ABORT if these drift from census):
--   expect: freeze_customers=9, freeze_checkins=6, status_transitions children=7,
--           payments/service_charges/package_payments/insurance_claims/form_submissions/medical_charts=0
select
  (select count(*) from freeze_customers) as n_customers,   -- expect 9
  (select count(*) from freeze_checkins)  as n_checkins,    -- expect 6
  (select count(*) from status_transitions where check_in_id in (select id from freeze_checkins)) as n_status_transitions, -- expect 7
  (select count(*) from payments where customer_id in (select id from freeze_customers) or check_in_id in (select id from freeze_checkins)) as n_payments, -- expect 0
  (select count(*) from service_charges where customer_id in (select id from freeze_customers) or check_in_id in (select id from freeze_checkins)) as n_service_charges, -- expect 0
  (select count(*) from form_submissions where customer_id in (select id from freeze_customers) or check_in_id in (select id from freeze_checkins)) as n_form_submissions; -- expect 0 (no published-immutable 42501 exposure)
