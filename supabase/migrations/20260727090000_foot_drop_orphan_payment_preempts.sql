-- ══════════════════════════════════════════════════════════════════
-- T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD — 착수 전 선결: orphan 선점표 정리
--   DROP orphan TABLE public.payment_preempts (DESTRUCTIVE, 단 대상=빈·미배선 orphan)
-- ══════════════════════════════════════════════════════════════════
-- 배경 (planner CORRECTION MSG-20260727-085947-6s33):
--   prod 에 선점표 2개 병존.
--     (1) pending_payment   — 07-23 DDL-BUILD(e78ebbae). NOWAIT 스펙이 지목 = ★canonical.
--                             main lineage 포함·FE/EF 4파일 배선(PaymentPlanb.tsx·usePlanbClaimStatus.ts·
--                             lib/paymentPlanb.ts·redpay-webhook EF).
--     (2) payment_preempts  — 07-25 PREEMPT-UX Phase1(a9aa8b92). 그 티켓이 superseded(→NOWAIT) 되며 orphan.
--   payment_preempts 실측(2026-07-27, ref rxlomoozakkjesdqjtvd, scripts/..._preempt-dedup_probe.mjs):
--     · row count      = 0            (Phase2 매처+FE 미배포 → 데이터 유입 0)
--     · code refs       = 0           (repo 전역 grep: FE/EF/hook 참조 0건)
--     · inbound FK      = 0           (이 테이블을 가리키는 자식 제약 0 — 참조 소비처 없음)
--     · main lineage    = ABSENT      (a9aa8b92 = 폐기 브랜치, HEAD 조상 아님)
--     · ledger          = PRESENT(20260725040000)  ← ledger·prod객체 실재 vs main파일 부재 = divergence
--   → 순소실 0 + 소비처 0 + 폐기 lineage = 파괴 위험 de-minimis 한 진성 orphan.
--
-- Migration Ledger Reconciliation 표준 준수:
--   본 forward-doc(DROP) 을 main lineage 에 추가해 3자(ledger/prod/파일) divergence 를 정본(prod)
--   기준으로 정직 수렴. ledger 20260725040000 행은 "한때 prod 적용됨" 정직 기록으로 유지하고,
--   본 20260727090000 이 그 제거를 forward 로 기록한다. DROP TABLE IF EXISTS → 신규 rebuild 경로
--   (create 마이그 부재)에서도 no-op 로 안전, 최종 상태(테이블 부재)가 양 경로 동일.
--
-- ★설계 손실 방지: payment_preempts 의 TTL(expires_at)·상태머신(failed 추가)·fail_reason·merchant_hint
--   설계 및 DA Model A 근거는 (a) git @a9aa8b92 (b) 본 마이그 .rollback.sql (c) DA CONSULT 요청문
--   에 보존됨. NOWAIT A안(자동연결 10분/선점잠금 12분) 은 canonical pending_payment 에 ADDITIVE 로
--   이식(별도 DA CONSULT 게이트) — 테이블은 정리하되 설계는 승계.
--
-- 게이트: DROP=DESTRUCTIVE prod 스키마 변경 → supervisor DDL-diff GO 후 apply(dev-foot §5).
--   본 마이그는 0-row 가드(대상에 행 존재 시 abort)로 실수 방지. rollback=full recreate(비파괴 복원).
--   dry-run(무영속)=20260727090000_..._dryrun.sql.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_exists   regclass := to_regclass('public.payment_preempts');
  v_rows     bigint   := 0;
  v_inbound  int      := 0;
BEGIN
  IF v_exists IS NULL THEN
    RAISE NOTICE '[DROP-ORPHAN] public.payment_preempts 부재 — no-op (fresh rebuild 경로 정상).';
    RETURN;
  END IF;

  -- 안전가드 1: 행 존재 시 abort (빈 orphan 전제 위반 → 데이터 유실 방지)
  EXECUTE 'SELECT count(*) FROM public.payment_preempts' INTO v_rows;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '[ABORT] payment_preempts 에 % 행 존재 — orphan 전제(0행) 위반. 수동 검토 필요.', v_rows;
  END IF;

  -- 안전가드 2: inbound FK 존재 시 abort (다른 테이블이 참조 중이면 CASCADE 파급 위험)
  SELECT count(*) INTO v_inbound
    FROM pg_constraint
   WHERE contype = 'f' AND confrelid = 'public.payment_preempts'::regclass;
  IF v_inbound <> 0 THEN
    RAISE EXCEPTION '[ABORT] payment_preempts 를 참조하는 inbound FK % 건 — 참조 소비처 존재. 수동 검토 필요.', v_inbound;
  END IF;

  DROP TABLE public.payment_preempts;   -- CASCADE 불요(inbound FK 0 확인). RLS 정책/인덱스/코멘트 동반 제거.
  RAISE NOTICE '[DROP-ORPHAN] public.payment_preempts DROP 완료 (rows=0, inbound_fk=0).';
END $$;

COMMIT;
