-- ============================================================================
-- T-20260531-data-JONGNOFOOT-MIGRATE-HFQ-TO-FOOT  ·  AC-7 migration (FORWARD)
-- ----------------------------------------------------------------------------
-- TARGET DB : foot prod  rxlomoozakkjesdqjtvd
-- TARGET CLINIC : jongno-foot  74967aea-a60b-4da3-a0e7-9c997a930bc8
--                 (= "오블리브의원 서울 오리진점")
-- SOURCE DB : HFQ  muvcfrgmxlwtidundlre  (happy-flow-queue)
-- SOURCE CLINIC : jongno-foot  e49b687f-1533-43e9-9814-f5d9d64ba97f
-- ROLLBACK KEY : memo / notes LIKE '%[MIGRATE-HFQ-FOOT-20260531]%'
-- SCOPE        : customers 8 (new only) · check_ins 13 · reservations 0
--
-- *** GATE — DO NOT EXECUTE ***
-- Order (immutable): AC-7 package → supervisor 단독 GO → 대표 confirm → INSERT.
-- INSERT 금지 until supervisor GO AND 대표 confirm are both recorded.
-- This file is a DESIGN artifact. Running it before the gate is a policy breach.
--
-- The 80 testdata dummy band (+821000002901~+821000002980) is EXCLUDED entirely
-- (dummy↔dummy mapping, audit T-20260531-crm-HFQ-FOOT-RESIDUAL-AUDIT §6).
-- reservations: ALL 80 HFQ rows are dummy → 0 migrated.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 1 — customers (8 new; within-source dup '까치2' already collapsed)
--          dedup guard: skip if a jongno-foot customer with same normalized
--          phone already exists in foot prod (defense vs re-run / race).
-- ─────────────────────────────────────────────────────────────────────────
WITH src_cust(hfq_id, name, phone, norm_local, note) AS (
  VALUES
    ('b0bc7f33-3906-4ed7-8a4f-438a489644a8','김와사비','+821056688566','01056688566',''),
    ('35477a81-3e91-414e-b71e-cd22e581566a','김와사비','+821099786634','01099786634',''),
    ('13e4288f-4f09-4611-bec6-72ce6b25da98','김와사비','+821066442622','01066442622',''),
    ('57ac7170-c0ce-4e8c-9cfa-65f56141c17f','까치',    '+821099991111','01099991111','TEST-PATTERN ...99991111 — 사람 육안 확인 필수'),
    ('d7179740-a0ff-4721-aa8e-7c83fc9bd2bf','로오즈',  '+821054757585','01054757585',''),
    ('1b9d2e19-8002-43bc-bfd8-78b6f9150135','로오즈',  '+821065566658','01065566658',''),
    ('c04e4bb0-bf4c-4fdc-92bc-5de60a367311','오구리',  '+821066845621','01066845621',''),
    ('b86ac71a-7389-47c5-9d60-5d50861f31e6','춘향이',  '+821055459722','01055459722','')
)
INSERT INTO customers (clinic_id, name, phone, visit_type, memo, is_simulation)
SELECT '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,
       s.name,
       s.phone,
       'new',                                  -- visit_type 기본값 (HFQ 미보유) — 확인 포인트 ①
       '[MIGRATE-HFQ-FOOT-20260531] src_cust=' || s.hfq_id
         || CASE WHEN s.note <> '' THEN ' | ' || s.note ELSE '' END,
       false                                    -- is_simulation=false (실데이터 후보) — 확인 포인트 ②
