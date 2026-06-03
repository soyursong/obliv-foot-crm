---
id: T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL
ticket_id: T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL
title: 통합시간표 현재 시각 자동 스크롤 + 라이브 마커
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 1692e6a
deployed_at: null
bundle_hash: null
e2e_spec: tests/e2e/T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL.spec.ts
db_migration: none
regression_risk: low
reporter: planner (MSG-20260603-185806-j4nb)
created_at: 2026-06-03
---

# T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL

## 지시 (planner, MSG-20260603-185806-j4nb)
통합시간표 현재 시각 자동 스크롤 + 라이브 마커. 대상: obliv-foot-crm 대시보드 > 통합시간표.
FE 전용(DB/RPC 무변경).

## 구현 (src/pages/Dashboard.tsx, DashboardTimeline)
- **AC-1 진입 자동 스크롤**: `scrollToNow()` — 현재 슬롯 행(`currentSlotRef`)이 있으면
  `scrollIntoView({block:'center'})`. 없으면(영업시간 외) `innerScrollRef` 컨테이너에서
  첫/마지막 `timeline-slot-row`로 클램핑 → 그리드 범위 밖에서도 깨지지 않음.
  `didInitialScrollRef`로 진입 시 1회만 실행(슬롯 30분 전환마다 재스크롤 안 함 → 사용자
  스크롤 보존). 날짜 이탈 시 플래그 리셋 → 오늘 재진입 시 다시 1회.
- **AC-2 라이브 마커**: 현재 슬롯 행에 `relative` + absolute 가로 마커(`timeline-now-marker`,
  rose-500) + `HH:mm` 라벨. 슬롯 내 분 비율(`nowFraction = (현재분-슬롯시작분)/slot_interval`,
  0~1 클램프)로 `top%` 배치. `pointer-events-none`·`z-30`으로 클릭/드래그 무방해.
  기존 `now` 30초 인터벌(≤60초)이 마커 위치를 함께 구동 — 별도 인터벌 불필요.
- **AC-3 "지금" 버튼**: 헤더에 `timeline-now-jump`(Crosshair) 추가. `scrollToNow` 재사용.
  오늘(`isToday`)·시간표 뷰(`viewMode==='time'`)에서만 노출.
- **AC-4 정리**: `now` 30초 인터벌 `clearInterval` 유지(언마운트 시 정리). 추가 인터벌 없음.
- **AC-5 회귀**: fold/orientation 로직 무변경. 모바일 가로스크롤·sticky 시간열 그대로.
  변경은 순수 가산(마커·버튼·스크롤 1회). DB/RPC 무변경.

## E2E (tests/e2e/T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL.spec.ts) — 3/3 pass
- AC-1/AC-3: 진입 시간표 로딩 + "지금" 버튼 클릭 무손상, 마커 뷰포트 내 위치.
- AC-2: 영업시간 내 마커 단일·`top%`·`HH:mm` 라벨 검증 / 영업시간 외 마커 미렌더·그리드 무손상 분기.
- AC-5: 모바일 portrait 가로스크롤 회귀 없음 + 펼친 시간표 sticky 시간열·"지금" 버튼.

## 셀프 QA 노트
- `npm run build` OK, `tsc --noEmit` OK.
- 실행 시각 18:56(영업시간 내)이라 마커 분기(markerCount>0) 실제 커버됨.
- 참고: 기존 T-20260514-MOBILE-HSCROLL spec 2건은 portrait 자동 fold(T-20260522, 5/22)로
  인한 **사전 존재 stale 실패** — 본 변경과 무관(fold 로직 미변경). planner FOLLOWUP 보고.
