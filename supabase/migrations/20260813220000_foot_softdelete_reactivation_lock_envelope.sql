-- ============================================================
-- T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK — Leg2 canonical soft-delete envelope (ADDITIVE)
-- ============================================================
-- planner scope 확정: MSG-20260813-232732-uqdk (IN/CARVE/DEFER 3분류)
-- ★REWORK: DA REPLY MSG-20260814-002921-lb8f (Q3 BINDING) → planner MSG-20260814-003808-jc5c
--   설계 SSOT: DA-20260813-meta-SOFTDELETE-ARCHIVEFIRST-REACTIVATION-LOCK §2-1
--   Q3 canonical flag = (c′) domain-uniform `deleted_at` BINDING.
-- census      : db-gate/T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK_census.md (Leg1, READ-ONLY)
--
-- ⚠️⚠️ APPLY 게이트 (apply_before_go 금지) ⚠️⚠️
--   본 파일은 **staged ADDITIVE DDL** 이다. prod 적용은 supervisor DDL-diff + 물리 GO-token 선행 후에만.
--   envelope DDL(ADDITIVE) 자체는 GO-token 前 '준비'(파일 커밋) 까지만 허용 — 물리 apply 아님.
--   임상 객체(chart_treatment_requests / patient_file_records)의 behavior 전환(hard→soft 라우팅) FE 배포는
--   추가로 §11 medical_confirm_gate(문지은 대표원장 컨펌) 통과 후.
--   (본 DDL 컬럼추가 자체는 gate 前 선행 가능 = DA/planner 확정: "envelope DDL ADDITIVE 자체는 선행 가능".)
--
-- ★canonical envelope (DA §2-1 REWORK — Q3 domain-uniform deleted_at BINDING):
--   deleted_at    TIMESTAMPTZ NULL   ← ★단일 canonical 술어. 술어 = `deleted_at IS NULL`(=활성).
--   deleted_by    UUID        NULL   ← 삭제 수행자 auth.uid(). ★foot incumbent plain UUID(FK 미설정)
--                                       = actor 삭제 후에도 이력 생존 · medical_charts/check_ins 선례 mirror(mirror-not-invent).
--   deleted_reason TEXT       NULL   ← 삭제 사유(보존). 철자 = DA canonical `deleted_reason`.
--
--   ▸▸ is_deleted BOOLEAN stored 컬럼 = **HARD REJECT(추가/신설 금지)**.
--      이유: foot 지배 라이브 패턴이 이미 `deleted_at IS NULL`(check_ins·치료메모·treatment_photos·sms 수신거부).
--      Q3 = domain-uniform deleted_at 로 못박음 → is_deleted 병존 = two-dialect 제조이므로 금지.
--      landed is_deleted(medical_charts·form_submissions) = tolerate(기존 유지·retrofit 금지). 신규 6종엔 deleted_at 만.
--
-- ▸ mirror-not-invent: 기존 canonical flag 보유 테이블은 본 파일에서 **컬럼 추가 안 함** (신규 flag 증식 금지):
--     check_ins            → 기존 deleted_at+deleted_by (20260725160000) 재사용
--     check_in_services    → 기존 voided_at (20260805110000) 재사용 (Q4 carve-FROM-Q4 · 매출 line = voided_at)
--     closing_manual_payments → 기존 voided_at (20260714190000) 재사용
--   → 위 3종은 FE 라우팅(Leg2 GAP3 후속)만, 스키마 무변경. GAP3 = 기존 flag UPDATE 라우팅(mirror-not-invent).
--
-- ▸ CARVE-A (본 파일 제외 · 병렬 STAGED): service_charges(Tier-0 voided_at), staff_attendance(census-split).
--     → 별 브랜치 foot/T-20260813-SOFTDELETE-CARVE-A-svccharges-voidedat 에서 병렬 유지.
-- ▸ Q4 CLASS C (Tier-N/A carve · hard-DELETE 유지·FOR DELETE grant KEEP): db-gate/..._q4-subcarve-census.md
-- ▸ DEFER (Phase 2): config/master 25종, replace-pattern 4종(chart_diagnoses 등)
--
-- ▸ restore≠cancel 방화벽(§4): reservations 의 is_cancelled 은 **별 축**. 본 envelope(deleted_at)은
--   is_cancelled 을 구조적으로 무접촉 — 재활성화(deleted_at → NULL)는 취소상태를 파생/변경하지 않는다.
--
-- rollback: 20260813220000_foot_softdelete_reactivation_lock_envelope.rollback.sql
-- dryrun  : 20260813220000_foot_softdelete_reactivation_lock_envelope.dryrun.sql
-- ============================================================

BEGIN;

