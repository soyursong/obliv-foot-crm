---
id: T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN
domain: foot
priority: P1
status: deploy-ready
qa_result: pending
deploy_commit: 70d5f332
deployed_at: 2026-07-08 (main merge 완료 — Vercel 자동배포)
db_change: false
db_migration: none
db_gate: N/A (render-time 비영속 — DA/대표 게이트 불요, §3.1 RESOLVED_CLEAN)
build: pass
scenario_count: 11
spec: tests/e2e/T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN.spec.ts
bundle_hash: n/a (FE — DocumentPrintPanel.tsx)
created: 2026-07-08
completed: 2026-07-08
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (NEW-TASK MSG-20260708-192600-3s38)
conflict_gate: RESOLVED_CLEAN
---

# T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN

풋 서류 출력 시 '진료 원장님' 선택 드롭다운 추가 — 원장 4분 진료체계 도입 전 조기 적용.

## 구현

- **드롭다운 신설**: `DocumentPrintPanel` 헤더 근무배너 아래 '진료 원장님' 상시 드롭다운
  (shadcn Select, 태블릿 `h-11` 큰 트리거, teal). `data-testid="docprint-doctor-select"`.
- **옵션 소스(하드코딩 금지·실시간·확장 가능)**: 1순위 = 진료일 근무 로스터(`useDutyDoctors`
  → duty_roster→staff role=director). 근무캘린더 미설정 시 폴백 = 원장 마스터
  (`staff` active, role=director). 4분 진료체계는 director 확장으로 자동 반영.
  ※ foot CRM `staff.role` CHECK 8종에 'doctor' 없음 → 원장 = 'director'.
- **바인딩(★AC1 — HTML 출력경로 2곳 정합)**: 선택값 `selectedDoctorName` 을
  `loadAutoBindContext(checkIn, doctorNameOverride)` 로 흘려 `buildAutoBindValues.doctor_name`
  (+`doctor_seal_html` 이름매칭)에 반영. 두 경로가 동일 SSOT(autoValues) 소비:
  1. 일괄출력 `handleBatchPrint` → `buildHtmlPageHtml`
  2. 영수증 재발급 `handleReceiptReissue` (이전 override 미전달 → 선택 무시/공란 위험이던 것 정합 복구)
- **AC4 기본값 안전성**: 미선택('')/목록 0명이면 `resolveDoctorForPrint()` 가 출력 차단
  (toast) — 빈·잘못된 원장명이 의료·법적 서류(진료확인서 등)에 안 찍히게.
- **AC5 무회귀**: `doctor_seal_html` 위치·RRN성별연동 등 DOC-PRINT-8FIX 렌더 불변.
  의사성명 바인딩만 선택값 연동으로 교체. 복수원장 선택 다이얼로그(batchDoctorPick)는
  상시 드롭다운으로 대체(제거).

## Q1~Q4 처리

- Q1 출력경로: 2곳(buildHtmlPageHtml + 영수증 재발급) 확인·정합.
- Q2 조회방식: 진료일 근무 로스터 1순위 + 원장 마스터 폴백(드롭다운 미빔 보강).
  현장 confirm 필요 시 supervisor field-soak/responder 경유.
- Q3 이력 영속화: render-time 비영속 채택(additive 컬럼 0) → db_change=false, DA 게이트 불요.
- Q4 원장별 도장: 기존 이름매칭 도장 SSOT(clinic_doctors.seal) 재사용. 없으면 로컬자산/(인) 폴백.

## 검증

- build pass, tsc clean.
- 신규 E2E spec 11건 PASS (바인딩 SSOT + 옵션해석 + 기본선택 + AC4 가드).
- 관련 DOCPRINT 회귀 16건 PASS (FEE-MISSING / FEEBREAKDOWN-INSURANCE-BLANK / INSURANCE-SPLIT-RECUR).
- 실브라우저 dual-path(일괄출력·영수증 재발급) 렌더 + 미리보기 스샷 → supervisor E2E/field-soak(갤탭 실기기) 종결.
