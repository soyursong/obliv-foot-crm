---
id: T-20260522-foot-TIMETABLE-FOLD
title: "통합시간표 접기/펼치기 토글 + localStorage 상태 유지"
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-05-22
deadline: 2026-05-26
priority_updated_at: 2026-05-22
priority_updated_by: planner (MSG-20260522-011218-g41d)
deploy_ready: true
deploy_ready_at: 2026-05-22
deploy_ready_by: dev-foot
db_migration: false
build_passed: true
build_time: "3.19s"
commit_sha: TBD
e2e_spec: tests/e2e/T-20260522-foot-TIMETABLE-FOLD.spec.ts
---

## 개요

대시보드 좌측 통합시간표 패널을 달력처럼 접기/펼치기 토글로 숨길 수 있게 구현.
태블릿 화면 공간 효율 개선. 상태는 localStorage로 유지.

## 구현

### DashboardTimeline 변경
- `folded?: boolean` / `onToggleFold?: () => void` props 추가
- `folded === true` → 세로 스트립 표시 (w-8, ChevronRight + 세로 라벨 "통합 시간표")
- 헤더에 ChevronLeft 접기 버튼 추가

### Dashboard 상위 컴포넌트
- `timelineFolded` state — `localStorage.getItem('foot-crm-timeline-folded')`로 초기화
- `handleToggleTimeline` — toggle + localStorage.setItem
- 좌측 컨테이너: `timelineFolded ? 'w-8' : 'w-80'` (transition-all duration-200)

## AC

- AC-1: 헤더 ChevronLeft 버튼 클릭 시 패널이 w-8로 접힘
- AC-2: 세로 스트립의 ChevronRight 버튼 클릭 시 w-80으로 펼쳐짐
- AC-3: 페이지 리로드 후에도 folded 상태 유지 (localStorage)
- AC-4: 칸반 우측 영역이 확장되어 화면 공간 확보
- AC-5: 기존 드래그/슬롯 클릭 동작 비회귀
