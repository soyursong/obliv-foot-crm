---
id: T-20260615-foot-DASH-CROSSACCT-REALTIME-LAG
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
qa_result: pass
deploy_commit: 4dc15f92
deployed_at: 2026-06-15T18:42:40+09:00
bundle_hash: Dashboard-tQNepsOX
e2e-spec: tests/e2e/T-20260615-foot-DASH-CROSSACCT-REALTIME-LAG.spec.ts
e2e_spec_exempt_reason: null
db-gate-handoff: null
created: 2026-06-15
assignee: dev-foot
reporter: planner
source_msg: MSG-20260615-175625-o14q
needs_field_confirm: true
---

# T-20260615-foot-DASH-CROSSACCT-REALTIME-LAG — 계정 간 realtime 전파 지연·누락 견고화

현장(김주연 총괄, #foot) 통증:
- (A) 주통증 — A계정에서 고객을 레이저실로 이동(슬롯/방 이동) 시 B계정 대시보드에 즉시 안 뜸. 새로고침 여러 번 또는 끝내 누락. 기대 = 새로고침 없이 수 초 내 자동 반영.
- (B) 갤럭시탭 로그인 로딩 김 → **분리 처리**: 자매 티켓 `T-20260615-foot-GALAXYTAB-LOGIN-SLOW` (source_msg MSG-20260615-181852-ak9z, deploy_commit fa6dbc0, qa_result pass, critical-path -36%). 본 티켓 AC4는 그 티켓으로 충족.

## 진단 (계측 우선, 추측성 재작성 금지)

근본원인 3종 — 코드/로그로 확정. **쓰기(이동) 로직 무변경, 읽기/전파 경로만 보강** (DB엔 이미 반영 = A에선 보임, 전파/표시만 결함):

1. `.subscribe()` 재연결(status) 핸들러 부재 → WebSocket 끊김/재연결 동안 유실된 `postgres_changes` 미보충 (Supabase 소켓은 자동 재연결하나 끊김 구간 이벤트는 재생 안 됨).
2. 탭 백그라운드→포그라운드 복귀 / 창 포커스 시 강제 refetch 부재 → background throttle로 stale 잔존.
3. 30초 폴링 fallback이 `fetchAssignments`/`fetchRooms` 미커버 → 방배정·슬롯 변경 누락.

## 수정 (src/pages/Dashboard.tsx, commit 4dc15f92)

- `.subscribe((status)=>…)` 핸들러: `SUBSCRIBED` 재구독마다 `fullResync()` catch-up + `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` 안전망 동기화.
- `document` `visibilitychange` + `window` `focus` 리스너 → 복귀 시 `fullResync()`.
- 30초 폴링에 `fetchAssignments` + `fetchStageStarts` + `fetchRooms` 추가 (ref 가드로 커스텀 슬롯 유지).

## AC 검증

- **AC1** A→B 새로고침 없이 ≤5초 자동반영 → E2E 실측 latency **970ms** (목표 ≤5000ms). ✅
- **AC2** 간헐 미표시·끝내 안 뜸 0 (탭 백그라운드 복귀 포함) → 연속 status 이동 수신 누락 0 + visibility/focus fullResync. ✅
- **AC3** 재연결·focus refetch 견고 → SUBSCRIBED 재구독 catch-up E2E PASS. ✅
- **AC4** 갤럭시탭 로그인 로딩 개선 → 자매 티켓 GALAXYTAB-LOGIN-SLOW (critical-path 1063.6KB→679.1KB, -36%) 충족.
- **AC5** 회귀0 (SLOT-DRAG 이동동작·REALTIME-FAIL 자동전환·쓰기/결제/차트 무변경) → DASH-REALTIME-FAIL·SLOT-DRAG·SPACE-DASH-SYNC 회귀 14 PASS, 쓰기/결제/차트 코드 미접촉. ✅

## E2E

`tests/e2e/T-20260615-foot-DASH-CROSSACCT-REALTIME-LAG.spec.ts` (2세션 live Supabase 전파 시나리오):
- AC-1 A세션 레이저실 이동 → B세션 realtime 이벤트 ≤5초 수신.
- AC-2 여러 status 연속 이동 → B세션 전건 수신 (간헐 누락 0).
- AC-3 끊김 동안 변경분 → 재구독/복귀 시 fullResync 직접 fetch로 동기화.
→ 4 passed. 회귀 14 passed. build green (4.22s, exit 0).

## 잔여 게이트 (dev 밖)

- supervisor 재QA GO/NO-GO (코드는 이미 prod 배포 = 4dc15f92, HEAD 조상).
- 현장 confirm: 2대 갤탭 실기기에서 A 이동 → B 자동반영 김주연 총괄 확인 (needs_field_confirm=true, live realtime 체감은 실기기 필수).
