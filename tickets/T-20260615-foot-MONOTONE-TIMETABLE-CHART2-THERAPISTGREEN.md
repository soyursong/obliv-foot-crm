---
ticket_id: T-20260615-foot-MONOTONE-TIMETABLE-CHART2-THERAPISTGREEN
domain: foot
priority: P2
status: deploy-ready
block_reason: ''
requester: 김주연 총괄
thread: C0ATE5P6JTH
risk: GO
owner: agent-fdd-dev-foot
approved_by: planner NEW-TASK MSG-20260615-113155-5wkh
sibling: T-20260615-foot-THEME-MONO-REFINE-3AREA (동일 3건 스코프, 스크린샷 동봉 재발행)
stage_done: [item1-timetable-mono, item2-chart2-slate, item3-therapist-green-selected-fix, static-guard, render-guard]
stage_pending: [supervisor-QA, 갤탭-실기기-confirm]
deploy-ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-15
db-change: false
build: pass
spec: tests/e2e/T-20260615-foot-MONOTONE-TIMETABLE-CHART2-THERAPISTGREEN.spec.ts (6 pass) + tests/e2e/T-20260615-foot-THEME-MONO-REFINE-3AREA.spec.ts (17 pass) + tests/e2e/T-20260615-foot-THEME-MONO-REFINE-3AREA-render.spec.ts (desktop-chrome 3 pass — 치료사 클릭→green 실렌더)
qa_result: self-pass-pending-supervisor
commit: 70ba418
---

# T-20260615-foot-MONOTONE-TIMETABLE-CHART2-THERAPISTGREEN

김주연 총괄 모노톤 후속 3건. FE 표현 한정(DB/EF/로직 변경 0, risk=GO).

## item1 — 대시보드 통합시간표 모노톤
초진(노랑)/재진(초록) 색상 코딩 제거 → 무채색. 구분은 텍스트(초 배지)+보더 두께로만.
- 초진 카드 = 흰배경 + 진한 보더(gray-400)
- 재진 카드 = 옅은 회색 배경(gray-50) + 옅은 보더(gray-300)
- 컬럼헤더·슬롯 배경 틴트 채도 0
- src/pages/Dashboard.tsx (TimelineCheckInCard/Box1Card/Box2ReservationCard/DraggableBox1Card/DraggableBox2ResvCard/컬럼헤더/슬롯틴트)
- ※ A안 carve-out(의미색 단계구분) 경계를 reporter 명시로 축소(policy_superseded): 통합시간표 초진/재진은 색 제거 대상.

## item2 — 2번 차트(SMART DOCTOR 고객차트) 모노톤
빨강박스 구역(초진/재진 배지·환자폼 컬러강조·차트작성 컬러탭·미수금/결제 등 컬러버튼) 장식성 다색 → slate.
- src/pages/CustomerChartPage.tsx 장식색 blue/indigo/sky/violet/purple/cyan 잔존 0
- 필수 상태색 carve-out 보존: red(경고/삭제)·green/emerald(완료/재진)·amber/yellow(타이머)·teal(부모 warm-mono remap)
- 초진 배지(variant=teal→warm-brown)·재진(secondary=gray)은 teal 포인트 carve-out → 유지

## item3 — 직원 근무 캘린더 치료사 필터칩 brown 누수 → green 원복 [핵심]
- 근인: 선택 상태 칩이 모든 part `bg-teal-600` → tailwind teal→warm-brown 램프 리맵으로 brown 렌더.
- 정정: 치료사 part만 `bg-green-600 text-white` green 원복(출근자 치료사 배지 green 톤 일치).
  필터칩(L558) + 작성폼 셀렉터(L763) 양쪽 적용. 타 role 칩(상담실장 등) 불변(bg-teal-600 유지).
- src/lib/handover.ts (미선택 배지 teal→green) + src/pages/Handover.tsx (선택 칩 green 분기)
- ※ 기존 3AREA 정적가드는 미선택 배지 리터럴만 검증 → 리포터가 본 선택칩 brown 미커버였음.
  본 티켓이 선택-상태 green 정적 가드 + 실렌더(클릭 후 bg!=#6E6353 brown) 가드 추가.

## carve-out (불변)
칸반 status 의미색·emerald/green pin·출근자 role 배지 체계·teal 포인트·bg-white·index.css 토큰.
통계 대시보드 치료사 teal 막대차트는 본 티켓 아님(별도 T-20260615-foot-STATS-THERAPIST-CHART-COLOR) — 미접촉.

## 검증
- npm run build PASS
- 정적 소스 가드 6 PASS(본 spec) + 17 PASS(3AREA spec) 회귀 0
- 실렌더 desktop-chrome 3 PASS (AC1 통합시간표 + AC3 치료사 클릭→bg-green-600 실렌더, brown #6E6353 아님 확인)
- 증적: evidence/T-20260615-foot-THEME-MONO-REFINE-3AREA_AC1-timetable.png / _AC3-therapist-tab.png

## supervisor QA
대시보드 통합시간표 = 초진/재진 무채색(색 없이 텍스트+보더 구분) / 2번 차트 = 장식 다색 없이 slate(상태색 red·green·amber만) / 직원 근무 캘린더 치료사 탭 클릭 시 green(brown 아님), 타 role 탭 클릭 시 기존(brown/teal) 유지. 갤탭 실기기 확인 후 done.
