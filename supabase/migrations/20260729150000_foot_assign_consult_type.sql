-- T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN — 배정 상담유형 드롭다운(4종) 저장모델 ADDITIVE 스키마
--
-- ── 착수 근거 ──
--   상담·치료사 배정(오늘 배정 현황 / 금일 배분 이력)에서 [상담대기] 건 배정 시, 실장이 담당 옆
--   "상담유형" 드롭다운(초진/재진/당일재상담/대리상담, App default=초진)을 직접 선택해 배정 초진/재진
--   카운트를 자동 365-recency 판정 대신 수동 확정한다. 그 선택값(스태프 assertion) 자체를 SSOT 입력으로
--   보존해야 하므로 배정 레코드(check_ins)에 신설 단일 enum 1컬럼을 ADDITIVE nullable 로 추가한다.
--
--   DA 판정(da_decision_foot_assign_consulttype_dropdown_20260726.md, CONSULT-REPLY MSG-20260726-165130-l6vd):
--     Q1 = 단일 네임스페이스 enum `assignment_consult_type` {초진|재진|당일재상담|대리상담} (기존 2축 권고 SUPERSEDE).
--          bare `consult_type`/`visit_type` 금지(후자는 이미 자동 365-recency 축이 점유, 계약 §선택컬럼 L121).
--     Q3 = ADDITIVE-safe YES, db_change=true, DDL-diff 대상(deploy-precheck C11/C12).
--          컬럼 DEFAULT = **NULL**(NOT '초진') — DB-level DEFAULT '초진'은 전 과거행 소급 assert=백필 → 부모
--          "전향적만, 백필 없음" 위반. 초진 default 는 App/UI 층(신규 배정 시 드롭다운 초진 pre-select).
--          과거행 NULL = pre-feature/미분류 → 카운터 view 가 제외(전향 window 자연 배제).
--     저장표준 = body care_category 선례(TEXT + named CHECK). system_codes 불채택(foot 인프라 정합).
--
-- ── 카운터 매핑 (총괄 SSOT, 파생 view/앱층에서 소비 — 본 마이그는 저장만) ──
--   배정(초진) = COUNT(assignment_consult_type = '초진')
--   배정(재진) = COUNT(assignment_consult_type IN ('재진','대리상담'))
--   당일재상담 = 위 축 전부 제외.  NULL(미분류) = 전부 제외.
--
-- ── 매출귀속 RED LINE ──
--   본 마이그는 배정 성격(운영 카운터) 컬럼만 추가. customers.assigned_consultant_id(매출귀속 유일 드라이버) /
--   check_ins.consultant_id(배정 포인터) / payments / service_charges 어디도 write·변경 0. 인센티브 분모 무접촉
--   (DA Q4: 운영축 격리, 인센티브 연결 의도 시 별도 comp-policy 게이트).
--
-- 멱등: ADD COLUMN IF NOT EXISTS + CHECK DO-guard(pg_constraint 부재 시에만 ADD). DEFAULT 없음(순수 nullable)
--       → 기존 전 행 NULL(미분류)=회귀0. 파괴적 변경·RENAME·권한축소 0. check_ins 기존 RLS 상속(신규 정책 불요).
-- Rollback: 20260729150000_foot_assign_consult_type.rollback.sql
-- Dry-run:  20260729150000_foot_assign_consult_type.dryrun.mjs (무영속 sentinel)
-- 운영 적용: dev-foot 직접 pg 적용(scripts/apply_20260729150000_foot_assign_consult_type.mjs --apply) + supervisor DDL-diff QA 게이트 선행.

BEGIN;

-- ── 배정 상담유형(수동 선택, 운영 카운터 SSOT 입력) ─────────────────────────────
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS assignment_consult_type TEXT;
COMMENT ON COLUMN public.check_ins.assignment_consult_type IS
  'T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN: 배정 시 실장이 선택하는 상담유형(운영 카운터 SSOT 입력). NULL=미분류(pre-feature/과거행, 카운터 제외), ''초진''/''재진''/''당일재상담''/''대리상담''. 배정(초진)=초진, 배정(재진)=재진·대리상담, 당일재상담·NULL=전부 제외. App default=초진(신규 배정 pre-select), DB DEFAULT 없음(백필 금지). 자동 365-recency 임상 축(visit_type)과 독립 — 매출귀속(assigned_consultant_id) 무접촉.';

-- ── named CHECK (오타·잡값 차단, care_category 선례 mirror). 멱등 DO-guard. ──
DO $assign_consult_type_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_check_ins_assignment_consult_type'
       AND conrelid = 'public.check_ins'::regclass
  ) THEN
    ALTER TABLE public.check_ins
      ADD CONSTRAINT chk_check_ins_assignment_consult_type
      CHECK (assignment_consult_type IS NULL
             OR assignment_consult_type IN ('초진', '재진', '당일재상담', '대리상담'));
  END IF;
END
$assign_consult_type_check$;

COMMIT;
