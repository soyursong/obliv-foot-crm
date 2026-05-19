---
id: T-20260519-foot-STATUS-REVERT
title: "보라색(원장님진료필요) 상태 변경 시 자동 풀림·전단계 복귀 버그"
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-05-19
deploy_ready_at: 2026-05-19
commit_sha: pending
db_migration: false
build_passed: true
e2e_spec: tests/e2e/T-20260519-foot-STATUS-REVERT.spec.ts
---

## 현장 원문

"보라색(원장님진료필요) 상태 변경하니깐 자꾸 상태 자동으로 풀리고 전단계로 돌아가는데 일시적인 오류인지 파악해줘"

## 근본 원인 (확정)

### Bug #1: `handleFlagChange` — `markRecentlyUpdated` 미호출

`Dashboard.tsx` 의 `handleFlagChange` 함수가 다른 모든 상태 변경 핸들러(`handleContextStatusChange`, `handleContextLaserStatusChange`, `handleContextConsultStatusChange`, 드래그 핸들러 등)와 달리 **`markRecentlyUpdated(ci.id)`를 호출하지 않았다**.

결과:
1. 플래그 DB 쓰기(status_flag=purple) → Realtime 이벤트 발생
2. `recentlyUpdated.current.has(id)` = `false` → `debouncedCheckInRefetch()` 트리거
3. 병행 실행 중인 `fetchCheckIns()` (다른 Realtime 디바운스나 60s 폴링)가 DB 쓰기 완료 전에 SELECT
4. MVCC 스냅샷이 쓰기 이전 값(status_flag=null) 반환
5. `setRows(filtered)` → optimistic update(보라색) 덮어씀 → 플래그 사라짐

### Bug #2: `fetchCheckIns` — `setRows(filtered)` blind 덮어쓰기

`setRows(filtered)` 가 단순 배열 교체였기 때문에, 진행 중인 optimistic update가 모두 손실됨.

---

## 수정 내용

### Fix 1: `handleFlagChange` — `markRecentlyUpdated(ci.id)` 추가

```ts
const handleFlagChange = async (ci: CheckIn, flag: StatusFlag | null) => {
  if (ci.id.startsWith('temp-')) return;
  markRecentlyUpdated(ci.id);  // ← 추가
  setRows((curr) => curr.map((r) => r.id === ci.id ? { ...r, status_flag: flag } : r));
  ...
```

### Fix 2: `fetchCheckIns` — merge 전략으로 `setRows` 교체

```ts
// Before
setRows(filtered);

// After
setRows(prev => {
  const recentIds = recentlyUpdated.current;
  if (recentIds.size === 0) return filtered;
  return filtered.map(row =>
    recentIds.has(row.id)
      ? (prev.find(r => r.id === row.id) ?? row)
      : row,
  );
});
```

`recentlyUpdated` 보호 중인 row는 로컬 상태 우선 유지 (2초 만료 후 다음 fetch에서 DB 값 적용).

---

## AC 검증 결과

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | 보라색 상태 변경 후 새로고침해도 유지 | ✅ — DB persist 정상 (기존 코드 문제 없음, fix로 optimistic 안정화) |
| AC-2 | DB persist 확인 (optimistic update 후 서버 응답 불일치) | ✅ — markRecentlyUpdated + merge 전략으로 경합 제거 |
| AC-3 | 동시접속 race condition 없음 | ✅ — merge 전략: recentlyUpdated 보호 중 fetch가 로컬 상태 보존 |
| AC-4 | 보라색 한정 버그인지 확인 | ✅ — 모든 status_flag 공통 수정 (fix는 플래그 종류 무관) |
| AC-5 | 수정 후 다른 상태 전이 회귀 없음 | ✅ — merge 전략은 recentlyUpdated 없는 row에 영향 없음 |

## DB 변경

없음 (DB schema, RLS, migration 모두 불변).  
- `status_flag` CHECK constraint에 'purple' 정상 포함 확인.

## 빌드

- `npm run build` ✅ 통과

## 파일 변경

- `src/pages/Dashboard.tsx` (2개소)
  - L2311: `setRows(filtered)` → merge 전략
  - L3463: `markRecentlyUpdated(ci.id)` 추가

---

*담당: dev-foot · 2026-05-19*
