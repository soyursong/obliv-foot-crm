---
id: T-20260530-foot-WALKIN-OFFHOUR-SLOT
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
created: 2026-05-30
updated: 2026-06-01
deadline: 2026-06-03
implemented-by: dev-foot
reviewed-by: ~
build-ok: true
db-change: false
spec-file: tests/e2e/T-20260530-foot-WALKIN-OFFHOUR-SLOT.spec.ts
---

> **2026-06-01 reopened (P2, AC-4 한정)**: 일요일 워크인 → 이동/오류 없이 접수 시각
> 그대로 배정(pass-through). A안(월요일 이동)·B안(오류) 모두 기각 (김주연 총괄).
> AC-1/2/3/5(cf6f936 배포)는 동작 무변경 유지.

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
| AC-4 (구) | 영업시간 내 워크인 기존 동작 무변경 | ✅ rawSlot == slot인 경우 분기 없음 (clampSlot 유닛 케이스로 유지) |
| **AC-4 (reopened 06-01)** | **일요일 워크인 → 접수 시각 그대로 배정 (pass-through)** | ✅ `isSunday ? rawSlot : clamp(...)` 분기. 일요일 클램핑·배지·월요일 이동 없음. renderSlots 병합으로 운영시간 밖 시각도 그 시각 그대로 표시 |
| AC-5 | 오픈/마감 시간 clinic settings 기준 (하드코딩 금지) | ✅ slots[] 배열이 clinic.open_time/close_time 기반 |

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

## 2026-06-01 AC-4 reopened 구현 (pass-through)

### 변경 파일
- `src/pages/Dashboard.tsx` — FE only (DB 변경 없음)

### 핵심 변경
1. **`isSunday = date.getDay() === 0`** — 워크인 루프 진입 전 1회 계산
2. **워크인 slot 매핑 분기** (line ~1865):
   ```typescript
   const slot = isSunday
     ? rawSlot                                  // 일요일: pass-through (클램핑 없음)
     : rawSlot < firstSlot ? firstSlot :        // 평일/토: AC-1
       rawSlot > lastSlot  ? lastSlot  :        // 평일/토: AC-2
       rawSlot;
   if (!isSunday && slot !== rawSlot) offHourActualTimeMap.set(...);  // 일요일은 배지 미대상
   ```
3. **`renderSlots` 병합** (slotMap 완성 후): 일요일은 `slots ∪ Object.keys(slotMap)` 정렬 →
   운영시간(clinic 기반 slots) 밖 시각도 그 시각 그대로 타임라인에 표시. 평일/토는 `slots` 그대로.
4. **`slots.map` → `renderSlots.map`** (line ~2070) 렌더 소스 교체.

### 무파괴 검증
- 평일/토 분기는 기존 클램핑(AC-1/2) 그대로 — `isSunday=false` 경로 무변경.
- `renderSlots`는 일요일에만 분기, 평일/토 = `slots` 동일 참조.

## 테스트
- E2E spec: `tests/e2e/T-20260530-foot-WALKIN-OFFHOUR-SLOT.spec.ts` — **17/17 passed**
  - 슬롯 클램핑 로직 유닛 검증 (AC-1/2/4구/5) — clampSlot 케이스
  - **AC-4 일요일 pass-through (신규)**: 시나리오4 (일요일 14:00 → 14:00 그대로),
    운영시간 전(08:30→08:30)·후(20:00→20:00) 이동 없음, 평일 무파괴(클램핑 유지),
    배지 미대상(rawSlot===slot) 검증
  - E2E 렌더링 회귀 검증 (AC-3/4) — 통합시간표 슬롯 존재 확인

## DB 변경
없음 (FE only)

## 관련 티켓
- T-20260529-foot-DASHBOARD-TIMETABLE-SYNC (commit a6a95d7) — 통합시간표 실시간 반영
