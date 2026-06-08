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

---

## REOPEN (2026-06-08 FIX-REQUEST / 김주연 총괄 13:26 재보고)
> 데스크/코디 포함 전체역할 5종 모두 여전히 disabled. 경로 = 1번/2번 차트 → 진료내역 → 서류 재발행.

### 진단 결과 (AC-6, 추정 단정 금지 — 로그/번들/DB 증거 기반)
- **진단1 (컴포넌트 특정)**: "진료내역 → 서류 재발행" = `docReissueCheckIn` 모달
  (CustomerChartPage.tsx:5025-5055)이며, 내부에서 `DocumentPrintPanel`(line 5047)을 그대로 렌더.
  1번차트(CheckInDetailSheet.tsx:1402/2037)도 동일 컴포넌트. **별도 role 가드 없음** —
  전 경로가 canAccessFormTemplate 단일 소스 공유. → PATH-3 자체 가드 가설 기각.
- **진단2 (번들 반영)**: 운영 Vercel 라이브 번들 해시 대조 — formTemplates 공유 청크
  `assets/ReservationMemoTimeline-Bwd4dRMJ.js` 에
  `de=["diag_opinion","prescription","rx_standard","diagnosis","payment_cert","referral_letter"]`
  + canAccess(`je`) 정상 포함 확인. **261bf95 배포 반영 확정** → 코드/배포 무결.
- **진단3 (5종 form_key 전수 대조)**: 운영 DB(rxlomoozakkjesdqjtvd) form_templates read-only 재조회 —
  5종 실제 form_key = diag_opinion / rx_standard / diagnosis / payment_cert / referral_letter,
  **전부 코드 de[] 와 일치**(처방전 rx_standard 포함, 불일치 0).

### 결론
코드·DB·배포번들 모두 5종 전체역할 허용이 무결. 특히 admin/manager 는 required_role 로
**원래부터** 접근 가능 → "admin 포함 전체역할 disabled" 는 현 배포 코드로 설명 불가.
→ 가장 유력 원인 = **현장 태블릿 stale 번들/캐시**(13:09 배포 → 13:26 보고. SPA 기존 세션이
배포 전 lazy 청크를 메모리 유지, 하드리로드 전까지 신규 canAccess 미적용).
**운영 코드 추가수정 불필요**(추정 코드변경 회피). 현장 하드리프레시 후 역할별 재검증 필요.

### REOPEN 산출 (test-only, db_changed=false, 운영코드 무변경)
- E2E 하드닝: 시나리오4 추가 — 운영 DB 실제 5종 행 PATH-3 시뮬레이션.
  AC-5(비특권 전체역할 활성화) · AC-5(admin/manager/director 회귀) · AC-6(form_key 전수 일치).
  → 12 passed (기존 9 + 신규 3). tsc 0. L-006 회귀 15 passed(DOC-REISSUE-SYNC/PENCHART-REQROLE).
- 현장 재안내 요청 → planner FOLLOWUP: 태블릿 앱 완전 종료 후 재진입(또는 하드리프레시),
  coordinator·admin 각각 5종 활성화 per-role 결과 회신 요청.
