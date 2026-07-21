-- DRY-RUN: T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 의 BEGIN/COMMIT(txn-control) 는 strip. 아래 자체 BEGIN...ROLLBACK 안에서 CREATE OR REPLACE 실행.
--   · tx 내에서 마스킹 산식 회귀(NFD→NFC) 확인 후 ROLLBACK → 실적용 0.
--   · ROLLBACK 이후 post-probe(introspection)로 prod 실재 함수정의에 normalize 미포함(=무영속) 재확인.
-- 프로드 rxlomoozakkjesdqjtvd 대상. 실행: psql "$FOOT_DB_URL" -f 이 파일.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — 마스킹 산식 회귀 (NFD 깨짐 → NFC 정규화로 교정) : txn 무관 read-only 대조
-- ══════════════════════════════════════════════════════════════════════════════
WITH samples(label, nm_raw) AS (
  VALUES
    ('NFC-정상 강승은',  normalize('강승은', NFC)),   -- 완성형 3 codepoint
    ('NFD-깨짐 강승은',  normalize('강승은', NFD)),   -- 자모분해(conjoining jamo) → char_length 팽창
    ('NFC 홍길동',       normalize('홍길동', NFC)),
    ('NFC 이영',         normalize('이영',   NFC)),
    ('NFC 박',           normalize('박',     NFC)),
    ('NULL',             NULL)
)
SELECT
  label,
  char_length(nm_raw)                          AS raw_len,       -- NFD 는 팽창(강승은 NFD=9)
  char_length(normalize(nm_raw, NFC))          AS nfc_len,       -- NFC 정규화 후 3
  -- 現(수정 전): raw 에 직접 마스킹 → NFD 는 자모 사이로 잘려 깨짐(ᄀ*******ᆫ)
  CASE
    WHEN nm_raw IS NULL OR btrim(nm_raw) = ''  THEN nm_raw
    WHEN char_length(btrim(nm_raw)) = 1        THEN btrim(nm_raw)
    WHEN char_length(btrim(nm_raw)) = 2        THEN left(btrim(nm_raw), 1) || '*'
    ELSE left(btrim(nm_raw), 1) || repeat('*', char_length(btrim(nm_raw)) - 2) || right(btrim(nm_raw), 1)
  END                                          AS masked_before,
  -- 後(수정 후): normalize(NFC) 래핑 입력에 마스킹 → 완성형 글자 기준(강*은)
  CASE
    WHEN normalize(nm_raw, NFC) IS NULL OR btrim(normalize(nm_raw, NFC)) = ''  THEN normalize(nm_raw, NFC)
    WHEN char_length(btrim(normalize(nm_raw, NFC))) = 1                        THEN btrim(normalize(nm_raw, NFC))
    WHEN char_length(btrim(normalize(nm_raw, NFC))) = 2                        THEN left(btrim(normalize(nm_raw, NFC)), 1) || '*'
    ELSE left(btrim(normalize(nm_raw, NFC)), 1)
         || repeat('*', char_length(btrim(normalize(nm_raw, NFC))) - 2)
         || right(btrim(normalize(nm_raw, NFC)), 1)
  END                                          AS masked_after
FROM samples;
-- 기대:
--   NFC-정상 강승은 → raw_len=3, masked_before=강*은, masked_after=강*은
--   NFD-깨짐 강승은 → raw_len=9, masked_before=ᄀ*******ᆫ(깨짐), masked_after=강*은  ← 교정 핵심
--   NFC 홍길동      → 홍*동 / 홍*동
--   NFC 이영        → 이*   / 이*
--   NFC 박          → 박    / 박
--   NULL            → NULL  / NULL

-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — up 마이그(txn-control strip) 를 rolled-back tx 안에서 실적용 후 회귀 → ROLLBACK
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_today_reservations(
  p_clinic_id UUID,
  p_date      DATE
)
RETURNS TABLE(
  id UUID, customer_id UUID, customer_name TEXT, customer_phone TEXT,
  reservation_time TIME WITHOUT TIME ZONE, visit_type TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT t.id, t.customer_id,
    CASE
      WHEN t.nm IS NULL OR btrim(t.nm) = ''  THEN t.nm
      WHEN char_length(btrim(t.nm)) = 1      THEN btrim(t.nm)
      WHEN char_length(btrim(t.nm)) = 2      THEN left(btrim(t.nm), 1) || '*'
      ELSE left(btrim(t.nm), 1) || repeat('*', char_length(btrim(t.nm)) - 2) || right(btrim(t.nm), 1)
    END AS customer_name,
    CASE
      WHEN t.ph IS NULL                              THEN NULL
      WHEN regexp_replace(t.ph, '\D', '', 'g') = ''  THEN NULL
      ELSE right(regexp_replace(t.ph, '\D', '', 'g'), 4)
    END AS customer_phone,
    t.reservation_time, t.visit_type
  FROM (
    SELECT r.id, r.customer_id,
      normalize(COALESCE(r.customer_name, c.name), NFC) AS nm,
      COALESCE(r.customer_phone, c.phone)               AS ph,
      r.reservation_time, r.visit_type
    FROM public.reservations r
    LEFT JOIN public.customers c ON c.id = r.customer_id
    WHERE r.clinic_id = p_clinic_id AND r.reservation_date = p_date AND r.status = 'confirmed'
  ) t
  ORDER BY t.reservation_time ASC;
$$;

-- 반환 signature/시그니처 불변 검증 (tx 내)
SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
       pg_get_function_identity_arguments(p.oid) AS args,
       (p.prosrc LIKE '%normalize(COALESCE%NFC)%') AS has_nfc_wrap
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='fn_selfcheckin_today_reservations';
-- 기대(tx 내): prosecdef=true, proconfig={search_path=""}, owner=postgres, args='p_clinic_id uuid, p_date date', has_nfc_wrap=true

ROLLBACK;   -- ★ 실적용 0

-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — POST-PROBE (무영속 재확인) : ROLLBACK 이후 prod 실재 정의에 normalize 미포함
-- ══════════════════════════════════════════════════════════════════════════════
SELECT p.proname,
       (p.prosrc LIKE '%normalize(COALESCE%NFC)%') AS still_has_nfc_wrap  -- 기대: false (무영속 증명)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='fn_selfcheckin_today_reservations';
-- 기대: still_has_nfc_wrap=false → dry-run 이 prod 함수정의를 변경하지 않았음(sentinel-bypass 아님) 확인.
