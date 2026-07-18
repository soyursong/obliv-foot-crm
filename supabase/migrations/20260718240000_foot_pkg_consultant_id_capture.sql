-- ════════════════════════════════════════════════════════════════════════════
-- T-20260717-foot-PKG-CONSULTANT-ID-ATTR-CAPTURE  (P2, foot, db_change:true)
-- packages.consultant_id — 패키지 상담사 귀속 "결정화(deterministic capture)"
--   신규 nullable FK → staff(id) + 생성시점 캡처 트리거.  [PHASE 1 : 컬럼 + 캡처경로]
--
-- DA CONSULT-REPLY: DA-REPLY-T-20260717-foot-PKG-CONSULTANT-ID-ATTR-CAPTURE.md
--   verdict = GO(ADDITIVE) 조건부(BINDING 4종). supervisor DDL-diff만, 대표 게이트 불요.
--   ★ 위험은 스키마가 아니라 write-source 의미. 부모 티켓 BINDING-1(created_by 귀속 금지) 계승.
--
-- ─── AC-A (write-source, BINDING-1 계승·최우선) ────────────────────────────────
--   consultant_id 의 권위 소스 = 매출귀속 앵커 상담의 check_ins.consultant_id
--     (consultant_id NOT NULL + status_transitions.to_status='consultation').
--   packages.created_by / auth.uid() / 세션 로그인 staff / 도파민·TM·cue_card owner
--     자동스탬프 = 캡처 소스로 절대 금지(부모가 방금 제거한 구조붕괴 경로 재도입 금지).
--   상담 컨텍스트 부재 시 NULL(correct-by-default) — 로그인 사용자 대체 금지.
--
-- ─── AC-B (이관 상속) ──────────────────────────────────────────────────────────
--   transfer_package_atomic 는 비-판매 이벤트 → 수령 패키지.consultant_id = 원본
--     (transferred_from).consultant_id 상속(INHERIT). 이관 처리자 캡처 금지. 원본 NULL이면 NULL.
--   구현: 이관 INSERT 는 transferred_from IS NOT NULL 로 식별 → 트리거가 원본에서 상속(앵커 캡처 안함).
--
-- ─── 왜 트리거인가 (설계 노트) ─────────────────────────────────────────────────
--   · 캡처 소스를 DB 레벨에서 앵커 check_in 으로 강제 → FE 가 실수로 created_by/세션staff 를
--     쓸 경로가 원천 차단(AC-A 불가침). 두 INSERT 사이트(CustomerChartPage submit /
--     submitWithTemplate) + transfer + 미래 경로 전부 단일 규칙으로 커버.
--   · "결정화" = 생성시점에 앵커를 결정적으로 고정 → heuristic(pkg_attr) 의 "동일고객 최근접
--     상담" 재계산 불안정성(추후 다른 상담사 상담이 끼면 귀속 흔들림)을 제거.
--   · 소스는 heuristic 과 동일 권위(check_in.consultant_id), 시점만 창구재계산→창구고정.
--     → 백필(heuristic 스냅샷)과 정렬 → RPC 전환(Phase 2) PARITY 100% by construction.
--
-- 성격: ADDITIVE — 신규 nullable 컬럼, 기존행 재정의 0, NOT NULL/CHECK/default 강제 없음,
--   기존 read/RPC(heuristic 유지) 무영향, ON DELETE SET NULL(원장 무접점). 회귀 0.
-- 분리 배포: Phase 1(본 마이그 = 컬럼+캡처) + 백필 → Phase 2(foot_stats_consultant RPC 전환,
--   PARITY 100% 증명 전제)는 후속 게이트로 분리(AC-D, DA 권고).
--
-- DB : rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 롤백 : 20260718240000_foot_pkg_consultant_id_capture.rollback.sql (= DROP COLUMN/TRIGGER/FN)
-- 표준 : Migration Ledger Reconciliation / Migration Dry-Run No-Persistence Protocol
-- author: dev-foot / 2026-07-18
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. packages.consultant_id 컬럼 (ADDITIVE, 멱등)
--    nullable(백필 전 전량 NULL) · ON DELETE SET NULL(staff 삭제 시 귀속키만 소실=안전실패).
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS consultant_id UUID
    REFERENCES public.staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.packages.consultant_id IS
  '패키지 매출귀속 상담사(staff.id) — 생성시점 결정화 캡처. 소스=앵커 상담 check_ins.consultant_id(consultant_id NOT NULL + to_status=consultation, created_at 최근접). created_by/세션staff 캡처 금지(BINDING-1). 이관=원본 상속. 상담컨텍스트 부재=NULL. T-20260717-foot-PKG-CONSULTANT-ID-ATTR-CAPTURE.';

