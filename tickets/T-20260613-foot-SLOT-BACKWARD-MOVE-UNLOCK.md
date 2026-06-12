---
id: T-20260613-foot-SLOT-BACKWARD-MOVE-UNLOCK
title: "[대시보드] 슬롯 전(前)단계 이동 차단 해제 (임상 역행 허용)"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: ce5d6a7
created: 2026-06-13
assignee: dev-foot
reporter: 김주연 총괄
source_msg: MSG-20260613-073520-d5ms
risk_verdict: GO
---

# T-20260613-foot-SLOT-BACKWARD-MOVE-UNLOCK — 전단계 이동 차단 해제

## 배경
현장(김주연 총괄): 관리자/직원 전 계정에서 슬롯 전단계 이동이 막힘. 임상상 역행 필수(예: 수납대기 고객이 후상담 요청 → 상담 단계로 되돌림). 긴급 해제(P1 hotfix).

## 진단
- 주 차단지점: `src/components/StatusContextMenu.tsx` '현 진행단계' — isBackward 봉쇄.
  - L176 `disabled={isCurrent||isBackward}`, L157 `if(isBackward)return;`, L142-144 서브메뉴 `!isBackward` 가드.
- DnD(`Dashboard.tsx handleDragEnd`): forward-only 가드 없음. `blockIfInactiveRoom`(L4291/L4364)은 `inactiveRooms.has(roomName)` — **비활성 방 한정**. 활성 방 역방향 드롭은 차단 안 됨 → over-fire 없음(AC-4 코드 레벨 충족, 교정 불요).

## 수정
- `disabled={isCurrent||isBackward}` → `disabled={isCurrent}`
- onClick `if(isBackward)return;` 제거
- `showSubArrow`/`showTreatArrow`/`showConsultArrow`의 `!isBackward` 가드 제거 → 역방향 방 서브메뉴 노출
- `isBackward` 미사용 선언 제거(lint)
- hover 피드백을 `!isCurrent`로 확장(역방향 단계도 hover 표시), opacity-50 시각 힌트 유지

## DB
변경 없음. status_transitions가 임의 from→to 이미 처리, 역행도 이력 1행 남김.

## AC
- AC-1 ⋮ 역방향 선택가능 + 실이동 — ✅ (disabled 해제, onStatusChange 트리거)
- AC-2 수납대기→상담 후상담 동선 — ✅
- AC-3 역방향 방 서브메뉴 정상 — ✅ (!isBackward 가드 제거)
- AC-4 활성방 DnD 역행 비차단 — ✅ (blockIfInactiveRoom 비활성 한정, 코드 확정)
- AC-5 정방향 무회귀 — ✅ (정방향 경로 불변)

## 산출
- commit ce5d6a7 (main, Vercel 자동배포)
- tests/e2e/T-20260613-foot-SLOT-BACKWARD-MOVE-UNLOCK.spec.ts (AC-1/2/3/5)
