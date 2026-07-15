-- DRY-RUN: T-20260715-foot-SELFCHECKIN-CONFIRM-FULLPII-CUSTMATCH
-- 前/後 반환면 diff + §16-5 UUID-bearer 실증 — 실 데이터 무변경(BEGIN...ROLLBACK). supervisor DB-GATE 증거용.
-- 프로드 rxlomoozakkjesdqjtvd 대상. 함수는 스키마-오브젝트만 신설되고 테이블 데이터는 불변(read-only RPC).
--
-- 실행: psql "$FOOT_DB_URL" -f 이 파일  (BEGIN...ROLLBACK 로 감싸 실적용 0)

BEGIN;

-- ── (up 마이그를 이 tx 안에서 먼저 실행) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_verify_reservation(
  p_clinic_id       UUID,
  p_phone           TEXT,
  p_reservation_id  UUID DEFAULT NULL
)
RETURNS TABLE(
  reservation_id    UUID,
  customer_id       UUID,
  customer_name     TEXT,
  customer_phone    TEXT,
  reservation_time  TIME WITHOUT TIME ZONE,
  visit_type        TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH gate AS (
    SELECT
      p_clinic_id AS cid,
      CASE
        WHEN left(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 2) = '82'
             AND char_length(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')) BETWEEN 11 AND 13
          THEN '0' || substr(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 3)
        ELSE regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')
      END AS pn
  )
  SELECT
    r.id, r.customer_id,
    COALESCE(r.customer_name,  c.name),
    COALESCE(r.customer_phone, c.phone),
    r.reservation_time, r.visit_type
  FROM public.reservations r
  LEFT JOIN public.customers c ON c.id = r.customer_id
  CROSS JOIN gate g
  WHERE r.clinic_id        = g.cid
    AND r.reservation_date = (now() AT TIME ZONE 'Asia/Seoul')::date
    AND r.status           = 'confirmed'
    AND char_length(g.pn) >= 8
    AND (
      CASE
        WHEN left(regexp_replace(COALESCE(r.customer_phone, c.phone, ''), '\D', '', 'g'), 2) = '82'
             AND char_length(regexp_replace(COALESCE(r.customer_phone, c.phone, ''), '\D', '', 'g')) BETWEEN 11 AND 13
          THEN '0' || substr(regexp_replace(COALESCE(r.customer_phone, c.phone, ''), '\D', '', 'g'), 3)
        ELSE regexp_replace(COALESCE(r.customer_phone, c.phone, ''), '\D', '', 'g')
      END = g.pn
      OR right(regexp_replace(COALESCE(r.customer_phone, c.phone, ''), '\D', '', 'g'), 8) = right(g.pn, 8)
    )
    AND (p_reservation_id IS NULL OR r.id = p_reservation_id)
  ORDER BY r.reservation_time ASC
  LIMIT 1;
$$;
ALTER FUNCTION public.fn_selfcheckin_verify_reservation(UUID, TEXT, UUID) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.fn_selfcheckin_verify_reservation(UUID, TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_selfcheckin_verify_reservation(UUID, TEXT, UUID) TO anon;

-- ── (A) §16-5 UUID-bearer CRITICAL: phone 없이 UUID 단독 호출 → PII 0건 ──────────
--     아래 두 SELECT 는 phone=NULL / phone='' 케이스. 기대: 0 rows(어떤 예약 UUID 를 줘도).
--     '<clinic_uuid>' / '<resv_uuid>' 는 DB-GATE 시 실 UUID 로 치환.
-- SELECT 'phone_null'  AS case, count(*) FROM public.fn_selfcheckin_verify_reservation('<clinic_uuid>'::uuid, NULL, '<resv_uuid>'::uuid);  -- 기대 0
-- SELECT 'phone_empty' AS case, count(*) FROM public.fn_selfcheckin_verify_reservation('<clinic_uuid>'::uuid, '',   NULL);                -- 기대 0

-- ── (B) 정상 동선: 실 예약 phone 으로 호출 → 본인 1건 raw 반환 ────────────────────
-- SELECT reservation_id, customer_name, customer_phone
--   FROM public.fn_selfcheckin_verify_reservation('<clinic_uuid>'::uuid, '010-XXXX-XXXX', NULL);
-- 회귀 단언(supervisor 확인):
--   · phone 매칭 통과분에 한해 customer_name/customer_phone = raw(마스킹 아님)
--   · 반환 행 수 ≤ 1 (LIMIT 1, 본인 매칭 예약 1건만)
--   · 오늘(KST)·해당 clinic·status=confirmed 밖 예약은 반환 0 (default-deny)

-- ── (C) proacl 확인: PUBLIC 회수 + anon EXECUTE ────────────────────────────────
SELECT has_function_privilege('anon','public.fn_selfcheckin_verify_reservation(uuid,text,uuid)','EXECUTE') AS anon_exec; -- 기대 true
SELECT proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='fn_selfcheckin_verify_reservation';  -- '=X/postgres'(PUBLIC) 토큰 없어야 함
SELECT p.proconfig, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='fn_selfcheckin_verify_reservation';  -- 기대 {search_path=""}, true

ROLLBACK;
