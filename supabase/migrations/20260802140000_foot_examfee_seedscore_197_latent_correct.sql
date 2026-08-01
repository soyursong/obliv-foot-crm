-- T-20260725-foot-EXAMFEE-SEEDSCORE-197-LATENT-CONTAM-CORRECT
--   풋CRM 초진진찰료 seed 점수 latent 오염 정정 — AA154 초진 정식명 행(hira_code=NULL) hira_score 197.07 → 197.12
--   author: dev-foot / 2026-08-02 (ticket created 2026-07-25 22:47, deadline 2026-08-08)
--   parent: T-20260725-body-EXAMFEE-SEEDSCORE-HIRA-RVU-197-RCA-CORRECT (도수 동일 버그 클래스)
--   DA authority: DA-20260725-EXAMFEE-HIRA-RVU ADDENDUM v1.1 (MSG-20260725-224540-lbo5)
--
-- ── 배경(DA ADDENDUM v1.1) ────────────────────────────────────────────────
--   foot LIVE canonical = hira_code=NULL 정식명 행. 초진 hira_score=197.07 은
--   published 심평원 상대가치점수가 아니라 목표금액(18,840) ÷ 환산지수(95.6) = 역산 아티팩트.
--   (도수 210.74=18,840÷89.4 와 동일 버그 클래스, CF 환산지수만 다름.)
--   의협신문 161874 원문: 2026 초진 = 195.63 + 1.49(0.76%) = 197.12점 / 18,840원.
--   ⇒ national-code 단일 정본 = 197.12 (풋·도수 공통). foot LIVE 197.07 = latent 0.05점 오염.
--
-- ── 금액영향 0 (non-urgent, 표시액 무변) ──────────────────────────────────
--   round_10(197.07 × 95.6) = round_10(18,839.9) = 18,840
--   round_10(197.12 × 95.6) = round_10(18,844.7) = 18,840   → 둘 다 18,840 (10원 반올림 흡수).
--   현장 표시 진찰료 금액 무변. seed hira_score 필드에만 노출되는 잠재 오염 → 정리성 정정(P2).
--
-- ── ★ FOOT lock 메커니즘 N/A (body 와 다름) ───────────────────────────────
--   risk_reason 의 "is_locked=true / unlock→update→relock" 은 body 도메인(regulated_value_ledger)
--   락 언어. foot 의 public.services 에는 is_locked 컬럼도 regulated_value_ledger 트리거도 없음
--   (types.ts Service·전 migration·src 전수 확인 2026-08-02). ∴ hira_score = plain mutable
--   NUMERIC(8,2) → data_correction_backfill_sop(mutable 필드) 봉투로 정정. 언락/릴락 단계 불요.
--
-- ── data_correction_backfill_sop 준수 ────────────────────────────────────
--   ① 대상셋 freeze: 대상 service id·사전값(197.07)을 TEMP 에 먼저 고정 → 그 집합에만 UPDATE.
--   ② 버그경로 지문: hira_code IS NULL(정식명 행) + hira_score = 197.07(÷CF 역산 산물) + active.
--      ★AA154-coded 153.36 죽은 stub(active=false)은 predicate 상 자동 제외(무접촉).
--   ③ 판정근거 스냅샷: 사전값(197.07)·정본(197.12)·row 지문을 _backup 에 동일 txn 적재(롤백원천).
--   ④ rows-affected 검증: freeze count == 실제 UPDATE ROW_COUNT. 불일치 시 RAISE(전체 롤백).
--      silent write-failure(0-row+error=null) 금지(cross_crm_write_rowcheck_standard).
--   ⑤ 값 전이 가드(멱등/사후정당보호): WHERE hira_score = 197.07 일치 행만 → 이미 197.12 면 no-op.
--   ⑥ 원장 무접촉: hira_score 만 SET. price·hira_code·is_insurance_covered·active 무접촉.
--      금액영향 0(위 round_10 대조) → 현장 육안 confirm 게이트 불요.
--
-- ── ⚠ SCOPE = AA154 초진 단독 ──────────────────────────────────────────────
--   AA254 재진(139.85)·AA222 재진물리(49.09) 는 body 별표1('25.12.29) pull SSOT(national-code
--   단일값) 확정 대기 → 본 마이그 미포함(정본 target 부재 상태 UPDATE = 오정정 위험).
--   AA154(197.12)는 DA 확정 → 단독 선행 정정(ticket "AA154 단독 선행 정정도 가능").
--   body 별표1 pull 완료 후 planner GO → AA254/AA222 후속 정정 마이그(별건) 발행.
--
-- ── _backup 네임스페이스(SOP §4: tracked CREATE 금지 → _backup/CSV 허용) ──
-- =========================================================================

