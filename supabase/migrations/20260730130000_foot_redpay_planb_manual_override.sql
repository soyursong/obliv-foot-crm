-- ══════════════════════════════════════════════════════════════════
-- T-20260730-foot-REDPAY-PLANB-MANUALPAY-PREEMPT-EXCLUDE — 수기입력 시점 선점표 매칭제외 (ADDITIVE)
-- ══════════════════════════════════════════════════════════════════
-- 부모: T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD(deployed, 플래그 VITE_PAYMENT_PLANB OFF).
--   NOWAIT 결제페이지 타임아웃 후 담당자가 [수기 입력하러 가기] 클릭 시, 연관 pending_payment(선점표)를
--   웹훅 자동매칭 루프(match-cron / EF redpay-planb-match)에서 즉시 제외 → 지연 도착 웹훅(레드페이 재전송)의
--   자동연결로 인한 이중기록 창을 봉인.
--
-- ── DB 판정 대기 (MIG-GATE) ────────────────────────────────────────────
--   ⚠ da_consult_required=true. 본 마이그는 순수 ADDITIVE(CHECK widen 1값 + 컬럼 순증 1)이나,
--     §S2.4 데이터 정책 자문 게이트 대상 → DA CONSULT 판정(발번=planner) 선행 후 supervisor DDL-diff 게이트.
--     대표게이트 면제(autonomy §3.1, ADDITIVE·foot-local per-CRM·cross-product blast=0).
--   실측 근거(apply 전 확인 의무): prod pending_payment 현행 CHECK conname='pending_payment_status_check',
--     current def = CHECK (status IN ('open','matched','expired','failed','cancelled')) [TTL 마이그 20260727100000 계승].
--
-- ── 설계 근거 ──────────────────────────────────────────────────────────
--   ① status CHECK widen: 'manual_override' 1값 추가. enum 최종 =
--        open | matched | expired | failed | cancelled | manual_override ('pending' rename 금지, widen only).
--        · widen only → NOT VALID/VALIDATE 불요, 단일 txn.
--        · 의미: manual_override = 담당자가 [수기 입력하러 가기]로 수기입력 폴백에 진입 → 이 선점은
--                자동매칭 대상에서 제외(수기로 대체 기록). 감사상 아래와 명확히 구분:
--                  - expired         = 단순 TTL 만료(사람 개입 없음)
--                  - cancelled       = 직원 중도취소(사람 의도중단, 결제 자체를 안 함)
--                  - manual_override = 수기입력으로 대체(결제는 있었고 사람이 수기로 기록) ← 신규
--                → 현장(최필경 총괄) 요구 "user-cancel 과 감사상 구분 가능" 충족.
--        · ★Lovable CHECK 규율: FE 는 6값만 emit 정합 의무(manual_override 는 exclude 경로에서만 emit).
--   ② excluded_at TIMESTAMPTZ NULL — manual_override 전이 시각(감사). app-set(제외 실행 시각).
--        · updated_at(트리거)은 이후 어떤 UPDATE 로도 갱신되지만 excluded_at 은 '제외 확정 시각'을 불변 보존.
--        · nullable — manual_override 아닌 행은 NULL.
--
-- ── 불변식 보존 (§550 Model A / §789 / 대원칙 §2) ──────────────────────
--   · payments 무접점: 본 마이그는 pending_payment 상태축만 확장, payments write/참조 신설 0(§550 Model A 유지).
--   · match EF 는 이미 status='open' 만 매칭 → manual_override(비-open)는 기존 필터로 자동 제외(EF 로직 무변경).
--   · 기존 결제화면·수기입력 UI 불변(대원칙 §2) — 본 마이그는 상태값·컬럼 순증만(FE emit 경로는 신규 exclude 만).
--
-- ── ADDITIVE 계약 ─────────────────────────────────────────────────────
--   신규: CHECK widen(1값) + COLUMN excluded_at(nullable). 파괴적 변경 0.
--   무접촉: payments / redpay_raw_transactions / customers / check_ins / clinics 컬럼·제약·RLS·원장.
--           pending_payment 기존 컬럼·인덱스·트리거·RLS·부분유니크 원본 미변경.
--   멱등: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS → ADD CONSTRAINT (재실행 무해).
--   Rollback: 20260730130000_foot_redpay_planb_manual_override.rollback.sql (DROP COLUMN + old CHECK 복원).
--   Dry-run(무영속): 20260730130000_foot_redpay_planb_manual_override.dryrun.sql (단일 DO 블록 + RAISE unwind).
--
-- risk: GO(ADDITIVE, CHECK widen 1값 + 컬럼 순증 1, prod 소비처=신규 exclude 경로만). MIG-GATE evidence 4필드 의무.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. status CHECK widen — 'manual_override' 추가 (widen only, 단일 txn) ──
ALTER TABLE public.pending_payment
  DROP CONSTRAINT IF EXISTS pending_payment_status_check;
ALTER TABLE public.pending_payment
  ADD CONSTRAINT pending_payment_status_check
  CHECK (status IN ('open','matched','expired','failed','cancelled','manual_override'));

-- ── 2. excluded_at — TIMESTAMPTZ NULL (manual_override 전이 시각, app-set) ──
ALTER TABLE public.pending_payment
  ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ;

-- ── 3. COMMENT ────────────────────────────────────────────────────────
COMMENT ON COLUMN public.pending_payment.status IS
  'open=선점 대기 / matched=raw 매칭 완료 / expired=TTL 만료(배치) / failed=시스템·매칭 실패(웹훅 N·승인거절·tie-break) / '
  'cancelled=직원 중도취소(사람 의도중단, 결제 자체 미실행) / '
  'manual_override=수기입력 폴백 진입으로 자동매칭 제외(결제는 있었고 사람이 수기로 대체 기록) — cancelled 와 감사상 구분. '
  '★Lovable CHECK 규율: FE 는 6값만 emit. T-20260730-foot-REDPAY-PLANB-MANUALPAY-PREEMPT-EXCLUDE (ADDITIVE).';
COMMENT ON COLUMN public.pending_payment.excluded_at IS
  'manual_override 전이(수기입력 폴백 진입) 시각(nullable, app-set). match-cron 자동매칭 제외 확정 시점(감사). '
  'updated_at 과 달리 이후 UPDATE 로 갱신되지 않음(제외 확정 시각 불변 보존).';

COMMIT;
