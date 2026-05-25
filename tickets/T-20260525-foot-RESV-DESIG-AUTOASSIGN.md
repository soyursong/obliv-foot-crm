---
id: T-20260525-foot-RESV-DESIG-AUTOASSIGN
domain: foot
status: deploy-ready
deploy-ready: true
db_change: false
build_ok: true
spec_added: tests/e2e/T-20260525-foot-RESV-DESIG-AUTOASSIGN.spec.ts
summary: "재진 예약 등록 팝업 — 기존 고객 선택 시 customers.designated_therapist_id 자동 배정"
parent: T-20260522-foot-DESIGNATED-THERAPIST
priority: P1
created_at: 2026-05-25
deployed_at: ""
---

# T-20260525-foot-RESV-DESIG-AUTOASSIGN

## 요약

재진 예약 등록 팝업에서 기존 고객을 선택할 때 `customers.designated_therapist_id`를 조회하여 담당 치료사 드롭다운을 자동으로 세팅합니다.

## 수용 기준

- **AC-1** ✅: 재진 예약 등록 팝업 기존 고객 선택 시 `customers.designated_therapist_id` 조회 → 값 있으면 드롭다운 자동 세팅. `"지정 치료사"` 라벨 표시. 수기 변경 가능.
- **AC-2** ✅: 차감 폼 치료사 드롭다운 변경 없음 (기존 대로 빈 상태 유지 — AC-R1 영향 없음)
- **AC-3** ✅: 초진(신규 고객)에는 미적용 — 패널 조건 `visit_type === 'returning' && customer_id` 유지
- **AC-4** ✅: 기존 기능 회귀 없음 — `designated_therapist_id` 없으면 `primaryTherapistId` (최빈) fallback

## 구현 내용

### 1. `TherapistHistoryInfo` 타입 확장
`designatedTherapistId`, `designatedTherapistName` 필드 추가.

### 2. `fetchHistory` useEffect 수정
- `check_ins` 조회와 `customers.designated_therapist_id` 조회를 `Promise.all`로 병렬화
- `allStaff` fetch 시 `designatedTherapistId` ID 포함
- `overrideTherapistId` 초기값: `designatedTherapistId ?? primaryTherapistId ?? ''`

### 3. 패널 라벨 업데이트
- `designatedTherapistName` 있으면 `"지정 치료사"` 라벨 + 이름 표시
- 없고 `primaryTherapistName` 있으면 기존 `"담당 치료사"` + 이름 표시
- 둘 다 없으면 `"미배정"` 표시

## DB 변경

없음. `customers.designated_therapist_id` 칼럼 이미 존재.

## 관련 파일

- `src/pages/Reservations.tsx` — `TherapistHistoryInfo` 타입, `fetchHistory`, 패널 JSX
- `tests/e2e/T-20260525-foot-RESV-DESIG-AUTOASSIGN.spec.ts` — E2E spec (4 시나리오)

## 부모 티켓

- `T-20260522-foot-DESIGNATED-THERAPIST` (deployed) — designated_therapist_id 저장 로직
- `T-20260524-foot-THERAPIST-BISYNC` — 재진 예약 저장 시 역동기화
