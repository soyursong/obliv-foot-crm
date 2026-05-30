---
id: T-20260530-foot-WALKIN-OFFHOUR-SLOT
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
created: 2026-05-30
updated: 2026-05-30
deadline: 2026-06-03
implemented-by: dev-foot
reviewed-by: ~
build-ok: true
db-change: false
spec-file: tests/e2e/T-20260530-foot-WALKIN-OFFHOUR-SLOT.spec.ts
---

# T-20260530-foot-WALKIN-OFFHOUR-SLOT
## 영업시간 외 워크인(셀프접수) → 가용 타임슬롯 자동 배정 + CRM 표시

**요청자**: 김주연 총괄  
**현상**: 대시보드 통합시간표에서 오픈/마감시간 외 셀프접수(워크인)건이 CRM에 미표시

---

## AC 이행 결과

| AC | 내용 | 이행 |
|----|------|------|
| AC-1 | 영업시간 전 워크인 → 당일 첫 타임슬롯 자동 배정 | ✅ rawSlot < firstSlot → firstSlot 클램핑 |
| AC-2 | 영업시간 후 워크인 → 당일 마지막 타임슬롯 자동 배정 | ✅ rawSlot > lastSlot → lastSlot 클램핑 |
| AC-3 | 워크인 건 누락 방지 (시간표+접수목록 양쪩 표시) | ✅ 클램핑으로 시간표 미표시 해소. 칸반은 기존부터 표시 |
| AC-4 | 영업시간 내 워크인 기존 동작 무변경 | ✅ rawSlot == slot인 경우 분기 없음 |
| AC-5 | 오픈/마감 시간 clinic settings 기준 (하드코딩 금지) | ✅ slots[] 배열이 clinic.open_time/close_time 기반. 일요일=토요일 동일(2026-05-30 김주연 총괄) |

---

## 구현 내용

### 변경 파일
- `src/pages/Dashboard.tsx` — FE only (DB 변경 없음)

### 핵심 변경

**1. `offHourActualTimeMap` 추가** (line ~1784)
- `Map<ci.id, 'HH:mm'>` — 클램핑된 워크인의 실접수 시각 추적

**2. 워크인 루프 슬롯 클램핑** (line ~1835)
```typescript
const firstSlot = slots[0] ?? '10:00';
const lastSlot = slots[slots.length - 1] ?? '20:00';
const slot =
  rawSlot < firstSlot ? firstSlot :
  rawSlot > lastSlot  ? lastSlot  :
  rawSlot;
if (slot !== rawSlot) offHourActualTimeMap.set(ci.id, format(d, 'HH:mm'));
```

**3. `TimelineCheckInCard` `offHourTime` prop 추가**
- `offHourTime?: string` — 영업시간 외 클램핑된 실접수 시각
- 오렌지 배지로 실접수 시각 표시 (`bg-orange-100 text-orange-700`)
- tooltip: "실접수 HH:MM (영업시간 외 → 슬롯 자동 배정)"

**4. 카드 렌더링 시 prop 전달**
- `newBox2Ci`, `retBox2Ci` 양쪽에 `offHourTime={offHourActualTimeMap.get(ci.id)}` 전달

---

## 테스트
- E2E spec: `tests/e2e/T-20260530-foot-WALKIN-OFFHOUR-SLOT.spec.ts`
  - 슬롯 클램핑 로직 유닛 검증 (AC-1/2/4/5) — 순수함수 10개 케이스
  - E2E 렌더링 회귀 검증 (AC-3/4) — 통합시간표 슬롯 존재 확인
  - **AC-5 시나리오 4**: 일요일 08:30 워크인 → 10:00 첫 타임슬롯 배정 확인
  - **AC-5 시나리오 5**: 일요일 18:30 워크인 → 18:00 마지막 타임슬롯 배정 확인
  - **AC-5 시나리오 4+5**: 일요일 슬롯 배열 = 토요일 동일 검증

## DB 변경
없음 (FE only)

## 관련 티켓
- T-20260529-foot-DASHBOARD-TIMETABLE-SYNC (commit a6a95d7) — 통합시간표 실시간 반영