FROM src_cust s
WHERE NOT EXISTS (
  SELECT 1 FROM customers c
  WHERE c.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
    AND (CASE WHEN c.phone LIKE '+82%'
              THEN '0' || regexp_replace(substring(c.phone FROM 4), '[^0-9]', '', 'g')
              ELSE regexp_replace(c.phone, '[^0-9]', '', 'g') END) = s.norm_local
);

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 2 — check_ins (13). customer_id resolved by normalized-phone lookup
--          against the FULL jongno-foot customers (5 pre-existing prod +
--          new from STEP 1). status 'waiting' (HFQ) → 'registered' (foot enum).
--          queue_number=NULL (foot daily queue 충돌 회피; 컬럼 nullable 확인됨).
--          dedup guard: skip if a check_in already tagged for the same src_ci.
-- ─────────────────────────────────────────────────────────────────────────
WITH src_ci(hfq_ci_id, name, phone, norm_local, src_status, src_date, note) AS (
  VALUES
    ('501fad01-6fba-44a4-bced-c2b73325cced','김와사비','+821056688566','01056688566','waiting','2026-05-29',''),
    ('8ecbb2ca-dcec-443a-9037-9dc9ed7d4e79','김와사비','+821099786634','01099786634','waiting','2026-05-30',''),
    ('dd817ae0-baec-453c-8389-a3888dbd7509','김민경',  '+821043160981','01043160981','waiting','2026-05-30','maps→기존 prod 고객'),
    ('104fcfdc-7000-4810-8040-9cc66b5e7abd','로오즈',  '+821054757585','01054757585','waiting','2026-05-30',''),
    ('999b97fb-4afb-4ede-a43d-ea796f866db3','로오즈',  '+821065566658','01065566658','waiting','2026-05-30',''),
    ('54515a07-b63a-4bde-a798-fd0885e1416e','오구리',  '+821066845621','01066845621','waiting','2026-05-30','DUP-SUSPECT (오구리 2건 중 1)'),
    ('99b57a26-5645-4edf-8575-d2b214605b1f','오구리',  '+821066845621','01066845621','waiting','2026-05-30','DUP-SUSPECT (오구리 2건 중 2)'),
    ('ecc06691-7dbe-430f-9180-751b6993dec9','춘향이',  '+821055459722','01055459722','waiting','2026-05-30',''),
    ('772fee43-8f18-4147-a3d4-1633884e4bfc','김와사비','+821066442622','01066442622','waiting','2026-05-30',''),
    ('d7bf3087-d867-4049-9758-ab4e435f1498','머루',    '+821099060089','01099060089','waiting','2026-05-30','maps→기존 prod 고객'),
    ('64b6bc77-c39f-46d7-b493-eaf202768216','잣',      '+821099060083','01099060083','waiting','2026-05-30','maps→기존 prod 고객'),
    ('525d8dee-97e3-4030-b0c4-630a39097b05','빨강',    '+821099990201','01099990201','waiting','2026-05-31','TEST-PATTERN ...99990201 + DUP-SUSPECT (빨강 2건 중 1) — 육안 확인 필수'),
    ('55a17608-46dc-4f7d-b68e-e9bdcbd08df3','빨강',    '+821099990201','01099990201','waiting','2026-05-31','TEST-PATTERN ...99990201 + DUP-SUSPECT (빨강 2건 중 2) — 육안 확인 필수')
)
INSERT INTO check_ins
  (clinic_id, customer_id, customer_name, customer_phone, visit_type, status,
   created_date, queue_number, notes)
SELECT
  '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,
  ( SELECT c.id FROM customers c
    WHERE c.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
      AND (CASE WHEN c.phone LIKE '+82%'
                THEN '0' || regexp_replace(substring(c.phone FROM 4), '[^0-9]', '', 'g')
                ELSE regexp_replace(c.phone, '[^0-9]', '', 'g') END) = s.norm_local
    ORDER BY c.created_at
    LIMIT 1 ),                                  -- 1:1 phone→customer (4 dup-phone in prod 미해당 확인됨)
  s.name,
  s.phone,
  'new',                                        -- visit_type 기본값 — 확인 포인트 ①
  'registered',                                 -- 'waiting'→'registered' 매핑 — 확인 포인트 ③
  s.src_date::date,
  NULL,                                         -- queue_number NULL (충돌 회피)
  '[MIGRATE-HFQ-FOOT-20260531] src_ci=' || s.hfq_ci_id
    || CASE WHEN s.note <> '' THEN ' | ' || s.note ELSE '' END
FROM src_ci s
WHERE EXISTS (   -- customer must resolve, else skip (orphan guard)
  SELECT 1 FROM customers c
  WHERE c.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
    AND (CASE WHEN c.phone LIKE '+82%'
              THEN '0' || regexp_replace(substring(c.phone FROM 4), '[^0-9]', '', 'g')
              ELSE regexp_replace(c.phone, '[^0-9]', '', 'g') END) = s.norm_local
)
AND NOT EXISTS ( -- idempotent: skip if this src_ci already migrated
  SELECT 1 FROM check_ins x
  WHERE x.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
    AND x.notes LIKE '%src_ci=' || s.hfq_ci_id || '%'
);

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 3 — verification (run BEFORE COMMIT; expect 8 / 13)
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'customers tagged' AS what, count(*) AS n
  FROM customers
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
    AND memo LIKE '%[MIGRATE-HFQ-FOOT-20260531]%'
UNION ALL
SELECT 'check_ins tagged', count(*)
  FROM check_ins
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
    AND notes LIKE '%[MIGRATE-HFQ-FOOT-20260531]%';

-- Expected: customers tagged = 8, check_ins tagged = 13.
-- If counts differ → ROLLBACK and re-inspect before COMMIT.

-- COMMIT;   -- ← uncomment ONLY after gate (supervisor GO + 대표 confirm) + count match
ROLLBACK;    -- default-safe: this design file ends in ROLLBACK (no mutation)
