-- T-20260715-foot-SELFCHECKIN-CONFIRM-FULLPII-CUSTMATCH
-- DA CONSULT-REPLY: DA-20260715-foot-SELFCHECKIN-CONFIRM-FULLPII-CUSTMATCH (verdict = phone-gated scoped-raw RPC).
-- canonical anchors: 계약 §15-5-4(서버측 마스킹, list raw=0) · §16-5(UUID-bearer 차단: UUID 단독 PII 반환 금지,
--   phone 재검증 게이트) · L2549(셀프체크인 노출 = SECDEF RPC + clinic_id + phone 이중술어) ·
--   §15-5-1/3(anon allowlist + PUBLIC REVOKE) · §1-8(search_path='' 핀).
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 배경 / 문제
-- ══════════════════════════════════════════════════════════════════════════════
-- T-20260711-SELFCHECKIN-SERVER-MASKING 이 fn_selfcheckin_today_reservations 를 서버측 마스킹
-- (name→홍*동 / phone→뒤4자리)으로 전환 → anon 목록 경로의 raw PHI 전송 = 0 (§15-5-4 canonical).
-- 그 결과 셀프접수 "접수정보확인" 단계가 마스킹값을 표시(총괄 지적) + 예약동선 매칭이 마스킹 name 으로
-- 조회 실패 → masked customers row 신규 생성(중복차트 벡터).
--
-- DA 판정: 목록함수(fn_selfcheckin_today_reservations) raw 복원(B안) = 반려(kiosk anon 이 오늘 예약자
--   전원 raw PHI 를 브로드캐스트하는 §15-5-4 구멍 재개방). 대신 §L2549 canonical =
--   고객 "본인 phone 입력(챌린지)" 통과 시에만 본인 1건 raw 를 언락하는 phone-gated SECDEF RPC 신설.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 본 마이그 = 신규 phone-gated scoped-raw SECDEF RPC 신설 (ADDITIVE)
-- ══════════════════════════════════════════════════════════════════════════════
-- fn_selfcheckin_verify_reservation(p_clinic_id, p_phone, p_reservation_id)
--   · clinic_id + phone 이중술어(§L2549). phone 이 필수 보안 게이트.
--   · 본인 매칭 예약 "1건만" raw(name/phone) + reservation_id + customer_id + reservation_time + visit_type 반환.
--   · p_reservation_id = 목록에서 선택한 예약으로 좁히는 선택적 narrowing 필터(단독 자격증명 아님).
--
-- §16-5 UUID-bearer 차단(CRITICAL): p_phone 이 NULL/빈값이면 즉시 빈 결과(PII 0건) 반환.
--   → "phone 재검증 없이 UUID(reservation_id/customer_id) 단독으로 PII 반환" 경로 = 물리적으로 부재.
--   reservation_id 는 narrowing 전용 — phone 매칭 없이는 어떤 행도 반환하지 않음(default-deny).
--
-- 분류/게이트: 신 오브젝트 · drop 0 · 데이터 mutate 0 · 스키마/컬럼/enum 무변경 = ADDITIVE.
--   masking·PHI 채널 = DA 소관 + ADDITIVE → autonomy §3.1 + §15-6-5 선례상 대표 게이트 면제.
--   남은 단일 게이트 = supervisor DDL-diff DB-GATE (pg_proc + proacl + §16-5 introspection + rollback).
-- 멱등: CREATE OR REPLACE + REVOKE/GRANT 자연 멱등. 가역: rollback = DROP FUNCTION.
-- author: dev-foot / 2026-07-15 · ticket: T-20260715-foot-SELFCHECKIN-CONFIRM-FULLPII-CUSTMATCH

