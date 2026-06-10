---
id: T-20260609-foot-CALLLIST-NAME-VERTICAL-LAYOUT
domain: foot
priority: P2
status: superseded
superseded_by: T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS
superseded_date: 2026-06-10
title: 원장님 진료콜 명단 — 성함 전체표시 + 세로 나열 + 인원 증가 시 자연 확장
created: 2026-06-09
assignee: dev-foot
reporter: 김주연 총괄
db-change: false
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260609-foot-CALLLIST-NAME-VERTICAL-LAYOUT.spec.ts
commit_sha: 396167b
spec_file: tests/e2e/T-20260609-foot-CALLLIST-NAME-VERTICAL-LAYOUT.spec.ts
---

> ⛔ SUPERSEDED (2026-06-10) by **T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS**.
> 본 티켓이 채택한 외곽 패널 세로 앵커 `top-4`(우상단)가 대시보드 상단 동작버튼을 가리는
> P0 회귀를 유발 → TOP-COVERS-BUTTONS Phase 1에서 `bottom-4`(우하단)로 정정·대체됨.
> 세로 나열·성함 전체표시·HEALER 무회귀 AC는 후속 티켓이 승계 보존. 이 티켓은 종결.

# T-20260609-foot-CALLLIST-NAME-VERTICAL-LAYOUT — 진료콜 명단 레이아웃 개선

## 배경
대시보드 '원장님 진료콜 명단' 위젯(`src/components/DoctorCallListBar.tsx`)이
가로 카드 나열 + 고정 높이(max-h-[42vh]) + 카드 폭 고정(w-56) + 이름 truncate 구조라
(1) 긴 고객 성함이 말줄임으로 잘리고, (2) 인원이 많으면 가로/내부 스크롤로 한눈에 안 들어옴.
현장(김주연 총괄) 요청으로 세로 나열 + 자연 확장 + 성함 전체표시로 개선. DB 무변경(표시 레벨).

## 요구 (3건)
1. 성함 잘림 제거 — 이름 요소 truncate → whitespace-normal + break-words. 긴 이름도 전체 표시.
2. 가로 스크롤 → 세로 나열(flex-col, 위→아래 스택).
3. 고정/제한 높이(max-h) + overflow 제거 → height auto. 인원 늘수록 컨테이너 아래로 자연 확장,
   내부 스크롤 없이 한눈에.

## 구현 (DoctorCallListBar.tsx, DB 무변경)
- 외곽 팝업: `fixed bottom-4 right-4 ... max-h 없음` 유지하되 세로 앵커를 `bottom-4 → top-4`로 변경.
  → bottom 앵커는 height 증가 시 위로 자라 뷰포트 상단에서 잘림. top 앵커여야 "아래로 자연 확장"
  (현장 문구) 그대로 동작. 가로 위치(우측 right-4)는 DASH-POPUP-RIGHT-FIX의 '우측 고정' AC 보존.
- 행 컨테이너: `flex gap-2 overflow-x-auto px-3 py-2 max-h-[42vh]` → `flex flex-col gap-2 px-3 py-2`.
- 행 카드: `shrink-0 w-56` → `w-full` (세로 나열 → 패널 폭 가득).
- 이름 버튼: `truncate` → `whitespace-normal break-words min-w-0`. 이름 그룹 `items-center` →
  `items-start flex-wrap`로 긴 이름 줄바꿈 시 배지 정렬 자연스럽게.

## AC
- AC-1: 이름 요소가 truncate 아님(whitespace-normal/break-words) — 긴 이름 전체 표시.
- AC-2: 행 컨테이너 flex-direction column, 가로 overflow-x-auto 제거.
- AC-3: 행 2개↑일 때 위→아래 세로 누적, 행 컨테이너 내부 세로 스크롤 없음(height auto).
- AC-3b: 외곽 팝업 fixed top-4 right-4 (max-h 없음), bottom-4 부재.
- AC-4: HEALER-POSITION fix(힐러 inclusion `status==='healer_waiting'` OR + 위치배지) 레이아웃
  변경 후에도 회귀 없이 유지.

## 시나리오 (E2E)
- 시나리오1 긴 성함 전체표시(잘림 없음) → AC-1
- 시나리오2 세로 나열 + 자연 확장(내부 스크롤 X) → AC-2/AC-3/AC-3b
- 시나리오3 기존 기능(HEALER fix 포함) 무회귀 → AC-4

## COORDINATE 처리
- 동일 파일 in-flight T-20260609-foot-CALLLIST-HEALER-POSITION은 이미 머지·배포 확정
  (50173ce, deploy confirmed 1b25ce6) → 머지 conflict 없음. 현재 main 위에 레이아웃을 얹음.
- HEALER fix 동작(힐러 inclusion·위치배지)이 레이아웃 변경 후 회귀 없음 spec(AC-4)로 검증.

## 결과
- build OK. E2E: NAME-VERTICAL 3 pass / 4 skip(데이터 의존 graceful) +
  HEALER-POSITION·DONE-INACTIVE 회귀 11 pass / 1 skip.
