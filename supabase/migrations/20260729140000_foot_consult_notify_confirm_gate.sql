-- T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY — 금일 배분 이력 [확정]→상담대기방 발송 게이트 (변경2 상태모델) ADDITIVE 스키마
--
-- ── 착수 근거 ──
--   변경2(SENDCONFIRM 계승): 금일 배분 이력 각 행 [확정] 버튼 → 클릭 시에만 상담대기방(C0B4HEC9SHH) 발송.
--   발송상태를 서버 지속(새로고침·다중 사용자 멱등)해야 이중발송을 구조적으로 차단 → 상담 배정(check_ins.consultant_id)
--   건별 발송상태 컬럼을 check_ins 에 ADDITIVE nullable 로 추가한다(Option A).
--   DA CONSULT 1차 게이트(MSG-20260729-140858-yxxi / da_decision_foot_confirm_notify_checkins_additive_20260729.md):
--     GO — Option A + refinement 4. ADDITIVE nullable → autonomy §3.1(대표게이트 불요, supervisor DDL-diff).
--
-- ── DA refinement 반영 (R1/R2 강제, R3/R4 권장 — 전부 채택) ──
--   R1: consult_notify_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
--       (클릭 actor=앱유저 → staff(id) 아님. assignment_actions.created_by 규약 정합).
--   R2: named CHECK chk_check_ins_consult_notify_status
--       (consult_notify_status IS NULL OR IN ('sending','sent')) — 오타·잡값 차단(§1-2 care_category mirror).
--   R3: 3-state NULL→'sending'(claim)→'sent'(post 성공). claim↔Slack post 사이 크래시 시 false-'sent'
--       silent-loss 창을 'sending' 중간상태로 제거 → stuck-'sending' sweep/재확정 복구 가능.
--   R4: consult_notify_slack_ts TEXT — Slack ts 보존(향후 thread/update/dedup+forensics).
--
-- ── 상태 모델(멱등, 3-state) ──
--   consult_notify_status: NULL=미확정, 'sending'=claim(발송 진행), 'sent'=발송완료.
--   멱등: send-consult-notify EF 가 조건부 UPDATE(WHERE id=? AND consult_notify_status IS NULL) rows-affected=1 일 때만
--         claim('sending') → Slack chat.postMessage 성공 시 'sent'+slack_ts 승격.
--         0이면 이미 claim/발송 → skip(재클릭·새로고침·다중사용자 이중발송 차단). Slack 실패 시 status 롤백(NULL) → 재시도.
--   grain = 상담(consult) 배정 = check_ins 1행당 consultant_id 1건 → per-check_in 컬럼으로 충분(1:1).
--
-- ── 매출귀속 RED LINE (INV-1) ──
--   본 마이그는 발송상태 컬럼만 추가. customers.assigned_consultant_id(매출귀속 유일 드라이버) / check_ins.consultant_id(배정 포인터)
--   어디도 write/변경 0. 배정 로직 불변. (DA Q3: consult_notify_by=클릭 actor ≠ assigned_consultant_id 직교, 역추론 금지.)
--
-- 멱등: ADD COLUMN IF NOT EXISTS + 제약 DO-guard(pg_constraint 부재 시에만 ADD). DEFAULT 없음(순수 nullable) → 기존 전 행 NULL(미확정)=회귀0.
-- 파괴적 변경·RENAME·권한축소 0. check_ins 기존 RLS 상속(신규 정책 불요, write 는 service_role EF 경유).
-- Rollback: 20260729140000_foot_consult_notify_confirm_gate.rollback.sql
-- Dry-run: 20260729140000_foot_consult_notify_confirm_gate.dryrun.mjs (무영속 sentinel)
-- 운영 적용: dev-foot 직접 pg 적용(메모리 'dev-foot DB 마이그레이션 직접 실행') + supervisor DDL-diff QA 게이트 선행.

BEGIN;

-- ── 상담 배정 발송상태(미확정/발송중/발송됨) ────────────────────────────────
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS consult_notify_status TEXT;
COMMENT ON COLUMN public.check_ins.consult_notify_status IS
  'T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY 변경2: 상담 배정 상담대기방 발송상태. NULL=미확정(기본), ''sending''=claim(발송 진행), ''sent''=발송완료. [확정] 버튼 클릭 게이트. 멱등 claim(조건부 UPDATE WHERE status IS NULL).';

-- ── 발송(확정) 완료 시각 ─────────────────────────────────────────────────────
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS consult_notify_sent_at TIMESTAMPTZ;
COMMENT ON COLUMN public.check_ins.consult_notify_sent_at IS
  'T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY 변경2: 상담대기방 발송(확정) 완료 시각. NULL=미발송/claim중.';

-- ── 발송(확정) 클릭 actor (R1: auth.users FK) ────────────────────────────────
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS consult_notify_by UUID;
COMMENT ON COLUMN public.check_ins.consult_notify_by IS
  'T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY 변경2(DA R1): [확정] 버튼을 누른 user id(auth.uid). NULL=미발송. auth.users(id) FK, ON DELETE SET NULL.';

-- ── Slack ts 보존 (R4: thread/dedup/forensics) ──────────────────────────────
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS consult_notify_slack_ts TEXT;
COMMENT ON COLUMN public.check_ins.consult_notify_slack_ts IS
  'T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY 변경2(DA R4): 상담대기방 발송 성공 시 Slack message ts. NULL=미발송.';

-- ── R2: status named CHECK (오타·잡값 차단, §1-2 care_category mirror). 멱등 DO-guard. ──
DO $consult_notify_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_check_ins_consult_notify_status'
       AND conrelid = 'public.check_ins'::regclass
  ) THEN
    ALTER TABLE public.check_ins
      ADD CONSTRAINT chk_check_ins_consult_notify_status
      CHECK (consult_notify_status IS NULL OR consult_notify_status IN ('sending', 'sent'));
  END IF;
END
$consult_notify_check$;

-- ── R1: consult_notify_by → auth.users(id) FK ON DELETE SET NULL. 멱등 DO-guard. ──
DO $consult_notify_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_check_ins_consult_notify_by'
       AND conrelid = 'public.check_ins'::regclass
  ) THEN
    ALTER TABLE public.check_ins
      ADD CONSTRAINT fk_check_ins_consult_notify_by
      FOREIGN KEY (consult_notify_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END
$consult_notify_fk$;

COMMIT;
