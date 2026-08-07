-- T-20260807-foot-CONSULTASSIGN-TRIAL-EXCL-CHART2
-- 체험단(trial group) 전용 마커 — 예약 화면 '체험단' 전용 체크 항목 저장소.
--
-- 배경(reporter 김주연 총괄 confirm, 2026-08-07 slack ts 1786086941.671779):
--   ① 상담 배정 수(직원별 누적 배정 수) 집계에서 '체험단' 건을 제외.
--   ② 2번 유입경로 차트에 [체험단] 카테고리를 별도 표시.
--   ③ 체험단 구분 기준 = '체험단 전용 표시(마커)' 기준(NULL-inflow 전체 아님 — 원안 정정).
--   TRIALVERIFY census: NULL ≠ 체험단(미배정 1,253건 中 체험 17.9%) → 신규 전용 마커 도입 확정.
--
-- DA CONSULT-REPLY (SSOT: agents/docs/da_replies/da_decision_foot_is_trial_marker_schema_20260807.md):
--   verdict = Q1 GO(ADDITIVE) · Q2 (a) 단일 canonical(reservations) + RPC/조인 파생.
--   · reservations.is_trial BOOLEAN NOT NULL DEFAULT false = ADDITIVE 확정(기존컬럼 무접촉·mutation 0·롤백 대칭).
--   · ★metadata-only fast-ADD: default=비-volatile 상수(false) → PG 11+ 테이블 rewrite 없이 즉시 ADD(lock 우려 0).
--   · AC-2 by-construction: DEFAULT false + forward-only → 8/1 이전 행 전부 false = 제외 무영향 · 백필 불요.
--   · §36 방화벽: canonical inflow_channel 11코드 enum/CHECK 무접촉 · visit_type 재사용 금지 ·
--     NULL-inflow 대용 금지 · referral_source(freeze) 무접촉 → is_trial = 독립 4번째 직교 마커 축.
--
-- change-class: ADDITIVE (기존 테이블 nullable-default 컬럼 1개 추가만). 기존 행/제약 mutation 0. 파괴 0.
--   §3.1 CEO 대표게이트 면제(DA GO + ADDITIVE · reporter=총괄 방향게이트 충족).
--   잔여 게이트 = supervisor DDL-diff / MIG-GATE(fast-ADD·ADDITIVE dry-run·롤백 대칭).
--
-- write-path(VG2): 예약 create(submitNewReservation → createReservationCanonical) / edit(saveRouteAndRegistrar)
--   체크박스 단독. check_ins denorm 0(마커 복사 없음 — 소비자는 reservations 조인으로 파생).
-- read-path: Stream A(상담 배정 수) = check_ins LEFT JOIN reservations + COALESCE(is_trial,false)=true 제외.
--            Stream B(2번 차트) = VisitRouteSection [체험단] = reservations.is_trial=true 파생.
--
-- Rollback: 20260807180000_foot_reservations_is_trial_marker.rollback.sql
-- Dry-run:  20260807180000_foot_reservations_is_trial_marker.dryrun.mjs (No-Persistence)
-- author: dev-foot / 2026-08-07
-- ticket: T-20260807-foot-CONSULTASSIGN-TRIAL-EXCL-CHART2

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 체험단 전용 마커 (metadata-only fast-ADD · NOT NULL DEFAULT false)
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.reservations.is_trial IS
  'T-20260807-foot-CONSULTASSIGN-TRIAL-EXCL-CHART2: 체험단(trial group) 전용 마커. '
  'true = 예약 화면에서 스태프가 명시 체크한 체험단 건. DEFAULT false(forward-only, 8/1 이전 행 무영향). '
  'canonical inflow_channel 11코드/referral_source(§36 방화벽)와 직교 독립 축 — 유입 코드 아님(display/집계 제외 파생 소스). '
  '소비: 상담 배정 수 집계 제외(Stream A, check_ins JOIN) + 2번 유입경로 차트 [체험단] 카테고리(Stream B). DA GO·ADDITIVE.';

COMMIT;
