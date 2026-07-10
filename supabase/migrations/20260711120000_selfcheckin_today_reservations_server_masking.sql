-- T-20260711-foot-SELFCHECKIN-SERVER-MASKING
-- 부모 T-20260711-crm-SECDEF-ANON-REVOKE / DA-20260711-crm-SECDEF-ANON-REVOKE §1~2 / 계약 §15-5-4.
-- crm get_today_reservations_masked(서버측 마스킹, raw 미전송) = cross-CRM 신 canonical.
-- foot fn_selfcheckin_today_reservations 는 그 canonical 회귀 대상.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 배경 (DA CONSULT-REPLY 실측)
-- ══════════════════════════════════════════════════════════════════════════════
-- 원 함수(migration 20260601190000)는 raw customer_name + customer_phone 를 anon 에 반환하고,
-- 마스킹은 FE(외부 셀프체크인 앱 maskName/maskPhone)에서만 수행 → 계약 §15-5-1
-- "반환 PHI-0/opaque" 가드레일 미충족. FE 마스킹 = 화면 가림일 뿐 보안 경계 아님
-- (raw PHI 가 anon 경로로 이미 전송됨). 본 마이그는 마스킹을 함수 내부(서버측)로 이관해
-- raw PHI 의 anon 경로 전송을 0 으로 만든다.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- AC1 — 서버측 마스킹 강제 (§15-5-4 canonical 승계)
--   name  = 성 + 끝자 (홍길동→홍*동 / 홍길→홍* / 1자→그대로 노출불가 최소화)
--   phone = 뒤 4자리만 (010-1234-5678 → 5678)
--   raw full name/phone 은 반환면에서 소멸 → anon 경로 raw PHI 전송 0.
-- AC2 — 반환면 상한 (crm AC7 표 동일)
--   id/customer_id = UUID opaque (그대로), reservation_time = 그대로, visit_type = coarse(카테고리).
--   birth/RRN·주소·email·memo·시술상세·임상·결제 전면 배제 (반환 컬럼 자체가 없음).
-- AC4 — default-deny 술어 유지: clinic_id + reservation_date + status='confirmed' 스코프 그대로.
--        반환면만 축소(raw→masked). 필터/정렬 무변경 → 목록 표시·매칭 회귀 0.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- §1-8 guardrail 정합 (형제 마이그 20260710224000 PRESCREEN-PIN-HARDEN 동일 패턴)
-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER 함수 → SET search_path='' 핀 의무. 원 함수는 SET search_path=public(무핀 상당) →
-- 본 마이그로 search_path='' 핀 + 테이블참조 public. qualify 동시 적용(reservations/customers).
--   · 마스킹 내장함수(btrim/char_length/left/right/repeat/regexp_replace/coalesce/case)는 pg_catalog
--     소속 → search_path='' 여도 암묵 우선 resolve → qualify 불요. public 테이블만 qualify.
--
-- 멱등: CREATE OR REPLACE + GRANT 반복 무해(반환 signature 동일 → ACL 보존, 안전차 GRANT 재부여 명시).
-- 가역: rollback = 원 함수(raw 반환) 복원. 20260711120000_..._server_masking.rollback.sql
-- 게이트: 반환면 축소=ADDITIVE-우선(raw 미전송 강화) + 마스킹규칙 DA 소관 → 대표 게이트 아님.
--         supervisor DB-GATE(前/後 반환면 diff + anon 셀프체크인 E2E 회귀 0 + DDL-diff)만.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_today_reservations(
  p_clinic_id UUID,
  p_date      DATE
)
RETURNS TABLE(
  id               UUID,
  customer_id      UUID,
  customer_name    TEXT,
  customer_phone   TEXT,
  reservation_time TIME WITHOUT TIME ZONE,
  visit_type       TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    t.id,
    t.customer_id,
    -- AC1 name 마스킹: 성 + 끝자 (홍길동→홍*동 / 홍길→홍* / 1자→그대로 / 결측→그대로)
    CASE
      WHEN t.nm IS NULL OR btrim(t.nm) = ''       THEN t.nm
      WHEN char_length(btrim(t.nm)) = 1           THEN btrim(t.nm)
      WHEN char_length(btrim(t.nm)) = 2           THEN left(btrim(t.nm), 1) || '*'
      ELSE left(btrim(t.nm), 1)
           || repeat('*', char_length(btrim(t.nm)) - 2)
           || right(btrim(t.nm), 1)
    END                                                        AS customer_name,
    -- AC1 phone 마스킹: 숫자만 추출 후 뒤 4자리만 (결측/4자리 미만→그대로 tail)
    CASE
      WHEN t.ph IS NULL                              THEN NULL
      WHEN regexp_replace(t.ph, '\D', '', 'g') = ''  THEN NULL
      ELSE right(regexp_replace(t.ph, '\D', '', 'g'), 4)
    END                                                        AS customer_phone,
    t.reservation_time,
    t.visit_type
  FROM (
    SELECT
      r.id,
      r.customer_id,
      COALESCE(r.customer_name,  c.name)  AS nm,
      COALESCE(r.customer_phone, c.phone) AS ph,
      r.reservation_time,
      r.visit_type
    FROM public.reservations r
    LEFT JOIN public.customers c ON c.id = r.customer_id
    WHERE r.clinic_id        = p_clinic_id     -- AC4 지점 격리
      AND r.reservation_date = p_date          -- AC4 인자 날짜(오늘 KST) 한정
      AND r.status           = 'confirmed'     -- AC4 체크인 전 예약만
  ) t
  ORDER BY t.reservation_time ASC;
$$;

ALTER  FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE) OWNER TO postgres;

-- 반환 signature 동일 → CREATE OR REPLACE 가 기존 ACL 보존. 안전차 GRANT 재부여 명시(멱등).
GRANT  EXECUTE ON FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE) IS
  'T-20260711-foot-SELFCHECKIN-SERVER-MASKING: 셀프체크인 anon 오늘 예약자 목록. '
  '서버측 마스킹(name=성+끝자 홍*동, phone=뒤 4자리) → raw PHI anon 미전송(계약 §15-5-4 canonical). '
  '반환면 상한: id/customer_id opaque UUID, reservation_time 그대로, visit_type coarse. '
  'clinic_id + date + status=confirmed 스코프 유지. + search_path='''' 핀(§1-8 guardrail).';

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- 검증 쿼리 (apply 후 supervisor DB-GATE)
-- ══════════════════════════════════════════════════════════════════════════════
--   -- 1) search_path 핀 확인 (기대: {search_path=""})
--   SELECT p.proname, p.proconfig, p.prosecdef
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname='fn_selfcheckin_today_reservations';
--   -- 기대: proconfig={search_path=""}, prosecdef=true
--
--   -- 2) anon EXECUTE 화이트리스트 유지 (기대: true — 셀프체크인 공개흐름 필수)
--   SELECT has_function_privilege('anon','public.fn_selfcheckin_today_reservations(uuid,date)','EXECUTE'); -- true
--
--   -- 3) 반환면 마스킹 검증 (raw PHI 미전송 — full name/phone 반환 0)
--   --    SELECT customer_name, customer_phone
--   --      FROM public.fn_selfcheckin_today_reservations('<clinic_uuid>', current_date);
--   --    기대: customer_name ~ '^.[*]*.$' (성+끝자), customer_phone = 4자리 숫자, full PHI 0.
