---
id: T-20260530-foot-WALKIN-TIMETABLE
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
created: 2026-05-30
deadline: 2026-06-06
implemented-by: dev-foot
reviewed-by: ~
build-ok: true
db-change: false
spec-file: tests/e2e/T-20260530-foot-WALKIN-TIMETABLE.spec.ts
---

# T-20260530-foot-WALKIN-TIMETABLE
## 통합시간표 워크인(시간 외 셀프접수) 자동 타임 배정 + 시각적 구분

**요청**: planner (MSG-20260530-084451-ew56)  
**현상**: 워크인 체크인 건이 통합시간표에서 예약 건과 시각적으로 구분되지 않음

---

## DB 구조 선확인 결과 (사전 필수)

| 항목 | 결과 |
|------|------|
| `clinic_hours` 테이블 존재? | **없음** — 별도 테이블 없음 |
| 시간 설정 위치 | `clinics.open_time / close_time / weekend_close_time` + `clinic_schedules.open_time/close_time` (요일별) |
| 고정값 vs 가변값 | **지점별 가변** — DB 레코드 기반 |
| DB 변경 필요? | **불필요** — 기존 `slots[]` 배열이 이미 `clinic.open_time/close_time` 기반 |

→ FE only 구현 확정

---

## AC 이행 결과

| AC | 내용 | 이행 |
|----|------|------|
| AC-1 | 오픈 전 셀프접수 → 첫 타임 슬롯 자동 배정 | ✅ WALKIN-OFFHOUR-SLOT(cf6f936)에서 구현 완료 |
| AC-2 | 마감 후 셀프접수 → 마지막 타임 슬롯 자동 배정 | ✅ WALKIN-OFFHOUR-SLOT(cf6f936)에서 구현 완료 |
| AC-3 | 워크인 건 통합시간표 누락 없이 표시 + 예약 건과 시각적 구분 | ✅ 이번 커밋 — `walkInCiIdSet` + 'W' 배지(violet) 추가 |
| AC-4 | clinic_hours 기준 슬롯 배정 로직 | ✅ clinics.open_time/close_time 기반 slots[] 사용 확인. DB 변경 없음 |

---

## 구현 내용

### 변경 파일
- `src/pages/Dashboard.tsx` — FE only (DB 변경 없음)

### 핵심 변경

**1. `walkInCiIdSet` 추가** (슬롯 분류 섹션)
```typescript
const walkInCiIdSet = new Set<string>();
```

**2. 워크인 루프에서 ID 등록**
```typescript
// 워크인 등록 → 'W' 배지 기준
walkInCiIdSet.add(ci.id);
```

**3. `TimelineCheckInCard` `isWalkIn` prop 추가**
```typescript
isWalkIn?: boolean;
```

**4. 'W' 배지 렌더링**
```tsx
{isWalkIn && (
  <span
    className="text-[8px] bg-violet-100 text-violet-700 px-0.5 rounded shrink-0 leading-tight font-bold"
    title="워크인 (예약 없이 당일 접수)"
    data-testid="walkin-badge"
  >
    W
  </span>
)}
```
- 색상: violet (orange = 시간 외 배지와 구분, yellow = 초진 배지와 구분)
- 위치: chart number 뒤, offHourTime 앞

**5. 카드 렌더링 시 prop 전달**
- `newBox2Ci`, `retBox2Ci` 양쪽에 `isWalkIn={walkInCiIdSet.has(ci.id)}` 전달

---

## 워크인 판별 기준

| 조건 | 분류 |
|------|------|
| `selfCheckIns`에서 `matchedCiIds`에 없는 체크인 | **워크인** → 'W' 배지 |
| `selfCheckIns`에서 `matchedCiIds`에 있는 체크인 | **예약 매칭** → 배지 없음 |

---

## 테스트
- E2E spec: `tests/e2e/T-20260530-foot-WALKIN-TIMETABLE.spec.ts`
  - `walkInCiIdSet` 로직 유닛 검증 (AC-3) — 4개 케이스
  - 슬롯 클램핑 회귀 검증 (AC-1/2) — 5개 케이스
  - E2E 렌더링 회귀 검증 (AC-3/4) — 3개 케이스

## DB 변경
없음 (FE only)

## 관련 티켓
- T-20260530-foot-WALKIN-OFFHOUR-SLOT (commit cf6f936) — AC-1/2 슬롯 클램핑 구현
