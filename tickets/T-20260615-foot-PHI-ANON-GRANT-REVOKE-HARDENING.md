---
ticket_id: T-20260615-foot-PHI-ANON-GRANT-REVOKE-HARDENING
status: deploy-ready
priority: P3
domain: foot
created_at: 2026-06-15
build_ok: true
spec_added: null
db_changed: true
rollback_sql: null
data_architect_consult: GO (src MSG-20260615-211440-dy6j / cross_crm_data_contract §15 정본 DA-20260615-foot-PHI-ANON-GRANT-REVOKE-HARDENING)
db_gate: supabase/migrations/20260616010000_phi_anon_grant_revoke_hardening.sql (직접 적용 완료 — supervisor db-gate 사후 검증 대기)
risk_level: GO (1/5 — anon REVOKE 백스톱, 신규 PHI 4테이블 한정, anon RLS 정책 0건 → 회귀위험 0)
deploy_ready: true
---

## 요청 (NEW-TASK, planner/DA P3, db-only)

prod(rxlomoozakkjesdqjtvd) 신규 4 PHI·EDI 테이블에 anon role 명시 REVOKE 마이그레이션.
cross_crm_data_contract §15(민감 테이블 anon GRANT 하드닝) 정본 구현 — RLS(1차) + anon REVOKE(2차 백스톱) defense-in-depth.

## 대상 (§15-2 A 스코프만)

- insurance_claims (보험청구 헤더)
- claim_items (청구 항목)
- insurance_claim_diagnoses (청구 진단코드)
- edi_submissions (EDI 전송 이력)

## 메커니즘 (§15-3 준수)

- per-table `REVOKE ALL ON <table> FROM anon;` 명시만 (4건)
- anon만 REVOKE, **authenticated 유지** (RLS 게이트 보존)
- 전역 `ALTER DEFAULT PRIVILEGES` 미사용 (공개폼 일괄파괴 방지)
- 신규테이블 한정 → down.sql GRANT 복구 불요 (rollback 시 보안구멍 재도입 방지)

## 범위 가드 (하지 않음)

- (B) 기존 테이블 광범위 소급 REVOKE 미실행 (별도 감사 프로젝트)
- claim_items → insurance_claim_items rename 미실행 (§15-4 독립 사이드플래그)

## 검증 (ground-truth, deploy-ready 전)

PRE probe (T-20260615-foot-PHI-ANON-REVOKE_probe.mjs):
- 4테이블 존재 4/4, anon 전권한 보유(Supabase 기본값), **anon RLS 정책 0건** → 공개폼 anon 경로 의존 없음 입증, RLS enabled 4/4

POST apply 검증 (T-20260615-foot-PHI-ANON-REVOKE_apply.mjs) — 🟢 ALL PASS:
- AC1 anon 4테이블 table-level 권한 0건 ✅
- AC2 authenticated 4테이블 권한 유지(RLS 게이트 보존) ✅
- AC3 anon SELECT 실차단 4/4 (has_table_privilege) ✅
- AC4 공개폼 회귀0 (reservations/customers anon SELECT·INSERT 보존) ✅

증빙: evidence/T-20260615-foot-PHI-ANON-REVOKE_{pre,post}apply_2026-06-15T1905Z.txt

## E2E

면제 (db_only — 권한 메타데이터 변경, FE 경로 무변동).
