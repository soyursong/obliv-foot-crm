-- T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE
-- 부모 RCA: T-20260721-foot-KIOSK-CRM-1030-ORPHAN-RCA (MSG-20260721-103648-m2hl)
-- 회귀 대상: fn_selfcheckin_today_reservations (canonical 서버측 마스킹, 20260711120000_..._server_masking.sql)
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 배경 (RCA 실측)
-- ══════════════════════════════════════════════════════════════════════════════
-- 셀프접수 키오스크 예약자 명단에서 실환자 강승은의 이름이 `ᄀ*******ᆫ`(자모분해 마스킹 깨짐)로 표시.
--   RC: customers.name(또는 reservations.customer_name)이 유니코드 NFD(자모분해)로 저장 →
--       한 완성형 글자('강')가 conjoining jamo(U+1100 ᄀ + U+1161 ᅡ + U+11ab ᆫ …) 여러 codepoint 로 쪼개짐.
--       char_length(raw NFD '강승은') = 9, char_length(NFC '강승은') = 3.
--   본 함수의 마스킹 산식(left/right/char_length/repeat)은 codepoint 단위로 동작 →
--       NFD 입력에서 성/끝자 경계가 자모 사이로 어긋나 `ᄀ*******ᆫ` 처럼 깨짐.
--   대시보드는 raw 렌더(마스킹 없음)라 안 깨짐 = 표시 비대칭.
--
-- 교정: 마스킹 입력(nm)을 normalize(..., NFC) 로 래핑 → codepoint 단위 마스킹이 완성형 글자 기준으로
--       동작. NFD 저장값이 남아있어도(백필 전) 표시 시점에 NFC 로 흡수 → `강*은` 로 정상 표시.
--   ※ 저장 데이터(customers.name)는 건드리지 않음(데이터 mutation 0). 근본 데이터정정은 별건
--     T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL(gate_hold, DA CONSULT-REPLY 선행).
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 변경 델타 (ADDITIVE, 표시 출력만 교정)
-- ══════════════════════════════════════════════════════════════════════════════
--   유일 델타: 서브쿼리 nm 파생을 COALESCE(...) → normalize(COALESCE(...), NFC) 로 래핑.
--   불변: 시그니처(UUID,DATE)·반환형(6컬럼 동일)·권한(anon,authenticated EXECUTE)·
--         SECURITY DEFINER·owner=postgres·SET search_path=''·필터/정렬(clinic_id+date+confirmed).
--   · normalize 는 pg_catalog 내장 → search_path='' 여도 암묵 우선 resolve → qualify 불요
--     (btrim/char_length/left/right/repeat/regexp_replace/coalesce/case 와 동일). NFC 는 SQL 표준 키워드.
--   · phone 마스킹은 숫자만 추출(regexp_replace \D) → NFD 무관, 무변경.
--
-- 멱등: CREATE OR REPLACE + GRANT 반복 무해(반환 signature 동일 → ACL 보존, 안전차 GRANT 재부여 명시).
-- 가역: rollback = 직전(20260711120000) 함수정의(normalize 미적용) 복원.
--        20260721120000_..._nfc_normalize_mask.rollback.sql
-- 게이트: 마스킹 출력만 교정(표시 결함) + 데이터 mutation 0 → 대표 게이트 불요(autonomy §3.1).
--         supervisor DDL-diff DB-GATE(pg_proc 외 diff empty) + pg_proc PREFLIGHT(deploy-precheck C10)
--         + MIG-GATE 4필드 + dry-run 무영속 evidence.

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
    --   입력 nm 은 서브쿼리에서 NFC 정규화됨 → char_length/left/right 가 완성형 글자 기준으로 동작
    --   (NFD 자모분해 저장값도 표시 시점에 흡수: `ᄀ*******ᆫ` 깨짐 방지 → `강*은`).
    CASE
      WHEN t.nm IS NULL OR btrim(t.nm) = ''       THEN t.nm
      WHEN char_length(btrim(t.nm)) = 1           THEN btrim(t.nm)
      WHEN char_length(btrim(t.nm)) = 2           THEN left(btrim(t.nm), 1) || '*'
      ELSE left(btrim(t.nm), 1)
           || repeat('*', char_length(btrim(t.nm)) - 2)
           || right(btrim(t.nm), 1)
    END                                                        AS customer_name,
    -- AC1 phone 마스킹: 숫자만 추출 후 뒤 4자리만 (결측/4자리 미만→그대로 tail). NFD 무관.
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
      -- ★T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE: 마스킹 입력 NFC 정규화 래핑(유일 델타).
      normalize(COALESCE(r.customer_name,  c.name), NFC)  AS nm,
      COALESCE(r.customer_phone, c.phone)                 AS ph,
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
  'T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE (base T-20260711-foot-SELFCHECKIN-SERVER-MASKING): '
  '셀프체크인 anon 오늘 예약자 목록. 서버측 마스킹(name=성+끝자 홍*동, phone=뒤 4자리) → raw PHI anon 미전송. '
  '마스킹 입력 name 을 normalize(NFC) 로 정규화 → NFD 자모분해 저장값도 완성형 글자 기준 마스킹(강*은). '
  '반환면 상한: id/customer_id opaque UUID, reservation_time 그대로, visit_type coarse. '
  'clinic_id + date + status=confirmed 스코프 유지. + search_path='''' 핀(§1-8 guardrail). 데이터 mutation 0.';

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- 검증 쿼리 (apply 후 supervisor DB-GATE / POSTCHECK)
-- ══════════════════════════════════════════════════════════════════════════════
--   -- 1) search_path 핀 + SECDEF 불변 (기대: proconfig={search_path=""}, prosecdef=true)
--   SELECT p.proname, p.proconfig, p.prosecdef, pg_get_userbyid(p.proowner) AS owner
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname='fn_selfcheckin_today_reservations';
--   -- 기대: proconfig={search_path=""}, prosecdef=true, owner=postgres
--
--   -- 2) anon EXECUTE 화이트리스트 유지 (기대: true — 셀프체크인 공개흐름 필수)
--   SELECT has_function_privilege('anon','public.fn_selfcheckin_today_reservations(uuid,date)','EXECUTE'); -- true
--
--   -- 3) NFD 마스킹 회귀 (강승은: NFD 저장값 → NFC 마스킹 '강*은')
--   --    SELECT customer_name FROM public.fn_selfcheckin_today_reservations('<clinic_uuid>', current_date);
--   --    기대: '강*은'(완성형 3글자 마스킹) — `ᄀ*******ᆫ` 미출현. 기존 정상 이름(서*숙/문*수) 회귀 0.