BEGIN;

-- 판정근거/롤백원천 스냅샷 목적지 (_backup, idempotent)
CREATE SCHEMA IF NOT EXISTS _backup;

CREATE TABLE IF NOT EXISTS _backup.foot_examfee_seedscore_197_correct_20260802 (
  service_id        uuid        NOT NULL,
  clinic_id         uuid,
  service_name      text,
  hira_code         text,        -- 대상 predicate 상 NULL(정식명 행)
  prior_hira_score  numeric(8,2) NOT NULL,   -- 사전 상태(= 197.07, ÷CF 역산 아티팩트)
  new_hira_score    numeric(8,2) NOT NULL,   -- 정본(= 197.12, DA national-code)
  snapshotted_at    timestamptz  NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_freeze_cnt int;
  v_updated    int;
BEGIN
  -- ── (A) 대상셋 freeze: AA154 초진 정식명 행(hira_code NULL, 현재 197.07, active) ──
  CREATE TEMP TABLE _seedscore_target ON COMMIT DROP AS
  SELECT s.id, s.clinic_id, s.name, s.hira_code, s.hira_score
  FROM public.services s
  WHERE s.hira_code IS NULL              -- 정식명 행(AA154-coded 153.36 stub 제외)
    AND s.hira_score = 197.07            -- ÷CF 역산 아티팩트(버그경로 지문)
    AND s.active = true
    AND s.hira_category = 'consultation' -- 진찰료(초진/재진 축)
    AND s.name LIKE '%초진진찰료%';       -- 초진(재진 139.85 격리)

  SELECT count(*) INTO v_freeze_cnt FROM _seedscore_target;

  -- freeze 0건 = 대상 부재. prod 실측 predicate(초진 197.07/hira_code NULL) 재확인 필요 → abort.
  IF v_freeze_cnt = 0 THEN
    RAISE EXCEPTION 'ABORT: freeze-set 0건 — AA154 초진 정식명 행(hira_code NULL, hira_score 197.07, active, consultation) 부재. 이미 정정됐거나(멱등 no-op) prod predicate 드리프트. dev DB=0 정상(prod 유입분 부재).';
  END IF;
  RAISE NOTICE 'freeze-set(AA154 초진 정식명 행)=% 건 (prod 기대≈1; dev=0 이면 위 abort).', v_freeze_cnt;

  -- ── (B) 판정근거 스냅샷 적재(롤백원천) ──
  INSERT INTO _backup.foot_examfee_seedscore_197_correct_20260802
    (service_id, clinic_id, service_name, hira_code, prior_hira_score, new_hira_score)
  SELECT id, clinic_id, name, hira_code, hira_score, 197.12 FROM _seedscore_target;

  -- ── (C) 정정 UPDATE: 197.07 → 197.12 (값 전이 가드 = 멱등/사후정당보호) ──
  UPDATE public.services s
  SET hira_score = 197.12
  FROM _seedscore_target t
  WHERE s.id = t.id
    AND s.hira_score = 197.07;   -- 사이에 값이 바뀐 행은 건드리지 않음(사후 정당 입력 보호)
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- ── (D) rows-affected 검증(silent write-failure 금지) ──
  IF v_updated <> v_freeze_cnt THEN
    RAISE EXCEPTION 'ABORT: UPDATE % ≠ freeze % — target-set drift/사후 값변경 혼입(전체 롤백)', v_updated, v_freeze_cnt;
  END IF;

  RAISE NOTICE 'OK: AA154 초진 hira_score 197.07→197.12 정정 % 행. 금액영향0(round_10(197.12×95.6)=18,840=round_10(197.07×95.6)). 원장/price/hira_code 무접촉.', v_updated;
END $$;

COMMIT;
