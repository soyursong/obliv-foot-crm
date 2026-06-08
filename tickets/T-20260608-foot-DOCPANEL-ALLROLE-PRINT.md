---
id: T-20260608-foot-DOCPANEL-ALLROLE-PRINT
domain: foot
status: deploy-ready
priority: P1
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260608-foot-DOCPANEL-ALLROLE-PRINT.spec.ts
created: 2026-06-08
deadline: 2026-06-11
---

# T-20260608-foot-DOCPANEL-ALLROLE-PRINT — 서류 발행 패널 5종 전역 인쇄 허용

## 현장 P1
직원(데스크/코디=`coordinator`) 계정으로 1번차트(CheckInDetailSheet)·2번차트(CustomerChartPage)
진입 시 서류 발행 패널에서 대상 서류 5종이 표시 안 됨. `form_templates.required_role`
(admin|manager 등)에 coordinator 미포함 → DocumentPrintPanel 인쇄목록에서 누락.

## 정책 확정 (김주연 총괄)
대상 서류 5종을 **모든 역할에서 인쇄 가능**하게.
- 소견서 `diag_opinion` · 처방전 `prescription` · 진단서 `diagnosis` ·
  진료비납입증명서 `payment_cert` · 진료의뢰서 `referral_letter`

## 해결 — 코드측 보강 (db_changed=false)
재사용 패턴: T-20260602-foot-PENCHART-REQROLE-PRINT-OMIT (deployed) 동일 접근.
- `src/lib/formTemplates.ts`
  - `ALL_ROLE_PRINT_FORM_KEYS` 상수 신규(5종 form_key).
  - `canAccessFormTemplate()` 최상단에 "5종이면 role 무관 전체 허용" 분기 추가.
- DB `form_templates.required_role` 변경 없음 — 코드 단일 소스(canAccess)만 보강.
- 1번/2번 차트 모두 DocumentPrintPanel.canAccess 단일 소스를 공유 → 한 곳 수정으로 양쪽 동시 적용.
- form_key 한정 → 그 외 양식(med_record 등)의 required_role 정책 회귀 없음.

## E2E — tests/e2e/T-20260608-foot-DOCPANEL-ALLROLE-PRINT.spec.ts (8 passed)
- AC-1: coordinator(데스크/코디) 5종 모두 접근 허용.
- AC-2: 임의 비-admin role(staff/therapist/consultant/director/빈)에서도 5종 노출.
- AC-3: 5종 외 양식은 required_role 정책 그대로(회귀 차단).
- AC-4: admin/manager 기존 인쇄 경로 회귀 없음.
- 회귀: T-20260602-foot-PENCHART-REQROLE-PRINT-OMIT.spec.ts 9 passed.

## DB 변경
없음 (db_changed=false). DocumentPrintPanel canAccess 단일 소스 코드측 판정만 보강.
불가피한 form_templates UPDATE 미사용 → 롤백 SQL 불필요.