-- ── customers (Tier-0 view-hide envelope) ──
--   물리삭제 차단 유지(Customers.tsx:491 empty-only fail-closed + PHI FK RESTRICT). deleted_at = view-hide 축.
--   is_simulation(기존 view-hide) ⊥ deleted_at 병존(직교) — 시뮬 vs 삭제 의미 분리.
--   Leg2 scope: deleted_at view-hide + FOR DELETE grant REVOKE(co-atomic · 별 staged 마이그, per-table census 선결).
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by     UUID        NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason TEXT        NULL;
COMMENT ON COLUMN customers.deleted_at     IS 'soft-delete view-hide 술어(deleted_at IS NULL=활성). 물리삭제 차단 유지. is_simulation ⊥ 병존. T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK';
COMMENT ON COLUMN customers.deleted_by     IS '삭제 수행자 auth.uid(). foot incumbent plain UUID · FK 미설정(이력 생존).';
COMMENT ON COLUMN customers.deleted_reason IS '삭제 사유(보존).';

-- ── reservations (Tier-1 lifecycle · restore≠cancel 방화벽) ──
--   기존: hard-delete(deleted_at 컬럼 없음 — census 확인). is_cancelled 은 별 축 = 무접촉.
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by     UUID        NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason TEXT        NULL;
COMMENT ON COLUMN reservations.deleted_at     IS 'soft-delete lifecycle 술어(deleted_at IS NULL=활성). is_cancelled 과 직교(restore≠cancel §4). 재활성화가 취소를 파생하지 않음. T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK';
COMMENT ON COLUMN reservations.deleted_by     IS '삭제 수행자 auth.uid(). foot incumbent plain UUID · FK 미설정.';
COMMENT ON COLUMN reservations.deleted_reason IS '삭제 사유(보존).';

-- ── packages (Tier-1 lifecycle · 사용자 삭제 경로만) ──
--   rollback 콜사이트(packageCreditLedger.ts:271 compensation)는 CLASS C — soft-delete 대상 아님(FE 분기).
ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by     UUID        NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason TEXT        NULL;
COMMENT ON COLUMN packages.deleted_at     IS 'soft-delete lifecycle 술어(deleted_at IS NULL=활성 · 사용자 삭제 경로만). compensation rollback 은 CLASS C 제외. T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK';
COMMENT ON COLUMN packages.deleted_by     IS '삭제 수행자 auth.uid(). foot incumbent plain UUID · FK 미설정.';
COMMENT ON COLUMN packages.deleted_reason IS '삭제 사유(보존).';

-- ── chart_treatment_requests (임상 · §11 medical_confirm_gate — behavior 전환 배포는 gate 후) ──
--   envelope DDL(ADDITIVE) 자체는 gate 前 선행 가능. hard→soft 라우팅 FE 배포만 medical_confirm 선행.
ALTER TABLE chart_treatment_requests
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by     UUID        NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason TEXT        NULL;
COMMENT ON COLUMN chart_treatment_requests.deleted_at     IS 'soft-delete 술어(deleted_at IS NULL=활성 · 임상 §11 gate 대상 · hard→soft 라우팅 배포는 medical_confirm_gate 후). T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK';
COMMENT ON COLUMN chart_treatment_requests.deleted_by     IS '삭제 수행자 auth.uid(). foot incumbent plain UUID · FK 미설정.';
COMMENT ON COLUMN chart_treatment_requests.deleted_reason IS '삭제 사유(보존).';

-- ── patient_file_records (PHI 검사결과 파일 · 의료법 §22 보존 · §11 gate) ──
ALTER TABLE patient_file_records
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by     UUID        NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason TEXT        NULL;
COMMENT ON COLUMN patient_file_records.deleted_at     IS 'soft-delete 술어(deleted_at IS NULL=활성 · PHI 의료법 §22 보존 · 물리삭제 금지 · §11 gate 대상). T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK';
COMMENT ON COLUMN patient_file_records.deleted_by     IS '삭제 수행자 auth.uid(). foot incumbent plain UUID · FK 미설정.';
COMMENT ON COLUMN patient_file_records.deleted_reason IS '삭제 사유(보존).';

-- ── reservation_memo_history (Tier-1 · 치료메모 선례 준용) ──
ALTER TABLE reservation_memo_history
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by     UUID        NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason TEXT        NULL;
COMMENT ON COLUMN reservation_memo_history.deleted_at     IS 'soft-delete 술어(deleted_at IS NULL=활성 · 예약메모 · 치료메모 선례 준용). T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK';
COMMENT ON COLUMN reservation_memo_history.deleted_by     IS '삭제 수행자 auth.uid(). foot incumbent plain UUID · FK 미설정.';
COMMENT ON COLUMN reservation_memo_history.deleted_reason IS '삭제 사유(보존).';

COMMIT;
