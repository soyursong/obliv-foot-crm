-- T-20260808-foot-PENCHART-INSURANCE-SPLIT-PHASE2 — packages 헤더 급여/비급여 회차 split
--   DA SSOT: agents/docs/da_replies/da_decision_foot_penchart_autorecord_visitlog_2chart_20260809.md
--            (committed cd54a9a2893, PRIMARY A 채택)
--
-- change-class = ADDITIVE (nullable 컬럼 2종 + NOT VALID partial CHECK). table rewrite 0 · row mutation 0.
--   · DA CONSULT-REPLY GO(MSG-20260809-104207-o18q) — phase2 dependency 해소·approved.
--   · §3.1 CEO 파괴게이트 면제(YES) — change_class=ADDITIVE (reporter=김주연 총괄 canon-conformance).
--
-- ■ 신규 컬럼 (packages 헤더 grain, INTEGER nullable forward-only DEFAULT NULL):
--   · covered_sessions     — 급여(가) 회차 수
--   · noncovered_sessions  — 비급여(비) 회차 수
--   write-path = 스태프 패키지 판매/등록시 수동 입력(performed_by write 동형·추론 0).
--   표시(데이터 leg 본 티켓) = packages 헤더에 값 착지. 펜차트 '12회 (비11/가1)' ⚠표시 leg 는
--     REWORK(T-20260809-foot-PENCHART-EDITABLE-INCHARTFORM-REWORK) 편집형 폼에 별도 착지(시퀀싱).
--
-- ■ VG1 (dispositive, census 확증):
--   package_sessions = per-deduction 생성(소진시점 status='used' INSERT·session_number=count+1).
--     · src/pages/Packages.tsx:2038 / CustomerChartPage.tsx:4335,5224,5275,5420 / CheckInDetailSheet.tsx:2563
--       — 전 INSERT 사이트가 차감(소진) 경로. 판매(packages INSERT) 시 sessions full-bundle 선생성 없음.
--     · package_sessions.status DEFAULT 'used', enum=(used,cancelled,refunded) — 'pending'/'unused' 부재.
--   ⇒ 미소진 회차엔 row 자체가 부재 → per-session flag(package_sessions)로 covered/noncovered 표현 불가
--     (DA Q1 gap 재현) ⇒ packages 헤더 2컬럼 = covered/noncovered 유일 canonical placement (A CONFIRMED).
--
-- ■ VG3 (firewall): 신규 count 컬럼 → 매출/매출 split read-path 0.
--   매출 급여/비급여 = service_charges only (Revenue Insurance Split SSOT §2-2 불변). 본 컬럼은
--   판매시 회차구성 메타 — 매출 산식(src/lib/mtmSales.ts: payments/service_charges/closing_manual_payments)
--   에 절대 read-coupling 하지 않는다. 데이터 경로 커플링 금지.
--
-- ■ VG4: nullable forward-only. 기존 packages 행 backfill 0 (DEFAULT NULL·둘 다 NULL 착지).
--
-- 멱등: ADD COLUMN IF NOT EXISTS · ADD CONSTRAINT 는 존재검사 후 조건부(DO 블록).
-- 롤백: 20260809140000_foot_packages_insurance_session_split.rollback.sql (DROP CONSTRAINT + DROP COLUMN×2 대칭)
-- 무영속 dry-run: 20260809140000_foot_packages_insurance_session_split.dryrun.sql
-- ⚠ prod apply = supervisor DB-GATE GO-token 후 (dev prod SERVICE_ROLE 미보유). applied_at 은 GO-token 후 기입.

BEGIN;

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS covered_sessions    INTEGER,
  ADD COLUMN IF NOT EXISTS noncovered_sessions INTEGER;

COMMENT ON COLUMN public.packages.covered_sessions IS
  '급여(가) 회차 수. 스태프 판매시 수동입력. NULL=미분류. VG3: 매출 split read-path 0 (매출 급여/비급여 = service_charges only).';
COMMENT ON COLUMN public.packages.noncovered_sessions IS
  '비급여(비) 회차 수. 스태프 판매시 수동입력. NULL=미분류. VG3: 매출 split read-path 0.';

-- VG2: partial CHECK — 둘 중 하나라도 NULL 이거나, (둘 다 입력 시) 합=total_sessions.
--   기존 행(둘 다 NULL) 무손상. NOT VALID = 기존행 재검증 스킵(backfill/scan 0·forward-only 봉인).
--   신규 INSERT/UPDATE 는 항상 검사됨(forward 강제).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.packages'::regclass
       AND conname = 'packages_insurance_split_sum_chk'
  ) THEN
    ALTER TABLE public.packages
      ADD CONSTRAINT packages_insurance_split_sum_chk
      CHECK (
        covered_sessions IS NULL
        OR noncovered_sessions IS NULL
        OR covered_sessions + noncovered_sessions = total_sessions
      ) NOT VALID;
    RAISE NOTICE 'PENCHART_INSURANCE_SPLIT: packages_insurance_split_sum_chk 추가(NOT VALID)';
  ELSE
    RAISE NOTICE 'PENCHART_INSURANCE_SPLIT: constraint 이미 존재 (멱등 no-op)';
  END IF;
END $$;

COMMIT;
