-- ══════════════════════════════════════════════════════════════════
-- T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD — TTL 축소 fold (DEFAULT 정렬)
--   expires_at 컬럼 DEFAULT: now()+interval '10 minutes' → now()+interval '5 minutes'
-- ══════════════════════════════════════════════════════════════════
-- 근거: 현장(최필경 총괄, 2026-07-29 MSG-ku9c) TTL 축소 확정 —
--   자동연결 유효 10분→5분 / 선점잠금 12분→6분 (7/28 실측 최대 4분5초 + 레드페이 재시도 1/5/30분 +
--   소액 반복거래 '같은 금액' 충돌창 최소화). 티켓 §TTL 재확인 fold.
--
-- ── 정책 단일소스 = app 상수 (DA 명시) ──────────────────────────────
--   · 자동연결(auto-connect) = created_at + interval '5 minutes'  ← app enforcement (정책 단일소스)
--   · 선점잠금(locked_until) = created_at + interval '6 minutes'  ← app enforcement (정책 단일소스)
--   · 본 DEFAULT = 앱이 expires_at 를 누락했을 때의 fallback(안전망)일 뿐, 판정 권위 아님.
--   · SSOT(app 상수): src/lib/redpayPlanbTtl.ts (REDPAY_PLANB_TTL). FE/EF/cron 은 이 상수를 유일 소스로 소비.
--   · locked_until 은 DEFAULT 없음(nullable, app-set only) → 본 마이그는 expires_at DEFAULT 만 정렬.
--
-- ── DA 재자문 불요 (값 조정, ADDITIVE 계약 내) ──────────────────────
--   · CONSULT-REPLY MSG-20260727-095625-w5rs blessed ADDITIVE 계약(expires_at/locked_until/fail_reason
--     + CHECK widen)의 값 조정 — 컬럼/타입/제약/CHECK 구조 무변경. DA 명시 "정책 단일소스=app, DEFAULT=fallback".
--   · supervisor DDL-diff 게이트만 경유(대표게이트 면제, autonomy §3.1).
--
-- ── non-destructive 계약 ──────────────────────────────────────────
--   · SET DEFAULT 만 변경 = 컬럼 재작성 없음(0-row, 데이터 이동 없음). NOT NULL/타입/CHECK/인덱스/RLS/트리거 무변경.
--   · 기존 행 미영향(DEFAULT 는 향후 INSERT 시 컬럼 미지정분에만 적용). prod pending_payment = 0-row(backfill 이슈 없음).
--   · 무접촉: payments/redpay_raw_transactions/customers/check_ins/clinics + pending_payment 기타 컬럼·제약 전부.
--   · 멱등: SET DEFAULT 는 절대값 지정 → 재실행 무해(idempotent, 최종상태 동일).
--   · Rollback: 20260729120000_..._5min.rollback.sql (DEFAULT 를 10 minutes 로 복원).
--   · Dry-run(무영속): 20260729120000_..._5min.dryrun.mjs (canonical dryrun_lib 러너, post-probe '5 minutes' 미영속 실측).
--
-- risk: GO(비파괴 DEFAULT 값 조정, prod 0-row). db_only → E2E spec 면제, MIG-GATE evidence 4필드 의무.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ── expires_at DEFAULT 정렬 (10 min → 5 min; fallback only, app 상수가 정책 단일소스) ──
ALTER TABLE public.pending_payment
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '5 minutes');

-- ── COMMENT 갱신 (5분 fold 반영) ──
COMMENT ON COLUMN public.pending_payment.expires_at IS
  'TTL 만료 예정 시각. app-set = created_at + interval ''5 minutes'' (2026-07-29 TTL 축소 fold; DEFAULT 는 앱 누락 대비 fallback). '
  '판정: now() >= expires_at → 배치가 status=expired 전이. 정책 단일소스=app 상수 src/lib/redpayPlanbTtl.ts. '
  'T-20260727-foot-REDPAY-PLANB-NOWAIT (ADDITIVE 값조정).';
COMMENT ON COLUMN public.pending_payment.locked_until IS
  '매칭 워커 선점 잠금 만료 시각(nullable, DEFAULT 없음·app-set only). app-set = created_at + interval ''6 minutes'' (2026-07-29 축소 fold). '
  '잠금 판정: now() < locked_until. 기존 부분유니크(open 중복선점 방지)와 별개 축·병존.';

COMMIT;
