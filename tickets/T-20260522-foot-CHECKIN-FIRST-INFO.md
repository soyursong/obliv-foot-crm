---
ticket_id: T-20260522-foot-CHECKIN-FIRST-INFO
title: 초진 접수 시 정보입력 폼 선행 후 상담대기 이동
domain: foot
status: deploy-ready
priority: P2
created_at: 2026-05-22
deploy_ready_at: 2026-05-22
build_passed: true
db_migration: false
e2e_spec: tests/e2e/T-20260522-foot-CHECKIN-FIRST-INFO.spec.ts
regression_risk: low
---

## 개요

예약 시간표 접수 버튼 동선을 초진/재진으로 분기.

- **초진**: 접수 클릭 → 정보 입력 폼(이름/전화번호/주민번호/건보동의서 서명) → 완료 후 상담대기
- **재진**: 접수 클릭 → 바로 처리 (팝업 없음)

## AC

| AC | 설명 | 구현 |
|----|------|------|
| AC-1 | 초진 접수 시 정보 입력 폼 표시 (이름/전화 프리필 + 주민번호 + 건보동의서 서명) | CheckinFirstInfoDialog 신규 |
| AC-2 | 입력 완료 후 저장 + 상담대기 이동 | customers.birth_date + hira_consent 저장, consent_forms INSERT |
| AC-3 | 재진 접수 시 폼 없이 바로 체크인 | handleReservationCheckIn 분기 |
| AC-4 | 다른 접수 경로(SelfCheckIn, NewCheckInDialog, batchCheckIn) 회귀 없음 | 별도 경로 미변경 |
| AC-5 | 건보동의서 서명 UI (SignaturePad 재사용) | CheckinFirstInfoDialog SignaturePad |

## 구현 내역

### 신규 파일
- `src/components/CheckinFirstInfoDialog.tsx` — 초진 정보입력 폼 다이얼로그
  - 이름/전화번호 프리필 (읽기전용)
  - 주민번호 앞6자리(birth_date YYMMDD) 입력
  - 건강보험 자격조회 동의서 내용 + 체크박스 + SignaturePad 서명
  - 저장: customers.birth_date + hira_consent + consent_forms INSERT(hira_consent)
  - WARN: rrn_encrypt RPC 호출 제거 (CUST-REG-LOGOUT 버그 연관, 세션 종료 위험)

### 수정 파일
- `src/components/ReservationDetailPopup.tsx`
  - `convertToCheckIn` → `doCheckIn` (실제 INSERT) + `convertToCheckIn` (분기 진입점) 분리
  - 초진(new): `setShowFirstInfoDialog(true)` → 완료 후 `doCheckIn`
  - 재진/체험: 바로 `doCheckIn`
  - 상태 변경: 기존 `returning → treatment_waiting` → `consult_waiting` (예약팝업 접수 경로만)

- `src/pages/Dashboard.tsx`
  - `handleReservationCheckIn` → `doCheckInForReservation` (실제 INSERT) + `handleReservationCheckIn` (분기 진입점) 분리
  - 초진(new): `setFirstInfoTarget(res)` → CheckinFirstInfoDialog → 완료 후 `doCheckInForReservation`
  - 재진/체험: 바로 `doCheckInForReservation` (기존 treatment_waiting 유지)
  - `CheckinFirstInfoDialog` import + `firstInfoTarget` state 추가

- `src/components/ConsentFormDialog.tsx`
  - `FormType`에 `'hira_consent'` 추가 (건강보험 자격조회 동의서 타입 확장)

## DB 변경

없음. 기존 스키마 사용:
- `customers.birth_date` (TEXT, YYMMDD 6자리) — 20260508000060 마이그레이션
- `customers.hira_consent` (BOOLEAN) — 20260508000060 마이그레이션
- `consent_forms` 테이블 — 20260506000020 마이그레이션
- `signatures` storage bucket — 기존 사용 중

## 주의사항

- 주민번호 전체(13자리) 저장 금지 — birth_date(앞6자리)만 저장 (CUST-REG-LOGOUT 버그 재발 방지)
- 서명 업로드 실패는 접수 차단 (toast.error + 중단)
- consent_forms 저장 실패는 경고만 (toast.warning, 접수 진행)
- 다른 접수 경로 (SelfCheckIn, NewCheckInDialog, batchCheckIn) 변경 없음
