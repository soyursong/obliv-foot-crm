-- ══════════════════════════════════════════════════════════════════
-- T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD — pending_payment TTL/lock/failure 축 ADDITIVE
-- ══════════════════════════════════════════════════════════════════
-- DA 판정: Q1 GO(순수 ADDITIVE) — CONSULT-REPLY MSG-20260727-095625-w5rs.
--   대표게이트 면제(autonomy §3.1), supervisor DDL-diff 게이트만. cross-product blast=0(foot-local per-CRM).
-- SSOT(DDL 상세 정본): 티켓 T-20260727-foot-REDPAY-PLANB-NOWAIT-TTL-DA-CONSULT §DA CONSULT-REPLY.
-- 실측 근거(apply 전): prod pending_payment = 0-row(backfill 이슈 없음), CHECK conname='pending_payment_status_check',
--   old def = CHECK (status = ANY (ARRAY['open','matched','expired','cancelled'])).
--
-- ── 설계 근거 (DA CONSULT-REPLY §Q1) ──────────────────────────────────
--   ① expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '10 minutes'
--        · app-set = created_at + interval '10 min' (선점 등록 시각 기준), DEFAULT = fallback(앱 누락 대비).
--        · TTL 만료 판정: now() >= expires_at → 배치가 status='expired' 전이.
--   ② locked_until TIMESTAMPTZ (nullable) — DA 명명 채택(preempt_locked_at 기각).
--        · app-set = created_at + interval '12 min'. 잠금 판정: now() < locked_until (매칭 워커 선점 경합 방지).
--        · 기존 부분유니크 UNIQUE(clinic_id, customer_id) WHERE status='open' 과 별개 축·병존(중복선점 방지와 무관).
--   ③ status CHECK widen: 'failed' 1값 추가. enum 최종 = open|matched|expired|failed|cancelled ('pending' rename 금지).
--        · widen only → NOT VALID/VALIDATE 불요, 단일 txn.
--        · 의미: failed = 시스템/매칭 실패(웹훅 N·승인거절·tie-break) — 자동경로 실패.
--                cancelled = 직원 중도취소(사람 의도중단) — failed 와 구분.
--        · ★Lovable CHECK 규율: FE 는 5값만 emit 정합 의무.
--   ④ fail_reason TEXT NULL — status='failed' 일 때만 기입(app-enforce 충분, DB 제약 불요).
--
-- ── 불변식 보존 (DA §Model A / §550 / §789) ───────────────────────────
--   · 매칭 방향 = redpay_raw_transactions 역참조 유지(CONFIRM). matched_payment_id→payments 신설 금지(§789 이중화 ban).
--   · payment 무생성 until match = §550 Model A 불변식 보존(pending_payment 은 payments write 안 함, 매출 grain 아님).
--   · expected_amount 는 매출뷰 read 금지(선점=예정) — COMMENT 부착.
--
-- ── ADDITIVE 계약 ─────────────────────────────────────────────────────
--   신규: COLUMN expires_at / locked_until / fail_reason + CHECK widen(1값 추가). 파괴적 변경 0.
--   무접촉: payments / redpay_raw_transactions / customers / check_ins / clinics 컬럼·제약·RLS·원장.
--           pending_payment 의 기존 컬럼·인덱스·트리거·RLS·부분유니크 원본 미변경.
--   멱등: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS → ADD CONSTRAINT (재실행 무해).
--   Rollback: 20260727100000_foot_redpay_planb_pending_payment_ttl.rollback.sql (DROP COLUMN×3 + old CHECK 복원).
--   Dry-run(무영속): 20260727100000_foot_redpay_planb_pending_payment_ttl.dryrun.mjs (canonical dryrun_lib 러너).
--
-- risk: GO(ADDITIVE, 컬럼 순증 + CHECK widen, prod 0-row). db_only → E2E spec 면제, MIG-GATE evidence 4필드 의무.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. TTL — expires_at (NOT NULL DEFAULT fallback; app-set = created_at + 10 min) ──
ALTER TABLE public.pending_payment
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes');

-- ── 2. lock — locked_until (nullable; app-set = created_at + 12 min, 잠금 판정 now() < locked_until) ──
ALTER TABLE public.pending_payment
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- ── 3. fail_reason — TEXT NULL (status='failed' 시에만 기입, app-enforce) ──
ALTER TABLE public.pending_payment
  ADD COLUMN IF NOT EXISTS fail_reason TEXT;

-- ── 4. status CHECK widen — 'failed' 추가 (widen only, 단일 txn) ──
ALTER TABLE public.pending_payment
  DROP CONSTRAINT IF EXISTS pending_payment_status_check;
ALTER TABLE public.pending_payment
  ADD CONSTRAINT pending_payment_status_check
  CHECK (status IN ('open','matched','expired','failed','cancelled'));

-- ── 5. COMMENT ────────────────────────────────────────────────────────
COMMENT ON COLUMN public.pending_payment.expires_at IS
  'TTL 만료 예정 시각. app-set = created_at + interval ''10 minutes'' (DEFAULT 는 앱 누락 대비 fallback). '
  '판정: now() >= expires_at → 배치가 status=expired 전이. T-20260727-foot-REDPAY-PLANB-NOWAIT (ADDITIVE).';
COMMENT ON COLUMN public.pending_payment.locked_until IS
  '매칭 워커 선점 잠금 만료 시각(nullable). app-set = created_at + interval ''12 minutes''. '
  '잠금 판정: now() < locked_until. 기존 부분유니크(open 중복선점 방지)와 별개 축·병존.';
COMMENT ON COLUMN public.pending_payment.fail_reason IS
  'status=failed 사유(nullable). 웹훅 N·승인거절·tie-break 등 시스템/매칭 실패 시에만 기입(app-enforce).';
COMMENT ON COLUMN public.pending_payment.status IS
  'open=선점 대기 / matched=raw 매칭 완료 / expired=TTL 만료(배치) / failed=시스템·매칭 실패(웹훅 N·승인거절·tie-break) / cancelled=직원 중도취소(사람 의도중단). '
  '★Lovable CHECK 규율: FE 는 5값만 emit.';
COMMENT ON COLUMN public.pending_payment.expected_amount IS
  '★ 선점 매칭 키(예상금액, 원 단위 정수). raw amount 와 대조. '
  '⚠ 매출뷰 read 금지 — 선점=예정(payments write 안 함, 매출 grain 아님). 실 매출은 payments 파이프 계승(§550 Model A).';

COMMIT;
