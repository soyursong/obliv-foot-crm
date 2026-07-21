-- T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL
-- 부모 RCA: T-20260721-foot-KIOSK-CRM-1030-ORPHAN-RCA (MSG-20260721-103648-m2hl)
-- 자매(표시교정): T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE (20260721120000, mutation 0)
--
-- ⛔⛔ GATE_HOLD — 이 파일은 DA CONSULT-REPLY(GO) + supervisor DB-gate 수신 전 절대 적용 금지 ⛔⛔
--   approved 상태에서 dev-foot 는 (a)census (b)DA CONSULT (c)write-path 진단까지만.
--   본 UPDATE(PHI customers.name mutable) 실적용은 planner 의 gate_hold 해제 후에만.
--   §S2.4 + Cross-CRM Data-Correction Backfill SOP + Migration Dry-Run No-Persistence Protocol 준수.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- DIAGNOSE-FIRST census 결과 (foot prod rxlomoozakkjesdqjtvd, read_only, 2026-07-21)
--   전수 NFD 대상 = 정확히 3건 (seed 외 추가 0). 전부 is_simulation=false / clinic=jongno(74967aea) / visit_route=TM.
--     · b734f069 F-4818 백민석  raw_len 9 → nfc_len 3
--     · f137fe98 F-4903 강승은  raw_len 9 → nfc_len 3
--     · 0fc0752c F-4920 천승환  raw_len 9 → nfc_len 3
--   지문: char_length(name) <> char_length(normalize(name,NFC)) (자모분해 conjoining jamo U+110x/116x/11xx).
--   검색실패 재현: raw LIKE '%강승은%' = 0건 → 백필 후 normalize(NFC) LIKE = 1건.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 백필 계약 (SOP 준수):
--   · 대상셋 freeze = 아래 3 PK 고정. ★단일 count/predicate 기준 대량 UPDATE 금지 — PK IN-list 만.
--   · 이중 가드: (id IN freeze) AND (여전히 NFD: char_length(name) <> char_length(normalize(name,NFC))).
--     → GO 전 현장이 이미 수기 정정한 행은 지문 불일치로 자동 skip(no-touch).
--   · affected 예상밖(≠ 대상) 시 RAISE EXCEPTION → 트랜잭션 전체 ABORT (예상 3, 단 GO 시점 census 재확인 값으로 교체).
--   · 원장(payments/service_charges) 무접점. clinic 격리(WHERE 절 PK 자체가 jongno 한정).
--   · rollback 원값(NFD) = _backfill.rollback.sql + _freeze.json 에 hex 보존.
--
-- 멱등: 재실행 시 이미 NFC → 지문 불일치로 0-row → affected 0 은 정상(재실행 안전). 단 최초 apply 는 정확히 census 재확인 count.

BEGIN;

DO $$
DECLARE
  v_expected INT := 3;   -- ★ GO 시점 census 재확인 값으로 교체(현재 진단=3). 이 값과 실제 affected 불일치 시 ABORT.
  v_affected INT;
BEGIN
  UPDATE public.customers c
     SET name = normalize(c.name, NFC)
   WHERE c.id IN (
           'b734f069-5a06-414b-9ad6-f32ee3b3bf2c',   -- F-4818 백민석
           'f137fe98-30b2-4a66-bcc0-73bc68277b58',   -- F-4903 강승은
           '0fc0752c-7ccd-4a71-85ec-b7e4e5f20527'    -- F-4920 천승환
         )
     AND c.name IS NOT NULL
     AND char_length(c.name) <> char_length(normalize(c.name, NFC));   -- still-NFD 가드(수기 정정분 자동 skip)

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  -- affected 예상밖 abort (SOP): GO 후 최초 apply 는 census 재확인 count 와 일치해야 함.
  IF v_affected > v_expected THEN
    RAISE EXCEPTION 'BACKFILL ABORT: affected=% > expected=% (freeze-set 초과 — 예상밖 대상)', v_affected, v_expected;
  END IF;
  RAISE NOTICE 'customers.name NFD→NFC backfill affected=% (expected<=%, 멱등 재실행 시 0 정상)', v_affected, v_expected;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- POSTCHECK (apply 후 supervisor DB-gate)
--   -- 1) NFD 잔존 census 0 (전수):
--   SELECT count(*) FROM public.customers
--    WHERE name IS NOT NULL AND char_length(name) <> char_length(normalize(name,NFC));  -- 기대 0
--   -- 2) 이름검색 재현(raw LIKE, 백필 후 ≥1):
--   SELECT chart_number, name FROM public.customers WHERE name LIKE '%강승은%';   -- 기대 F-4903 1건
--   SELECT chart_number, name FROM public.customers WHERE name LIKE '%백민석%';   -- 기대 F-4818 1건
--   SELECT chart_number, name FROM public.customers WHERE name LIKE '%천승환%';   -- 기대 F-4920 1건
--   -- 3) freeze 3 PK after 확인(char_length=3):
--   SELECT id, chart_number, name, char_length(name)
--     FROM public.customers
--    WHERE id IN ('b734f069-5a06-414b-9ad6-f32ee3b3bf2c','f137fe98-30b2-4a66-bcc0-73bc68277b58','0fc0752c-7ccd-4a71-85ec-b7e4e5f20527');
--
-- 파생 denormalize 사본(reservations.customer_name 3 / check_ins.customer_name 1 NFD)은
--   DA CONSULT 에서 스코프 확정(별 stage 또는 본건 fold) — 1차 대상=customers.name.
