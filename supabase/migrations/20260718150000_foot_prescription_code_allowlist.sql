-- T-20260615-foot-RX-WHITELIST-FOLDERTREE — Phase 1: overlay 화이트리스트 테이블 신설 (ADDITIVE)
--
-- ★ DA 판정 SSOT: da_decision_foot_rx_whitelist_foldertree_20260718.md (verdict=Model B, approved)
--   MSG-20260718-111538-sf5g. 소스 모델 포크 해소: services(처방약 formulary 16) ↔
--   prescription_codes(EDI 카탈로그 519 live) 는 JOIN 이 아니라 UNION 의 disjoint 2-arm.
--   surface별 렌더 arm:
--     · searchRxCodes(약품검색)   = services arm → WHITELIST(9be5433)가 formulary 로 이미 제한. 정합.
--     · DrugFolderTree(약품폴더트리) = prescription_codes arm (PROCMENU-RX-UNIFY 캐노니컬).
--   → Model A(services 키셋으로 DrugFolderTree 필터) 반려 = 조인키0 fail-all(519 전량 은닉) + 캐노니컬 재이탈.
--   → Model B 채택 = 화이트리스트를 실제 렌더 arm(prescription_codes)에 앵커 = 본 overlay 테이블.
--
-- ── 왜 overlay 테이블인가 (DA 스펙 §스키마) ──────────────────────────────────────
--   ❌ prescription_codes / prescription_folders 에 mutable enabled/whitelist 컬럼 신설 반려
--      = EDI 참조 카탈로그 재싱크 시 정책 플래그 소실 위험.
--   ❌ folder 단위 플래그 반려 = coarse(승인 폴더 내 비승인 코드 도달 가능).
--   ✅ per-drug overlay 테이블 = identity 키 = prescription_codes.id (uuid PK, live 실측 2026-07-18).
--      prescription_codes 에는 별도 'code' 컬럼 없음 — EDI 코드 컬럼 = claim_code(text). FK 타깃 = id.
--
-- ── 의미론 = positive allowlist, default-deny ────────────────────────────────────
--   DrugFolderTree + (arm 확인 후)묶음처방 은
--     prescription_codes WHERE id IN (
--       SELECT prescription_code_id FROM prescription_code_allowlist
--       WHERE clinic_slug = ? AND enabled )
--   로 렌더/처방. 부재 = 차단(= "미등록약 임의 처방 차단" 의도 직역).
--   ※ 단, 본 마이그(Phase 1)는 테이블 신설만 — FE enforcement 는 feature-flag OFF ship.
--     빈 테이블 + enforcement ON = day-1 전 처방 차단(임상 위해) → 강제 금지.
--     enforcement ON flip 은 문지은 대표원장 CONTENT confirm 게이트 통과 후(Phase 2, planner 지시).
--
-- ── 게이트 ───────────────────────────────────────────────────────────────────────
--   ADDITIVE(신규 테이블, 기존 ALTER/DROP 0) + PHI 무접촉(약 카탈로그 참조, 환자정보 없음)
--   + foot-local(cross_crm_data_contract 미참조) → 대표(형) 게이트 면제(autonomy §3.1),
--   supervisor DDL-diff / MIG-GATE only.
--
-- ── RLS (prescription_codes 캐노니컬 정렬, 20260710163000) ─────────────────────────
--   READ  = is_approved_user()   TO authenticated (승인+활성 staff 전원 — DrugFolderTree 필터 조회)
--   WRITE = is_admin_or_manager() TO authenticated (임상 큐레이션 = admin/manager/director)
--
-- 멱등(idempotent): CREATE TABLE IF NOT EXISTS + CREATE POLICY 는 DROP IF EXISTS 선행. 재적용 안전.
-- Rollback: 20260718150000_foot_prescription_code_allowlist.rollback.sql (DROP TABLE).
--   ⚠ 롤백 = FE enforcement flag OFF(fail-OPEN=현행 전량 노출 복귀) + DROP TABLE.
--     fail-CLOSED 롤백(전면 차단) 절대 금지 = 전 처방 차단 = 임상 위해.
-- Dry-run: 20260718150000_foot_prescription_code_allowlist.dryrun.sql (in-txn) + scripts/dryrun_lib.mjs post-probe.
-- 적용: supervisor DDL-diff/MIG-GATE GO 후에만. blind apply 금지.

BEGIN;

CREATE TABLE IF NOT EXISTS public.prescription_code_allowlist (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_slug          text NOT NULL DEFAULT 'jongno-foot',   -- per-clinic scope (단일지점이나 future-proof)
  prescription_code_id uuid NOT NULL REFERENCES public.prescription_codes(id) ON DELETE CASCADE,  -- identity key
  enabled              boolean NOT NULL DEFAULT true,
  curated_by           uuid,          -- 큐레이션 주체(auth.users id, 감사용 loose ref — 다른 audit 컬럼 관행)
  curated_at           timestamptz,
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescription_code_allowlist_uq UNIQUE (clinic_slug, prescription_code_id)
);

COMMENT ON TABLE public.prescription_code_allowlist IS
  'T-20260615-foot-RX-WHITELIST-FOLDERTREE (DA Model B): 진료차트 약품폴더트리(DrugFolderTree=prescription_codes arm) 처방 화이트리스트 overlay. positive allowlist, default-deny — enabled 코드만 렌더/처방 허용(enforcement ON 시). per-drug(identity=prescription_code_id). Phase 1=테이블만, enforcement=FE feature-flag OFF. ON flip=문지은 CONTENT confirm 후.';
COMMENT ON COLUMN public.prescription_code_allowlist.prescription_code_id IS 'FK → prescription_codes.id (uuid). identity 키 = prescription_codes(services 아님). EDI code=prescription_codes.claim_code 병기 조회.';

ALTER TABLE public.prescription_code_allowlist ENABLE ROW LEVEL SECURITY;

-- READ: 승인+활성 staff 전원 (DrugFolderTree 필터 조회) — prescription_codes_approved_read 정렬
DROP POLICY IF EXISTS prescription_code_allowlist_approved_read ON public.prescription_code_allowlist;
CREATE POLICY prescription_code_allowlist_approved_read ON public.prescription_code_allowlist
  FOR SELECT
  TO authenticated
  USING (public.is_approved_user());

-- WRITE(ALL): admin/manager/director 임상 큐레이션 — prescription_codes_admin_all 정렬
DROP POLICY IF EXISTS prescription_code_allowlist_admin_all ON public.prescription_code_allowlist;
CREATE POLICY prescription_code_allowlist_admin_all ON public.prescription_code_allowlist
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_manager())
  WITH CHECK (public.is_admin_or_manager());

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인용):
--   SELECT to_regclass('public.prescription_code_allowlist');  -- 테이블 실존
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--     WHERE schemaname='public' AND tablename='prescription_code_allowlist' ORDER BY cmd, policyname;
--   → prescription_code_allowlist_admin_all    [ALL]    roles={authenticated} USING/CHECK: is_admin_or_manager()
--   → prescription_code_allowlist_approved_read [SELECT] roles={authenticated} USING: is_approved_user()
--   SELECT count(*) FROM public.prescription_code_allowlist;  -- Phase 1 = 0 (빈 테이블, enforcement OFF 전제)
