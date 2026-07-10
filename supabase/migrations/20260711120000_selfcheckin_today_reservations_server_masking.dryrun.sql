-- DRY-RUN: T-20260711-foot-SELFCHECKIN-SERVER-MASKING
-- 前/後 반환면 diff (AC5) — 실 데이터 무변경(rollback tx). supervisor DB-GATE 증거용.
-- 프로드 rxlomoozakkjesdqjtvd 대상. 함수는 스키마-오브젝트만 바뀌고 테이블 데이터는 불변.
--
-- 실행: psql "$FOOT_DB_URL" -f 이 파일  (BEGIN...ROLLBACK 로 감싸 실적용 0)

BEGIN;

-- ── (A) 前: 마스킹 규칙을 raw 후보값에 미리 적용해 반환면 형태 확인 ──────────────
--     실제 함수 apply 없이 마스킹 산식만 대표 샘플에 대조(반환 컬럼 형태 예측).
WITH samples(nm, ph) AS (
  VALUES
    ('홍길동',      '010-1234-5678'),
    ('김철수',      '+821098765432'),
    ('이영',        '01055551234'),
    ('박',          '027001234'),
    ('남궁민수',    '0212345678'),
    (NULL,          NULL)
)
SELECT
  nm            AS raw_name,
  ph            AS raw_phone,
  -- 後(마스킹): name 산식
  CASE
    WHEN nm IS NULL OR btrim(nm) = ''  THEN nm
    WHEN char_length(btrim(nm)) = 1    THEN btrim(nm)
    WHEN char_length(btrim(nm)) = 2    THEN left(btrim(nm), 1) || '*'
    ELSE left(btrim(nm), 1) || repeat('*', char_length(btrim(nm)) - 2) || right(btrim(nm), 1)
  END           AS masked_name,
  -- 後(마스킹): phone 산식
  CASE
    WHEN ph IS NULL                              THEN NULL
    WHEN regexp_replace(ph, '\D', '', 'g') = ''  THEN NULL
    ELSE right(regexp_replace(ph, '\D', '', 'g'), 4)
  END           AS masked_phone
FROM samples;
-- 기대:
--   홍길동      → 홍*동  / 5678
--   김철수      → 김*수  / 5432
--   이영        → 이*    / 1234
--   박          → 박     / 1234
--   남궁민수    → 남**수 / 5678
--   NULL        → NULL   / NULL

-- ── (B) apply 후(이 tx 내) 실 함수 반환면에 full PHI 가 남지 않는지 회귀 ──────────
--     이 dryrun 을 실제 apply 검증에 쓸 때는 up 마이그를 먼저 이 tx 안에서 실행한 뒤 아래를 돈다.
--     (여기서는 스켈레톤만 — clinic_id 는 DB-GATE 시 실 지점 UUID 로 치환)
-- SELECT customer_name, customer_phone
--   FROM public.fn_selfcheckin_today_reservations('<clinic_uuid>'::uuid, current_date);
-- 회귀 단언(supervisor 확인):
--   · customer_name 에 원본 2번째 글자 노출 0 (성/끝자 외 전부 '*')
--   · customer_phone 은 정확히 숫자 4자리(또는 NULL) — 하이픈/앞자리/국가번호 0
--   · 행 수(count) = 前 함수와 동일 (필터/정렬 무변경 → 목록 표시·매칭 회귀 0)

ROLLBACK;
