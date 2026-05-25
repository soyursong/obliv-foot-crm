---
id: T-20260525-foot-TIMETABLE-POST16-SLOT
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: tests/e2e/T-20260525-foot-TIMETABLE-POST16-SLOT.spec.ts
deploy_commit: a0cdae5d3a8c984f14fba4082ce0eb038c647d53
summary: "통합시간표 16:00 이후 시간대 슬롯 최대 10건 상한 적용. slotMaxFor 헬퍼 추가, Dashboard.tsx QuickReservationDialog handleSave 상한 가드, Reservations.tsx 슬롯 카운터 표시(X/10) 적용. 빌드 3.24s OK. DB 변경 없음."
created: 2026-05-25
deadline: 2026-05-27
slack_channel: C0ATE5P6JTH
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
risk_verdict: GO
risk_reason: "FE-only. DB 변경 없음. 16시 이후 슬롯 수 UI 제한 — 기존 예약 데이터 무영향."
---

## T-20260525-foot-TIMETABLE-POST16-SLOT — 통합시간표 16시 이후 슬롯 10개/시간대 상한

### 배경

현장 요청 (김주연 총괄): "16시 이후로도 넣어줘 10개씩"

### 구현 완료 (commit a0cdae5)

**AC-1**: 통합시간표 16:00 이후 시간대 슬롯 최대 10건 상한

- `src/pages/Reservations.tsx` — `slotMaxFor(time)` 모듈 레벨 헬퍼 추가
  - 16:00 미만 → `SLOT_MAX_TOTAL(12)` 유지
  - 16:00 이상 → `POST16_SLOT_MAX(10)` 적용
  - `isSlotFull`, 슬롯 카운터 표시(`X/10`), `ReservationEditor maxPerSlot` 모두 적용

**AC-2**: 16:00 이전 기존 슬롯 무영향 (최대 12건 유지)

**AC-3**: 16시 이후 빈 슬롯 클릭 → 예약 생성 다이얼로그 정상 진입

- `src/pages/Dashboard.tsx` `QuickReservationDialog.handleSave`
  - 16시 이후 최대 10건 초과 시 "이 시간대는 마감입니다 (N/10)" 토스트 + early return

### 변경 파일

| 파일 | 내용 |
|------|------|
| `src/pages/Dashboard.tsx` | QuickReservationDialog.handleSave 16시 이후 상한 가드 추가 |
| `src/pages/Reservations.tsx` | slotMaxFor 헬퍼 + isSlotFull/카운터/maxPerSlot 적용 |
| `tests/e2e/T-20260525-foot-TIMETABLE-POST16-SLOT.spec.ts` | 신규 E2E spec (단위 12건 + E2E 클릭 3건) |

### AC 달성 현황

| AC | 내용 | 상태 |
|----|------|------|
| AC-1 | 16:00 이후 최대 10건/시간대 | ✅ |
| AC-2 | 16:00 이전 기존 최대 12건 무영향 | ✅ |
| AC-3 | 16시 이후 빈슬롯 클릭 → 예약 생성 진입 | ✅ |
