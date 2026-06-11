---
id: T-20260611-foot-CHECKIN-XFER-OLDFORM-REMOVE
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-06-11 17:34
completed: 2026-06-11
db_changed: false
db_migration: none
db_gate: N/A
scenario_count: 8
commit: 2ea7ebc
spec: tests/e2e/T-20260611-foot-CHECKIN-XFER-OLDFORM-REMOVE.spec.ts
build: pass
---

# T-20260611-foot-CHECKIN-XFER-OLDFORM-REMOVE

통합시간표(staff) 예약상세 팝업에서 초진 환자 [체크인 전환] 시 로드되던
구 정보입력 폼(주민번호 입력란 + 옛날 양식 건보 자격조회 동의서 + 서명) 제거. (김주연 총괄)

## AC-0 출처 식별

- **[체크인 전환] 팝업** = `src/components/ReservationDetailPopup.tsx` (통합시간표 staff 예약상세 팝업,
  셀프접수 키오스크 foot-checkin 아님).
- 초진(visit_type='new') [체크인 전환] → `convertToCheckIn()` → `setShowFirstInfoDialog(true)`
  → `<CheckinFirstInfoDialog>` 렌더.
- **구 양식 본체** = `src/components/CheckinFirstInfoDialog.tsx`
  - 주민번호 input (`data-testid="checkin-info-rrn"`)
  - 건강보험 자격조회 동의서 블록 (`HIRA_CONSENT_CONTENT` + 체크박스)
  - 서명 패드 (SignaturePad)
- 동일 컴포넌트가 `Dashboard.tsx`(칸반 카드)에도 import 됐으나 트리거 `_handleReservationCheckIn`은
  접수버튼 제거(RECEPTION-BTN-REMOVE)로 **dead(void 처리)** → 실사용 LIVE 경로는 ReservationDetailPopup 유일.

## REDEFINITION_RISK 가드 처리 (§13.1.A)

- 동일 파일 CONSULTSLOT(P0)은 **이미 커밋 완료**(b584a06/53a9357/66fff79), working tree clean
  → in-flight 아님. blind 동시편집 위험 0.
- doCheckIn **slot 분기(returning ? treatment_waiting : consult_waiting) 무수정**.
  convertToCheckIn 진입 게이트만 제거(초진도 폼 없이 doCheckIn 직행).
- 정책 정합: RRN-FIELD-REMOVE(deployed) · CHECKIN-CONSENT-REMOVE(closed) = 확립된 제거 정책의
  staff 팝업 누락 표면 보강 (재정의 아님).

## 수정

- **ReservationDetailPopup.tsx**: CheckinFirstInfoDialog import / `showFirstInfoDialog` state / 렌더 제거.
  `convertToCheckIn` 분기 제거 → `await doCheckIn()` 직행.
- **Dashboard.tsx**: dead 경로(`_handleReservationCheckIn`) 동일 양식 참조 + `firstInfoTarget` state 정리.
- **CheckinFirstInfoDialog.tsx**: 삭제 (orphan, -301줄).
- `customers.birth_date` · `hira_consent` · `consent_forms` **컬럼/데이터 존치 (UI만 제거)**.
  주민번호/동의서 수집은 펜차트로 일원화.

## AC 충족

- AC-1: 주민번호 입력 필드 제거 (컬럼·데이터 존치). ✅
- AC-2: 구 동의서 양식 UI 블록 제거 (import·상태변수·모달 정리). ✅
- AC-3: 체크인 전환 후 상태 전이·저장 무회귀 (초진→상담대기 / 재진→치료대기 그대로). ✅
- AC-4: Dashboard(칸반 카드) 동일 양식 dead 경로도 함께 제거. ✅

## 검증

- build: vite EXIT0 3.89s
- E2E: 신규 spec 8 + CONSULTSLOT 회귀 spec 8 = **16/16 PASS**
- DB변경: 없음 (§S2.4 신규 컬럼/테이블/enum 0 → data-architect CONSULT 불요)
- commit 2ea7ebc → origin/main (차트 심볼 게이트 PASS) → Vercel 자동배포
