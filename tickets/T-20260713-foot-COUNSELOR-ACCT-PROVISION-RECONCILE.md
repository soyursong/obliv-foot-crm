---
id: T-20260713-foot-COUNSELOR-ACCT-PROVISION-RECONCILE
domain: foot
priority: P2
status: done
type: data-correction
resolution: ALREADY-CONVERGED / NO-OP (write 미실행 — 선행 상태정정이 이미 persist)
deploy_ready: false
deploy_ready_reason: "코드/스키마/데이터 무변경. live prod 재검증 결과 target 이미 정합(consultant + clinic_id=74967aea) → backfill 대상 0. 배포 아티팩트 없음."
hotfix: false
code_changed: false
db_changed: false
db_change_scope: "없음. READ-ONLY 진단 2종(verify + contam_scan) 실행. UPDATE/DELETE 미실행."
e2e_spec: N/A (db_only 진단, 코드/빌드 무변경 — planner db_only e2e 면제)
mig_files: N/A (DB write 없음 → 마이그레이션 아티팩트 없음)
mig_dryrun: N/A (write 없음)
mig_ledger_check: N/A (write 없음)
mig_rollback: N/A (write 없음. 선행 티켓 rollback/T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL_rollback.sql 유효 상태 유지)
judgment_snapshot: rollback/T-20260713-foot-COUNSELOR-ACCT-PROVISION-RECONCILE_judgment.json
identity_resolution_standard: 준수 (전량 페이지네이션 exact match 1건 + getUserById id↔email 재검증, ?email= 서버필터 미신뢰, gmail a7e2e012 무접촉)
da_consult: 불요 (기존 enum 값 data-correction, 스키마 무변경 — planner 명시)
risk_verdict: GO_WARN (planner)
created: 2026-07-13
completed: 2026-07-13
author: dev-foot
reporter: planner (내 FOLLOWUP MSG-20260713-154108-byka 수용 → NEW-TASK MSG-20260713-154949-as7r)
related: T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL, T-20260713-foot-ACCOUNT-LOGIN-FAIL-FACEOFANGEL
field_summary: "상담실장 김지윤 계정은 이미 정상(상담실장 권한 + 종로 오리진점 소속)입니다. 추가 조치 없이 정상 확인만 완료했습니다."
---

# T-20260713-foot-COUNSELOR-ACCT-PROVISION-RECONCILE

## 요청 (planner NEW-TASK)
상담실장 김지윤 신규계정(`faceofangel9999@oblivseoul.kr`, user_profiles id=b36e74a3) provisioning 정합 backfill.
로그인복구(COUNSELOR-ACCT-CREATE-FACEOFANGEL, deploy-ready)와 별개 축. gmail 계정(a7e2e012) 무접촉.
planner 주장 불일치 2건:
1. `user_profiles.role='coordinator'` vs `staff.role='consultant'`
2. `user_profiles.clinic_id=NULL` vs `staff.clinic_id=74967aea`

## 판정 (한 줄)
**live prod 재검증 결과 target 은 이미 정합(role=consultant + clinic_id=74967aea) → backfill 대상 0. NO-OP. write 미실행.** 선행 티켓 상태정정(APPLY=1)이 실제 persist 됨 — planner 주장 불일치는 그 before.json(수정 전) 기준 stale 판단으로 추정.

## diagnose-first: RBAC 게이트 소스 확정
- `src/lib/permissions.ts` `canAccess()`/`PERM_MATRIX`/`hasOpsAuthority()` 모두 **subject.role(=user_profiles.role)** 평가. `App.tsx` ProtectedRoute 도 profile.role 기준.
- `staff.role` 은 근무자 로스터/배정용 (계정 RBAC/메뉴 게이트 축 아님).
- ∴ **user_profiles.role = RBAC/RLS/메뉴 게이트 축** → role UPDATE 는 no-op 아님. 다만 현 상태가 이미 consultant 라 **실제 write 는 불요**.

## live prod 재검증 (READ-ONLY, Identity Resolution 표준 준수)
- auth.users 전량 페이지네이션 → exact email match **1건**(`?email=` 서버필터 미신뢰) = `b36e74a3`. 기대 uid 일치 OK.
- `getUserById(b36e74a3)` id↔email 재검증 OK. banned=null, last_sign_in=2026-07-13 11:33 (로그인 정상).
- gmail 계정 `a7e2e012`(faceofangel9999@gmail.com) 별도 존재 — 무접촉 대상, 본 티켓 write 미경유.

| 필드 | user_profiles (target) | 링크 staff (c23d4491) | 판정 |
|---|---|---|---|
| role | **consultant** | consultant | ✅ 정합 |
| clinic_id | **74967aea** (종로 오리진점, slug=jongno-foot) | 74967aea | ✅ 정합 |
| active/approved | true / true | true | ✅ |

## 다계정 공통 오염 스캔 (planner 조건부 지시)
- 전 user_profiles 47건 스캔: **active + clinic_id=NULL 0건**, clinic_id mismatch 0건.
- role mismatch(profile≠staff) 2건 — 모두 **의도된 admin(ops-authority) elevation**:
  - `ee67fc6b` juyeon@medibuilder.com: profile=admin / staff=consultant = 김주연 총괄(SUPERADMIN-EXEMPT reporter). clinic_id 정상.
  - `64a1f77a` test@medibuilder.com: profile=admin / staff=coordinator = test 슈퍼유저.
- 마이그 오프로비저닝 지문(clinic_id=NULL + coordinator 다운그레이드) 보유 계정 **0건**.
- ∴ **대량 data-correction 재분류 FOLLOWUP 불요.** target 단일계정 격리 확정.

## SOP 준수 (Cross-CRM Data-Correction 백필)
- 단일 count UPDATE 금지 ✅ (count 기반 blind UPDATE 미실행)
- 대상셋 freeze + 재검증 ✅ (target 단일계정 + gmail 격리)
- 판정근거 스냅샷 ✅ (`rollback/…_judgment.json`)
- 롤백 N/A (write 없음. 선행 rollback SQL 유효)
- Identity 재검증 ✅ (GOTRUE INV-1..4)
- 원장 무접점 ✅ (target=상담실장, 의료화면/원장계정 무관)

## 산출물
- `scripts/T-20260713-foot-COUNSELOR-ACCT-PROVISION-RECONCILE_verify.mjs` (READ-ONLY 진단·Identity 재검증)
- `scripts/T-20260713-foot-COUNSELOR-ACCT-PROVISION-RECONCILE_contam_scan.mjs` (READ-ONLY 다계정 오염 스캔)
- `rollback/T-20260713-foot-COUNSELOR-ACCT-PROVISION-RECONCILE_judgment.json` (판정근거 스냅샷)
