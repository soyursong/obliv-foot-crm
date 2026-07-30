-- T-20260730-foot-ASSIGN-FULLSPEC-IMPL (§094v 다.) — 비TM 유입경로 6경로 분리 (ADDITIVE)
--
-- ── 착수 근거 ──
--   DA CONSULT-REPLY (da_decision_foot_assign_leadsource_6path_split_20260730) = VERDICT ADDITIVE + GO,
--     권장 Option B(경로별 governed enum row + 독립 커서). autonomy §3.1 → 대표게이트 면제, supervisor DDL-diff 게이트만.
--   기존 T-20260726-foot-CRM-ASSIGN-V1(assignment_leadsource_policy / assignment_pointer_state)의 확립된
--     per-lead_source policy+cursor 패턴의 ADDITIVE 연장(minimal-surprise). 네이버/지인소개/공홈 이 워크인 커서에
--     묶이지 않고 각자 독립 policy row + 독립 랭킹 커서로 라우팅 = 스펙 '해당 경로 누적 차등' 결정적 보장.
--
-- ── 본 마이그 = ADDITIVE(값 추가만) ──
--   (A) assignment_leadsource_policy.lead_source CHECK  3값 → 6값(NAVER/REFERRAL/HOMEPAGE 추가). 값 추가만.
--   (B) assignment_pointer_state.lead_source     CHECK  3값 → 6값. 값 추가만.
--   (C) 조건부 seed: 이미 WALK_IN policy 가 설정된 clinic 에 한해 NAVER/REFERRAL/HOMEPAGE 를 WALK_IN 전략으로 복제
--       (DA '전략 동일 seed, 커서만 독립'). WALK_IN 미설정 clinic 은 seed 0 = 기존 월균등 유지(opt-in, 회귀0).
--   ※ pointer_state seed 불요 — 커서 row 는 배정 엔진(pickByRankingPointer)이 최초 배정 시 lazy upsert(무-잡).
--
-- ── ADDITIVE 비파괴 확인(DA Q2) ──
--   · 기존 3값(TM/INBOUND/WALK_IN) 행 전부 유효, PK(clinic_id,lead_source) 무영향, 백필 불요, 파괴적 변경 0.
--   · 이 lead_source 는 foot-local 배정 라우팅 enum(cross_crm_data_contract lead_source='dopamine_tm' 와 다른 컬럼) → 계약 충돌 0.
--   · 정본 표기 = 영대문자 governed enum(NAVER/REFERRAL/HOMEPAGE). 한글 주입 금지(혼합컨벤션 drift 차단).
--
-- 멱등: DROP CONSTRAINT IF EXISTS 후 재생성 / seed 는 ON CONFLICT DO NOTHING. RENAME·컬럼삭제·cross-product 충돌 0.
-- Rollback: 20260730120000_foot_assign_leadsource_6path_split.rollback.sql
-- Dry-run:  20260730120000_foot_assign_leadsource_6path_split.dryrun.sql (무영속 sentinel)
-- 운영 적용: dev-foot 직접 Management API 적용(scripts/T-20260730-foot-ASSIGN-LEADSOURCE-6PATH_migrate.mjs) + supervisor DDL-diff QA 게이트.

BEGIN;

-- ── (A) assignment_leadsource_policy.lead_source CHECK 3→6 (값 추가만) ──────────────
ALTER TABLE assignment_leadsource_policy
  DROP CONSTRAINT IF EXISTS assignment_leadsource_policy_lead_source_check;
ALTER TABLE assignment_leadsource_policy
  ADD CONSTRAINT assignment_leadsource_policy_lead_source_check
  CHECK (lead_source IN ('TM', 'INBOUND', 'WALK_IN', 'NAVER', 'REFERRAL', 'HOMEPAGE'));

-- ── (B) assignment_pointer_state.lead_source CHECK 3→6 (값 추가만) ──────────────────
ALTER TABLE assignment_pointer_state
  DROP CONSTRAINT IF EXISTS assignment_pointer_state_lead_source_check;
ALTER TABLE assignment_pointer_state
  ADD CONSTRAINT assignment_pointer_state_lead_source_check
  CHECK (lead_source IN ('TM', 'INBOUND', 'WALK_IN', 'NAVER', 'REFERRAL', 'HOMEPAGE'));

-- ── (C) 조건부 seed — WALK_IN 정책 설정 clinic 에 한해 3경로를 WALK_IN 전략으로 복제 ──
--   DA '전략값 동일 seed(커서만 독립)'. WALK_IN 미설정 clinic 은 seed 0(월균등 유지). 커서(pointer_state) 는 lazy 생성.
INSERT INTO assignment_leadsource_policy (clinic_id, lead_source, strategy, updated_at)
SELECT p.clinic_id, ns.lead_source, p.strategy, now()
FROM assignment_leadsource_policy p
CROSS JOIN (VALUES ('NAVER'), ('REFERRAL'), ('HOMEPAGE')) AS ns(lead_source)
WHERE p.lead_source = 'WALK_IN'
ON CONFLICT (clinic_id, lead_source) DO NOTHING;

-- 원장 기록 (schema_migrations ledger — 재실행 시 충돌 무시)
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260730120000', 'foot_assign_leadsource_6path_split')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인용):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='assignment_leadsource_policy_lead_source_check';
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='assignment_pointer_state_lead_source_check';
--   SELECT clinic_id, lead_source, strategy FROM assignment_leadsource_policy ORDER BY clinic_id, lead_source;
