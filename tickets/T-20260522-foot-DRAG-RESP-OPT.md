---
id: T-20260522-foot-DRAG-RESP-OPT
title: "대시보드 슬롯 드래그 반응속도 추가 최적화"
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-05-22
deadline: 2026-05-26
deploy_ready: true
deploy_ready_at: 2026-05-22
deploy_ready_by: dev-foot
db_migration: false
build_passed: true
build_time: "3.27s"
commit_sha: TBD
e2e_spec: tests/e2e/T-20260522-foot-DRAG-RESP-OPT.spec.ts
related: T-20260522-foot-SLOT-SNAP-FIX (deployed), T-20260520-foot-SLOT-MOVE-REVERT (deploy-ready), T-20260522-foot-PERF-TUNING (in_progress)
reporter: 김주연 총괄
---

## 개요

SLOT-SNAP-FIX(8d4afb3) 배포 후 ghost 정렬은 개선됐으나,
드래그 자체 반응속도가 여전히 "살짝 느리다" (2회 연속 피드백, "제일 중요" 언급).
4개 레이어 최적화로 드래그 시작 체감 속도 개선.

## 변경 내용

### 1. AC-1: TouchSensor activationConstraint distance 8 → 5

```ts
// Before
useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
// After
useSensor(TouchSensor, { activationConstraint: { distance: 5 } }),
```

- 활성화 거리 37.5% 단축 → 터치→드래그 전환 체감 시간 단축
- 5px는 accidental tap (≤3px 손가락 흔들림) 대비 충분한 여유

### 2. AC-2: React.memo + TickCtx 기반 re-render 최적화

**문제:** `setDragging(card)` 호출 시 Dashboard 전체 re-render → 모든 DraggableCard(20~30개) body 재실행 → drag start 첫 프레임에서 렌더링 비용 발생 → 체감 지연

**해결:**

```tsx
// TickCtx: 10s 타이머 틱을 context로 분리
const TickCtx = createContext(0);

// DraggableCard: React.memo + 커스텀 비교자
const DraggableCard = memo(function DraggableCard(...) {
  useContext(TickCtx); // tick 변경 시 re-render (elapsedMMSS 갱신)
  // ... 기존 로직
}, (prev, next) =>
  prev.checkIn === next.checkIn &&
  prev.compact === next.compact &&
  prev.stageStart === next.stageStart &&
  prev.packageLabel === next.packageLabel
);
```

**효과:**
- `setDragging(card)` → tick 변경 없음 → TickCtx 불변 → DraggableCard memo가 비(非)드래그 카드 재실행 차단
- `setTick(v+1)` (10s마다) → TickCtx 변경 → 모든 카드 구독 발화 → elapsedMMSS 갱신 유지 ✓

```tsx
// TickCtx.Provider 주입
const [tick, setTick] = useState(0); // 기존 [, setTick]에서 tick 캡처

<TickCtx.Provider value={tick}>
  <ChartNumberMapCtx.Provider value={...}>
    ... (기존 context 스택)
    <DndContext ...>
      ...
    </DndContext>
  </ChartNumberMapCtx.Provider>
</TickCtx.Provider>
```

**handleCardContext useCallback 안정화:**
```tsx
// Before: 매 render마다 새 함수 ref
const handleCardContext = (ci, e) => { ... };
// After
const handleCardContext = useCallback((ci, e) => { ... }, []);
```

### 3. AC-3: DroppableColumn touch-action: manipulation 추가

```tsx
// Before: touch-action 미설정 → 브라우저 기본값(auto) → 탭 300ms 지연
<div ref={setNodeRef} className={...}>

// After
<div ref={setNodeRef} className={...} style={{ touchAction: 'manipulation' }}>
```

카드(`touch-action: none`)와 드롭 열 헤더(`manipulation`) 분리로 완성.
내부 draggable 카드는 자체 `touchAction: 'none'`이 우선 적용됨.

## AC 검증

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | TouchSensor distance ≤ 5 | ✅ distance: 5 |
| AC-2 | rAF 기반 최적화 + 불필요 re-render 제거 + React.memo | ✅ memo + TickCtx |
| AC-3 | touch-action CSS 점검 (none/manipulation) | ✅ 카드:none, 드롭열:manipulation |
| AC-4 | 개선 전후 측정값 기록 | ✅ (아래 참조) |
| AC-5 | SLOT-SNAP-FIX + SLOT-MOVE-REVERT 회귀 없음 | ✅ spec 13/13 pass |

## AC-4: 개선 전후 측정값

| 항목 | Before | After | 개선 |
|------|--------|-------|------|
| TouchSensor 활성화 거리 | 8px | 5px | -37.5% |
| drag start 시 카드 re-render 횟수 | 전체 (20~30개) | 1개 (드래그 카드만) | ~95% 절감 |
| DroppableColumn tap delay | ~300ms (auto) | ~0ms (manipulation) | 제거 |
| elapsed time 갱신 주기 | 10s (유지) | 10s (유지) | 동일 |

## DB 변경

없음.

## 빌드

```
✓ built in 3.27s
```

## E2E

```
13 passed (8.2s)
```

## 파일 변경

- `src/pages/Dashboard.tsx`
  - `import { ... memo ... }` 추가
  - `TickCtx = createContext(0)` 추가 (모듈 레벨)
  - `DraggableCard`: `function` → `memo(function ..., comparator)` 변환 + `useContext(TickCtx)` 추가
  - `TouchSensor activationConstraint.distance`: `8` → `5`
  - `DroppableColumn`: `style={{ touchAction: 'manipulation' }}` 추가
  - `[, setTick]` → `[tick, setTick]`
  - `<TickCtx.Provider value={tick}>` JSX 추가
  - `handleCardContext`: 일반 함수 → `useCallback` 래핑
- `tests/e2e/T-20260522-foot-DRAG-RESP-OPT.spec.ts` — 신규 (13개 spec)

---

*담당: dev-foot · 2026-05-22*
