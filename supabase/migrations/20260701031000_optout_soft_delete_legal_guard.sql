-- T-20260630-foot-PERM-UNLOCK-EXPORT-AUTOSEND · sub-gate ⑨ (opt-out DELETE 법적 guard)
--   DA CONSULT-REPLY DA-20260701 (CR-20260701-foot-PERM-UNLOCK-EXPORT-AUTOSEND) GO 조건부.
--   수신거부(opt-out) 명단 추가·삭제 권한을 직원 3역할로 확대하되, 정보통신망법상 수신거부 의사
--   존중·보존 의무 때문에 '삭제'를 hard-delete 가 아닌 soft-delete + audit(누가·언제·왜)로 다룬다.
--
-- ── 채택 결정(DA 8문항) ──────────────────────────────────────────────────────
--   Q6 GO — soft-delete 컬럼셋(deleted_at/deleted_by/delete_reason) 채택.
--       partial-unique 전환(UNIQUE ... WHERE deleted_at IS NULL, customers L334 컨벤션 정합).
--       ★§3.1 "UNIQUE 제거" 파괴케이스 아님 — active row uniqueness 보존·유실0. 별도 audit테이블 불요(inline).
--   Q7 GO — RLS ADDITIVE(3역할 회수0). INVARIANT clinic_id=get_user_clinic_id() AND role IN(...)
--       USING+WITH CHECK 양쪽. 신규역할 범위=INSERT+UPDATE(soft) 커버, hard DELETE 부여 금지.
--   Q8 hard-delete 제거(soft만) — DELETE RLS 경로 제거(직원·관리자 공통). admin hard-purge 예외 본티켓 신설 금지.
--       진짜 erasure 는 별도 gated·admin-only·audited purge 추후 CONSULT.
--
-- ── GO 조건 ──────────────────────────────────────────────────────────────────
--   C2: partial-unique — supervisor DDL-diff 가 (a)active 중복 phone 부재 (b)롤백SQL(full-unique 재생성) 검증.
--       (a)는 기존 uq_notif_optout_clinic_phone(full unique)가 강제하던 불변이라 전환 시점 active 중복=0 보장.
--   C3: clinic_id isolation INVARIANT(USING+WITH CHECK) 무완화.
--   C4: ADDITIVE(컬럼 추가)·롤백SQL 동반·send/Solapi 키 신설0.
--
-- ── 선행 정합 (notif_optout_write) ────────────────────────────────────────────
--   20260630200000_notif_tmpl_write_staff_roles_align.sql 가 notif_optout_write 를 FOR ALL(insert/update/DELETE)
--   8역할로 정렬해둠 → DELETE 까지 8역할에 열림. 본 마이그가 그 FOR ALL 을 INSERT+UPDATE 로 분리해
--   DELETE 경로를 전면 제거(직원·관리자 공통). DROP POLICY IF EXISTS 로 선행 적용 여부 무관 수렴.
--
-- rollback: see 20260701031000_optout_soft_delete_legal_guard.rollback.sql
-- ============================================================================

BEGIN;

-- ── 1. soft-delete 컬럼셋 (ADDITIVE, 전부 nullable) ──────────────────────────
ALTER TABLE public.notification_opt_outs
  ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by    UUID,         -- 해제 actor(auth.uid()). FK 미설정(actor 삭제 후에도 이력 생존).
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

COMMENT ON COLUMN public.notification_opt_outs.deleted_at IS
  'T-...-EXPORT-AUTOSEND ⑨: soft-delete 시각(NULL=활성 수신거부). 정보통신망법 보존 — hard-delete 금지.';
COMMENT ON COLUMN public.notification_opt_outs.deleted_by IS
  '⑨: soft-delete 수행 actor(user id). FK 미설정 — 이력 생존.';
COMMENT ON COLUMN public.notification_opt_outs.delete_reason IS
  '⑨: soft-delete 사유(누가·언제·왜의 왜).';

-- ── 2. partial-unique 전환 (active row 만 phone 유일, 재등록 허용) ──────────────
--   ★C2: 기존 full-unique 가 active 중복 phone 부재를 강제 → 전환 시점 active 중복=0(safe).
--   soft-delete 후 동일 번호 재등록 시 active 한 건만 유일하면 됨.
ALTER TABLE public.notification_opt_outs
  DROP CONSTRAINT IF EXISTS uq_notif_optout_clinic_phone;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_optout_clinic_phone_active
  ON public.notification_opt_outs(clinic_id, phone)
  WHERE deleted_at IS NULL;

-- ── 3. RLS: notif_optout_write(FOR ALL) → INSERT + UPDATE 분리. DELETE 경로 전면 제거 ──
--   ★Q8: hard-delete 제거(soft만). DELETE 정책 미생성 = RLS 거부(직원·관리자 공통).
--   ★C3: clinic_id isolation INVARIANT 무완화 — USING+WITH CHECK 양쪽 동일.
DROP POLICY IF EXISTS notif_optout_write ON public.notification_opt_outs;

-- INSERT(수동 수신거부 등록) — 8역할(tm 제외).
DROP POLICY IF EXISTS notif_optout_insert ON public.notification_opt_outs;
CREATE POLICY notif_optout_insert ON public.notification_opt_outs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN (
      'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'
    )
  );

-- UPDATE(soft-delete = deleted_at set, 본문 수정) — 8역할(tm 제외).
DROP POLICY IF EXISTS notif_optout_update ON public.notification_opt_outs;
CREATE POLICY notif_optout_update ON public.notification_opt_outs
  FOR UPDATE
  TO authenticated
  USING (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN (
      'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'
    )
  )
  WITH CHECK (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN (
      'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'
    )
  );

-- ★DELETE 정책 의도적 미생성 → hard-delete 전면 차단(Q8). 진짜 erasure 는 추후 gated·admin-only·audited purge CONSULT.

COMMIT;
