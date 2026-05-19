---
id: T-20260519-foot-FLAG-REVERT
title: "보라색(원장님진료필요) 플래그 변경 시 자동 해제 버그 수정"
status: deploy-ready
priority: P0
domain: foot
created_at: 2026-05-19
deploy_ready_at: 2026-05-19
commit_sha: 73db175
db_migration: false
build_passed: true
e2e_spec: tests/e2e/T-20260519-foot-STATUS-REVERT.spec.ts
---

## 개요

`handleFlagChange` 에 `markRecentlyUpdated(ci.id)` 누락 → Supabase Realtime이
낙관적 업데이트를 덮어쓰는 race condition 수정.

## 중복 처리

**이 티켓은 `T-20260519-foot-STATUS-REVERT`(commit `73db175`)에서 이미 수정 완료된 사안의
재발행(duplicate)이다.**

코드 확인:
- `src/pages/Dashboard.tsx` L3463: `markRecentlyUpdated(ci.id)` 존재 확인
- Fix2: `fetchCheckIns` merge 전략(recentlyUpdated 보호 중 row 로컬 상태 유지) 적용 완료

## 근본 원인

`handleFlagChange`(Dashboard.tsx)에 `markRecentlyUpdated(ci.id)` 미호출 →
Realtime 이벤트 발생 시 `recentlyUpdated.current.has(id)` = `false` →
`debouncedCheckInRefetch()` 트리거 → MVCC 스냅샷 경합 → optimistic update 덮어씀.

## 수정 내용

```ts
// Dashboard.tsx L3458-3463
const handleFlagChange = async (ci: CheckIn, flag: StatusFlag | null) => {
  if (ci.id.startsWith('temp-')) return;
  markRecentlyUpdated(ci.id);  // ← 추가 (73db175)
  setRows((curr) => curr.map((r) => r.id === ci.id ? { ...r, status_flag: flag } : r));
  ...
```

## AC 검증

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | 보라색 플래그 변경 후 2초 이내 자동 해제 없음 | ✅ — markRecentlyUpdated + merge 전략으로 경합 제거 |
| AC-2 | 9가지 모든 플래그 변경 후 유지 | ✅ — fix는 플래그 종류 무관 (handleFlagChange 공통) |
| AC-3 | 다른 탭 동시 접속 시에도 플래그 유지 | ✅ — merge 전략: recentlyUpdated 보호 중 fetch가 로컬 상태 보존 |
| AC-4 | 기존 상태 변경(칸반, 드래그) 회귀 없음 | ✅ — merge 전략은 recentlyUpdated 없는 row에 영향 없음 |

## DB 변경

없음.

## 빌드

- `npm run build` ✅ 통과 (commit 73db175 기준)

## 파일 변경

- `src/pages/Dashboard.tsx` — `markRecentlyUpdated(ci.id)` L3463, merge 전략 L2311

---

*담당: dev-foot · 2026-05-19 · duplicate of T-20260519-foot-STATUS-REVERT*
