---
id: T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS
domain: foot
status: deployed   # 후보 — supervisor 사후검증(read-only) 후 최종 확정. applied_at + POSTCHECK 3항목 evidence 첨부
qa_result: postcheck-pass (supervisor DDL-diff GO → prod apply 완료, POSTCHECK 3/3 PASS → supervisor 사후검증 대기)
deploy_commit: 386833ac (merge to main — 22b4593a feat + 9132371a chore)
applied_at: "2026-07-24 22:59 KST"   # prod rxlomoozakkjesdqjtvd, 정규 러너(마이그 body + schema_migrations 210000 명시 INSERT). 7/25 00:00 KST 발효 전
deployed_at: n/a (DB 마이그 — CF Pages 번들 변화 없음: FE 코드 무변경). applied_at 참조
bundle_hash: n/a (FE 코드 무변경 — 순수 DB 마이그)
priority: P1
db_change: true (ADDITIVE — 신규 함수 1 foot_juyeon_tempgrant_tick + cron job 1 + 계정 1행 role UPDATE date-gated. 신규 컬럼·테이블·enum 0)
da_consult: 면제 (ADDITIVE, function+cron·no col/table/enum — redpay_reconcile_cron 20260710190000 선례 봉투)
mig_files: supabase/migrations/20260724210000_foot_juyeon_director_1wk_tempgrant.sql (+ .rollback.sql)
mig_dryrun: pass (no-persistence — stripped txn-control + exception-rollback + post-probe absent)
mig_ledger_check: pass (prod 최신 20260724200000 < 신규 20260724210000, 충돌 없음)
mig_rollback: supabase/migrations/20260724210000_foot_juyeon_director_1wk_tempgrant.rollback.sql (잡해지+director→admin+DROP fn, idempotent)
medical_confirm_gate: required
confirm_status: confirmed (문지은 대표원장 Option A 컨펌 — planner MSG-20260724-185940-dpo3)
e2e_spec: tests/e2e/T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS.spec.ts (8/8 PASS)
evidence: evidence/T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS_backup.json + _MIGGATE.md + _PROD-APPLY-POSTCHECK.md
postcheck: "ALL PASS — (a1) fn foot_juyeon_tempgrant_tick n=1 secdef anon_exec=false / (a2) cron foot-juyeon-tempgrant-lifecycle active=true */15 / (b) role=admin 유지(발효 전) / (c) schema_migrations 최신=20260724210000"
slack_channel: C0ATE5P6JTH
slack_thread_ts: "1784882479.542659"
---

# T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS — 김주연 총괄 director 권한 1주 임시부여 + 8/1 자동원복

## 요약
소견서·진단서 **서식 점검**용으로 김주연 총괄 계정에 director 권한을 2026-07-25 00:00 ~ 2026-08-01 00:00 KST 한시 부여하고, 8/1 도래 시 원래 role 로 **자동원복**. 계정 1행만 조작. 서류틀·ROLE-MATRIX 정본 무변경.

## ★ 상태 실측 divergence (planner 통보 필요)
- 티켓 가정: 원래 role = `manager + has_ops_authority`
- **prod 실측**: 원래 role = **`admin`** / `has_ops_authority` 컬럼은 prod 부재
- ⇒ 자동원복/롤백 대상 role = **`admin`** (manager 로 되돌리면 admin 강등 사고)
- 완료 안내 문구도 admin↔director 로 정정 필요

## 대상
- user_profiles.id = `ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12` (juyeon@medibuilder.com)
- clinic = 74967aea (오블리브의원 서울오리진점)
- staff.role(consultant) **무변경** — 발행자 명의는 문지은/테스트닥터 director 에서 선택

## 권한 게이트 근거 (코드 무변경으로 충족)
- FE: `OpinionDocTab.canPublish = ['director','doctor'].includes(profile.role)`
- DB: `publish_opinion_doc → is_doctor_role() = current_user_role() ∈ {director,doctor}`, `current_user_role()=user_profiles.role`
- ∴ user_profiles.role='director' 로 FE+DB 양쪽 발행 게이트 충족. 서식/템플릿 코드 무변경(guard #1).

## 자동원복 (guard #2 핵심)
pg_cron `foot-juyeon-tempgrant-lifecycle` (매 15분) → `foot_juyeon_tempgrant_tick(now())`
- 발효 전: no-op / window: admin→director(부여) / 8/1↑: director→admin(원복) + 잡 자기해지
- 이중화: cron 사일런트 실패 대비 planner 에 8/1 human_pending 원복 확인 등록 FOLLOWUP.

## AC 매핑
- AC(발효): 7/25 → director → 소견서·진단서 발행 버튼 활성 (S1-b)
- AC(원복): 8/1 → admin → 발행 권한 회수 = 원상복구 (S2-a)
- AC(백업/원복): 원래 role=admin 백업(evidence) + .rollback.sql 즉시 원복 (guard #3)
- AC(서류틀): form_templates/htmlFormTemplates 무접촉 (guard #1)
- AC(실환자 금지): 코드강제 불가 → 완료 안내 명시(responder) (guard #4)

## 실행 주체
supervisor DDL-diff 게이트 통과 후 오늘(7/24) 내 prod 적용. (dev 는 prod DML 미실행 — 준비/dry-run/deploy-ready 까지)