CREATE INDEX IF NOT EXISTS idx_packages_consultant_id
  ON public.packages(consultant_id) WHERE consultant_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- 2. 캡처 트리거 함수 — set_package_consultant_id()
--    BEFORE INSERT. consultant_id 결정 규칙(우선순위):
--      (0) 명시 제공값(NEW.consultant_id NOT NULL) → 존중(멱등/미래 명시경로 보호).
--      (1) 이관(transferred_from NOT NULL) → 원본.consultant_id 상속. 앵커 캡처 안함(원본 NULL이면 NULL).
--      (2) 신규/재구매 → 동일 고객의 앵커 상담(consultant_id NOT NULL + to_status=consultation) 中
--          created_at 최근접 1건의 consultant_id 캡처. (= pkg_attr heuristic 동일 로직·동일 권위)
--      (3) 앵커 부재 → NULL(correct-by-default). 로그인 사용자/created_by 대체 절대 금지.
--    ★ SECURITY DEFINER: RLS 가 앵커 check_in 을 숨겨 잘못된 NULL 을 유발하지 않도록 결정성 보장.
--      쓰기는 오직 삽입되는 행의 NEW.consultant_id 뿐(권한 상승/데이터 유출 없음).
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_package_consultant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_at timestamptz := COALESCE(NEW.created_at, now());  -- default now() 는 BEFORE 트리거 前 적용됨(안전 COALESCE).
BEGIN
  -- (0) 명시 제공값 존중 (멱등·명시경로 보호)
  IF NEW.consultant_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- (1) 이관 = 비-판매 이벤트 → 원본 상속(원본 NULL이면 NULL). 앵커 캡처 안함.
  IF NEW.transferred_from IS NOT NULL THEN
    SELECT src.consultant_id INTO NEW.consultant_id
    FROM public.packages src
    WHERE src.id = NEW.transferred_from;
    RETURN NEW;
  END IF;

  -- (2) 신규/재구매 = 앵커 상담 check_in.consultant_id 캡처 (pkg_attr heuristic 동형).
  SELECT ci.consultant_id INTO NEW.consultant_id
  FROM public.check_ins ci
  JOIN public.status_transitions st ON st.check_in_id = ci.id
  WHERE ci.clinic_id = NEW.clinic_id
    AND ci.customer_id = NEW.customer_id
    AND ci.consultant_id IS NOT NULL
    AND st.to_status = 'consultation'
  ORDER BY
    (ci.checked_in_at <= v_created_at) DESC,                                  -- created_at 直前 우선
    ABS(EXTRACT(EPOCH FROM (v_created_at - ci.checked_in_at))) ASC,           -- 최근접
    ci.id                                                                     -- tiebreak(결정성)
  LIMIT 1;

  -- (3) 앵커 부재 → NEW.consultant_id 는 NULL 그대로(correct-by-default). 대체 금지.
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_package_consultant_id() IS
  '패키지 생성시점 상담사 귀속 결정화 캡처(BEFORE INSERT). 소스=앵커 상담 check_ins.consultant_id(pkg_attr heuristic 동형). 이관=원본 상속. 앵커부재=NULL. created_by/세션staff 캡처 금지(AC-A/BINDING-1). T-20260717-foot-PKG-CONSULTANT-ID-ATTR-CAPTURE.';

DROP TRIGGER IF EXISTS trg_pkg_consultant_capture ON public.packages;
CREATE TRIGGER trg_pkg_consultant_capture
  BEFORE INSERT ON public.packages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_package_consultant_id();

-- ──────────────────────────────────────────────────────────────
-- PostgREST 스키마 캐시 리로드 (신규 컬럼 즉시 노출)
-- ──────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;
