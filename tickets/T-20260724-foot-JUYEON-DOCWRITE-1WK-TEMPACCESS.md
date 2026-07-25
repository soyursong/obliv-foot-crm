---
id: T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS
domain: foot
status: deploy-ready   # A안 재진입(deployed→approved→deploy-ready) — dev-foot 준비완료, supervisor DDL-diff+prod apply 대기
qa_result: pending (A안 자동원복 해제 — supervisor DDL-diff 게이트 대기)
deploy_commit: 386833ac (선행 v1 grant/자동원복 merge). A안 커밋은 supervisor merge 후 기록
applied_at: pending (A안 마이그 20260725170000 — dev 는 prod DML 미실행, 준비/dry-run/deploy-ready 까지)
deployed_at: n/a (DB 마이그 — CF Pages 번들 변화 없음: FE/TS 소스 무변경). applied_at 참조
bundle_hash: n/a (FE/TS 소스 무변경 — 순수 DB 마이그 + 테스트/config)
priority: P1
db_change: true (ADDITIVE — CREATE OR REPLACE tick(자동원복 제거) + 신규 fn foot_juyeon_tempgrant_revert + role ensure admin→director idempotent + cron 재확인. 신규 컬럼·테이블·enum 0)
da_consult: 면제 (ADDITIVE, function+cron·no col/table/enum — redpay_reconcile_cron 20260710190000 선례 봉투)
mig_files: supabase/migrations/20260725170000_foot_juyeon_tempgrant_disable_autorevert.sql (+ .rollback.sql)
mig_dryrun: pass (no-persistence — stripped txn-control + exception-rollback + post-probe: revert_fn absent + tick auto-revert branch unchanged. pre=post role=director)
mig_ledger_check: pass (prod 최신 20260725120000 < 신규 20260725170000, n=0 미존재, 충돌 없음)
mig_rollback: supabase/migrations/20260725170000_foot_juyeon_tempgrant_disable_autorevert.rollback.sql (선행 자동원복 tick 복원 + revert fn DROP + 스케줄 복원, idempotent)
medical_confirm_gate: required
confirm_status: confirmed (문지은 대표원장 A안 재컨펌 2026-07-25 09:00 KST ts 1784937364.145639 — planner MSG-20260725-090449-wfwp)
e2e_spec: tests/e2e/T-20260724-foot-JUYEON-DOCWRITE-DISABLE-AUTOREVERT.spec.ts (8/8 PASS, --project=unit)
evidence: evidence/T-20260724-foot-JUYEON-DOCWRITE-DISABLE-AUTOREVERT_MIGGATE.md + _backup.json (+ v1: _1WK-TEMPACCESS_*)
postcheck: "적용 후 supervisor 실증 — (a) revert 브랜치 미발동(tick=hold, 8/1 주입 시 action=hold rows=0) (b) role=director 유지 (c) baseline='admin' 보존(tick·revert v_orig_role 상수)"
prev_v1: "v1(20260724210000 grant+8/1 자동원복) deployed 완료 → A안으로 자동원복 브랜치 무력화(본 마이그가 대체)"
slack_channel: C0ATE5P6JTH
slack_thread_ts: "1784882479.542659"
---

# T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS — 김주연 총괄 director 권한 1주 임시부여 + 8/1 자동원복

## ★★ [A안 개정 2026-07-25] 8/1 자동원복 해제 — 요청시 원복 전환 ★★
문지은 대표원장 A안 재컨펌(2026-07-25 09:00 KST, ts 1784937364.145639) / planner MSG-20260725-090449-wfwp.

**결정**: 8/1 자동원복을 **없앤다**. 김주연 총괄(U0ATDB587PV)이 "원복해줘" 요청할 때까지 director 라이브 유지.
기존 설정(소견서·진단서 포함 진료 메뉴 전체 열림) 그대로 유지.

**A안 마이그**: `supabase/migrations/20260725170000_foot_juyeon_tempgrant_disable_autorevert.sql`
1. **자동원복 브랜치 비활성화** — `foot_juyeon_tempgrant_tick()` 을 CREATE OR REPLACE 해 8/1 만료 revert + 재부여 로직 제거 → cron 경로는 순수 `hold` no-op. 스케줄은 유지(옵션 1)하되 revert 미발동. grant=director 라이브 유지.
2. **baseline='admin'(v_orig_role) 정본 절대 보존** — 스냅샷 재기록 없음. 두 함수 모두 `v_orig_role := 'admin'` **하드코딩 상수**. 현재 role(director)을 baseline 으로 읽지 않음 → 영구 director 사고 원천 차단.
3. **on-request 원복 경로 유지** — 신규 canonical 함수 `foot_juyeon_tempgrant_revert()` (director→admin=v_orig_role + 잡 해지). 총괄 원복요청 수신 시에만 `SELECT public.foot_juyeon_tempgrant_revert();`. 신규 스냅샷/수동 원복 티켓 불요.

**AC 개정**:
- AC4(개정): 8/1 도래해도 자동원복 미발동 — role=director 유지.
- AC6(신규): 총괄 원복요청 시 canonical(→admin) 경유 원복 + baseline='admin' 보존.
- AC1/AC2/AC5(서류틀·ROLE-MATRIX 정본 불변) 계속 유효.

**게이트 증빙**: dry-run PASS(pre=post role=director, revert_fn absent, tick auto-revert unchanged) / ledger 20260725120000<170000 / build ✓ / e2e 8/8(unit). MIG-GATE 4필드 evidence: `evidence/..._DISABLE-AUTOREVERT_MIGGATE.md`.

**주의(planner belt)**: 기존 8/1 09:07 KST planner belt(자동원복 이중화)는 A안으로 무효화 대상 — belt 취소는 planner 소관(별도). dev 는 pg_cron revert 무력화만 처리.

---

## 요약 (v1 — 원 티켓, 자동원복 방식. A안으로 대체됨)
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
