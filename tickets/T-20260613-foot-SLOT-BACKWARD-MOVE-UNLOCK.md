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
commit_sha: b9b2eaf
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

---

## 🔁 REOPEN (2026-06-13 17:34, MSG-20260613-173450-4840 / P1)

현장(김주연 총괄) 17:30 동일증상 재보고 — morning fix(ce5d6a7) 이후에도 "이전 단계 이동 막힘". 3가설 검증:

### 가설 검증 결과
1. **번들 env 미적용 — 기각.** 현장 문서상 실 URL = `obliv-foot-crm.vercel.app`(README/iPad가이드). version.json buildId=`8f6f697`(=ce5d6a7 morning fix 포함 commit). pages.dev도 08:34 빌드(post-fix). **morning ⋮ fix는 양 도메인 이미 라이브** → 구 번들 아님.
2. **DnD INACTIVE-ROOM over-block — 기각(코드 확정).** `blockIfInactiveRoom`은 `inactiveRooms.has(roomName)`로 진짜 비활성 방만 차단. consultation/treatment는 carry_over=false(매일 활성 리셋), 활성 방 드롭 비차단. status-column 직접 드롭(else branch)도 backward 가드 없음(MEDLAW22는 'done' 한정). 즉 ⋮메뉴 핸들러 + DnD 3경로(room/column/returning) **모두 코드상 역방향 완전 허용**.
3. **opacity-50 시각 오인 — ✅ 확정 원인.** morning fix가 `opacity-50`+`text-muted-foreground`+`bg-gray-300` dot(disabled-look)을 **의도적으로 유지**. 코드·배포 모두 정상인데 현장이 회색 처리된 이전 단계를 "막혀 있음"으로 오인 보고. → disabled-look 제거.

### 추가 수정 (StatusContextMenu.tsx)
- `isPast && 'text-muted-foreground opacity-50'` → `isPast && 'text-gray-700'` (정상 클릭 가능한 텍스트)
- 점(dot) `isPast ? bg-gray-300 : bg-gray-400` → 통일 `bg-gray-400` (미래 단계와 동일 "활성" 점)
- `!isCurrent` 항목에 `cursor-pointer` 추가
- 역방향(isPast) 항목 + 방 서브메뉴 화살표 없을 때 **"되돌리기"(Undo2) 어포던스 배지**(teal) 노출 — "막힘"이 아닌 "되돌리기 가능" 명시

### REOPEN AC
- AC-R1 ⋮·드래그 둘 다 수납대기→상담 역이동 — ⋮ 핸들러/DnD 코드 확정(양 경로 backward 무가드). 라이브 칸반 조작은 macstudio E2E.
- AC-R2 활성 방 역방향 드래그 비차단 — ✅ (blockIfInactiveRoom 비활성 한정, consultation/treatment 매일 활성)
- AC-R3 역방향 항목 disabled-look 아님 + 되돌리기 어포던스 — ✅ (opacity-50 제거, Undo2 배지)

### REOPEN 산출
- src/components/StatusContextMenu.tsx (disabled-look 제거 + 되돌리기 배지)
- tests/e2e/...SLOT-BACKWARD-MOVE-UNLOCK.spec.ts AC-R3 추가 (opacity-50 잔존 0 + 되돌리기 클릭가능)
- 번들 검증: dist/assets/Dashboard-*.js 에 '되돌리기' 포함 확인 / build OK / tsc clean
- ⚠️ 실 칸반 라이브 E2E(login+DB)는 baseURL=localhost:8089 — macstudio supervisor 실행 영역. push로 vercel.app 자동 재배포.
