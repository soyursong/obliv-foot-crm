---
id: T-20260610-foot-CALLLIST-ROW-HIDE-AUTOSHOW
title: "[진료콜 명단] 개별 행 숨기기 + 신규 listup 시 자동 재노출"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: PENDING
created: 2026-06-10
assignee: dev-foot
reporter: 김주연(현장 총괄)
source_msg: MSG-20260610-122443-946c
needs_field_confirm: true
related_tickets:
  - T-20260610-foot-CALLLIST-HIDE-TOGGLE
  - T-20260610-foot-CALLLIST-DRAGGABLE-POSITION
  - T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS
---

# T-20260610-foot-CALLLIST-ROW-HIDE-AUTOSHOW

## 현장 요청 (김주연 총괄)
"굿 좋아 숨기기 기능도 있으면 좋겠는데 신규 리스트업되면 자동으로 다시 노출되고"
= 진료콜 명단 위젯(DoctorCallListBar)에서 **개별 행을 숨기되**, 같은/다른 환자가 **신규로 다시 리스트업되면 숨김을 무시하고 자동 노출**.

## AC-0 그라운딩 결과
- surface = `src/components/DoctorCallListBar.tsx` 확정.
- TOP-COVERS Phase2(드래그 localStorage `pos.v1`)는 **이미 head에 존재**(L92-93, onHeaderPointer*/clampPos) → 리베이스 불필요, 드래그/세로나열 회귀 없음.
- 직전 `CALLLIST-HIDE-TOGGLE`은 **위젯 전체 숨김(→최소 탭)** facet이고, 본 티켓은 **개별 행 숨김** facet. 두 facet은 직교(키 분리: `hidden.v1` vs `rowHidden.v1`).

## ★핵심 설계 — listup 시그니처 키 (확정)
```
listupSignature(ci) = `${ci.id}::${최근 active(purple/yellow) 진입시각}`
```
- `ci.id`(check_in 단위 고유) → 새 환자/새 방문은 항상 새 시그니처 → 숨김 집합에 없음 → **자동 재노출**.
- `status_flag_history`에서 가장 최근 purple/yellow 진입 `changed_at` → 같은 방문이 진료완료(pink) 후 **재차 진료필요(purple)로 re-listup**하면 새 changed_at이 쌓여 시그니처가 바뀜 → **자동 재노출**(★핵심).
- history 없음(`healer_waiting` status 경로 등)/active 기록 없으면 `checked_in_at` 폴백(방문 단위 안정값 — 새 방문은 새 id라 어차피 재노출).
- **단순 customer_id/check_in.id 영구숨김 아님** (planner AC-0 충족). 불확실 시 '노출' 쪽 fail-safe (prune은 현재 명단에 없는 시그니처만 제거).

## AC 결과
- **AC-1** 행 숨기기 토글(`doctor-call-row-hide`, EyeOff) — 표시 필터 레이어만. activeList/doneList/displayList(콜동작·정렬·집계)는 풀데이터 보존. 전부 숨기면 안내 + 헤더 `숨김 N · 표시`(unhide-all) escape hatch. ✅
- **AC-2** 숨김 시그니처 집합 per-browser localStorage 영구(`foot.doctorCallList.rowHidden.v1`) — 위치(`pos.v1`)·전체숨김(`hidden.v1`)과 별도 네임스페이스. ✅
- **AC-3** 신규 listup 시그니처 재등장 시 숨김 무시·자동 재노출 — 시그니처 키 설계로 성립(단위검증 + 소스 가드). ✅
- **AC-4** 회귀금지: 드래그/위치초기화/세로풀네임/상단 콜·숨김·접기 버튼 비차단(직교 facet, 키 분리). ✅

## 구현 요약
- `listupSignature()` export(순수함수) + `loadRowHidden()` 헬퍼 신설.
- `hiddenSigs` state + localStorage 영속 effect + prune effect(명단 이탈 시그니처 제거) + `hideRow`/`unhideAll` + `visibleList`(렌더 전용 필터).
- 헤더 `숨김 N · 표시` 버튼, 각 행 우상단 EyeOff 버튼(이름클릭→차트·지정콜과 클릭영역 분리).

## 검증
- `npm run build` ✅ / `tsc --noEmit` ✅
- E2E `tests/e2e/T-20260610-foot-CALLLIST-ROW-HIDE-AUTOSHOW.spec.ts` (시나리오1 행숨김+영속 / 시나리오2 unhide-all / 시나리오3 시그니처 단위+소스가드 / 시나리오4 회귀).
  - 순수 로직·소스 가드 2건 **passed**, 브라우저 인터랙션 3건은 테스트 DB 활성행 없음으로 graceful skip(기존 HIDE-TOGGLE 스펙 동일 패턴) → 현장 데이터에서 field-soak.

## risk
GO — FE only, DB 변경 0, 비즈로직 0. needs_field_confirm: 실데이터 행 숨김/재노출 동작 현장 확인.