BEGIN;

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
  -- §16-5 fail-closed: phone 없거나 유효숫자 0 → 어떤 행도 반환하지 않음(UUID 단독 PII 반환 차단).
  WITH gate AS (
    SELECT
      p_clinic_id AS cid,
      -- 입력 phone 정규화: 숫자만 추출 후 82-prefix(E.164) → 0-local 로 환원.
      CASE
        WHEN left(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 2) = '82'
             AND char_length(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')) BETWEEN 11 AND 13
          THEN '0' || substr(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 3)
        ELSE regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')
      END AS pn
  )
  SELECT
    r.id                                   AS reservation_id,
    r.customer_id                          AS customer_id,
    COALESCE(r.customer_name,  c.name)     AS customer_name,   -- raw (본인검증 통과분에 한해)
    COALESCE(r.customer_phone, c.phone)    AS customer_phone,  -- raw
    r.reservation_time,
    r.visit_type
  FROM public.reservations r
  LEFT JOIN public.customers c ON c.id = r.customer_id
  CROSS JOIN gate g
  WHERE r.clinic_id        = g.cid
    AND r.reservation_date = (now() AT TIME ZONE 'Asia/Seoul')::date  -- 오늘(KST) 한정
    AND r.status           = 'confirmed'
    AND char_length(g.pn) >= 8                                        -- §16-5: 유효 phone 없으면 빈결과
    -- clinic_id + phone 이중술어(§L2549): 정규화 완전일치 OR 끝 8자리 일치(저장포맷 변이 견고).
    AND (
      CASE
        WHEN left(regexp_replace(COALESCE(r.customer_phone, c.phone, ''), '\D', '', 'g'), 2) = '82'
             AND char_length(regexp_replace(COALESCE(r.customer_phone, c.phone, ''), '\D', '', 'g')) BETWEEN 11 AND 13
          THEN '0' || substr(regexp_replace(COALESCE(r.customer_phone, c.phone, ''), '\D', '', 'g'), 3)
        ELSE regexp_replace(COALESCE(r.customer_phone, c.phone, ''), '\D', '', 'g')
      END = g.pn
      OR right(regexp_replace(COALESCE(r.customer_phone, c.phone, ''), '\D', '', 'g'), 8) = right(g.pn, 8)
    )
    -- narrowing(선택): 목록에서 선택한 예약으로 좁힘. 단독 자격증명 아님(phone 게이트 필수).
    AND (p_reservation_id IS NULL OR r.id = p_reservation_id)
  ORDER BY r.reservation_time ASC
  LIMIT 1;   -- 본인 매칭 예약 1건만
$$;

ALTER FUNCTION public.fn_selfcheckin_verify_reservation(UUID, TEXT, UUID) OWNER TO postgres;

-- §15-5-3: PUBLIC 기본부여 회수(CREATE FUNCTION 표준 기본값 =X/postgres 제거) + §15-5-1 allowlist anon 재부여.
REVOKE EXECUTE ON FUNCTION public.fn_selfcheckin_verify_reservation(UUID, TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_selfcheckin_verify_reservation(UUID, TEXT, UUID) TO anon;

COMMENT ON FUNCTION public.fn_selfcheckin_verify_reservation(UUID, TEXT, UUID) IS
  'T-20260715-foot-SELFCHECKIN-CONFIRM-FULLPII-CUSTMATCH: 셀프접수 본인확인 phone-gated scoped-raw RPC. '
  '고객 본인 phone 입력(챌린지) 통과 시에만 clinic_id+phone 이중술어(§L2549)로 본인 매칭 예약 1건의 '
  'raw name/phone + reservation_id + customer_id(핸들) 반환. p_phone 없으면 빈결과(§16-5 UUID-bearer 차단). '
  'SECURITY DEFINER + search_path='''' 핀(§1-8) + REVOKE PUBLIC + GRANT anon(§15-5-1/3). '
  '목록함수(fn_selfcheckin_today_reservations)는 masked 유지 — raw 는 phone 챌린지 통과 본인레코드에 한해 언락.';

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- 검증 쿼리 (apply 후 supervisor DB-GATE)
-- ══════════════════════════════════════════════════════════════════════════════
--   -- 1) search_path 핀 + SECURITY DEFINER (기대: proconfig={search_path=""}, prosecdef=true)
--   SELECT p.proname, p.proconfig, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname='fn_selfcheckin_verify_reservation';
--
--   -- 2) proacl: PUBLIC 회수 + anon EXECUTE 재부여 (기대: anon=true, PUBLIC(=first token)=없음)
--   SELECT has_function_privilege('anon','public.fn_selfcheckin_verify_reservation(uuid,text,uuid)','EXECUTE'); -- true
--   SELECT proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname='fn_selfcheckin_verify_reservation';  -- =X/postgres(PUBLIC) 없어야 함
--
--   -- 3) §16-5 UUID-bearer CRITICAL: phone 없이(NULL) UUID 단독 호출 → PII 0건 반환 실증
--   SELECT count(*) FROM public.fn_selfcheckin_verify_reservation('<clinic_uuid>', NULL, '<any_reservation_uuid>'); -- 기대: 0
--   SELECT count(*) FROM public.fn_selfcheckin_verify_reservation('<clinic_uuid>', '', NULL);                       -- 기대: 0
--
--   -- 4) 정상 동선: 실제 예약 phone 으로 호출 → 본인 1건 raw 반환
--   SELECT reservation_id, customer_name, customer_phone
--     FROM public.fn_selfcheckin_verify_reservation('<clinic_uuid>', '010-XXXX-XXXX', NULL);  -- 기대: 1건 raw
