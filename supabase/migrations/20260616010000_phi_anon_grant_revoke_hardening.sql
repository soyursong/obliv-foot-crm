-- T-20260615-foot-PHI-ANON-GRANT-REVOKE-HARDENING
-- 표준: cross_crm_data_contract.md §15 (민감 테이블 anon GRANT 하드닝, v1.12+).
-- 출처: DA-20260615-foot-PHI-ANON-GRANT-REVOKE-HARDENING (data-architect GO).
-- ════════════════════════════════════════════════════════════════════════════
-- 목적: PARITY-AUDIT #A insurance_claims_schema prod 적용 후 관찰 — 신규 4 PHI·EDI
--   테이블에 Supabase 플랫폼 기본값(전 테이블 공통)으로 anon role table-level GRANT
--   잔존(SELECT 포함 전 권한). RLS(§16 canonical)로 anon row 0건이나, §15-1
--   defense-in-depth: RLS(1차) + anon 명시 REVOKE(2차 백스톱).
--
-- §15-3 메커니즘 정밀 규약 (구현 의무):
--   ① anon role만 REVOKE — authenticated 는 유지(RLS 가 row 게이트).
--   ② per-table 명시 REVOKE 만 — 전역 ALTER DEFAULT PRIVILEGES 금지(공개폼 일괄파괴).
--   ③ RLS 는 1차 통제로 그대로 유지(이 마이그는 RLS 를 만지지 않음).
--   ④ 신규 테이블 한정 → down.sql GRANT 복구 불요(rollback 시 보안구멍 재도입 방지).
--
-- 회귀 위험 0 입증(PRE probe, 2026-06-15):
--   - 4테이블 모두 anon RLS 정책 0건 → 공개 예약폼·meta폼(§4·§304) 등 anon 경로 의존 없음.
--   - §15-2 (A) 즉시 스코프 한정. (B) 기존 테이블 소급 sweep 비포함(별도 감사 프로젝트).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- insurance_claims (보험청구 헤더, PHI·금융)
REVOKE ALL ON insurance_claims FROM anon;

-- claim_items (청구 항목, PHI·금융) — ※ §15-4 사이드플래그: insurance_claim_ prefix
--   네이밍 정렬(insurance_claim_items)은 본 작업과 독립, 별도 ask(rename 금지).
REVOKE ALL ON claim_items FROM anon;

-- insurance_claim_diagnoses (청구 진단코드, PHI)
REVOKE ALL ON insurance_claim_diagnoses FROM anon;

-- edi_submissions (EDI 전송 이력, PHI·금융 인접)
REVOKE ALL ON edi_submissions FROM anon;

COMMIT;
