---
id: T-20260522-foot-TIMETABLE-SCROLL
title: 통합시간표 태블릿 세로 모드 세로 스크롤 부재
status: deploy-ready
priority: P1
domain: foot
created: 2026-05-22
deploy_ready: true
commit_sha: d7156a5
build_ok: true
db_changed: false
e2e_spec: tests/e2e/T-20260522-foot-TIMETABLE-SCROLL.spec.ts
parent: T-20260522-foot-TIMETABLE-FOLD
---

## 현장 보고

김주연 총괄 — TIMETABLE-FOLD 배포 후 태블릿 세로 모드에서 시간표 하단 짤림.
가로 모드 정상. 새로고침 무관.

## 근본 원인 분석

TIMETABLE-FOLD에서 추가된 `viewMode 탭바(shrink-0, 44px)`가 inner scroll의 가용
높이를 축소. portrait 모드에서 `md:overflow-hidden + CSS max-width:2rem` 조합이
flex-1 min-h-0 높이 체인을 방해 → inner scroll 높이가 콘텐츠 높이(1008px)로 팽창
→ 부모 overflow:hidden이 하단 ~90px 클립. overflow-y:auto 스크롤 컨텍스트 미생성.

## 수정 내용

### src/pages/Dashboard.tsx
- `timeline-inner-scroll` data-testid를 내부 스크롤 div에 추가
- CSS portrait 스타일과 바인딩을 위한 앵커 역할

### src/index.css
- `[data-orientation="portrait"] [data-testid="timeline-inner-scroll"]` 셀렉터 추가
- `max-height: calc(100dvh - 200px)` — flex 높이 팽창 방지 + 스크롤 컨텍스트 강제 확보
- `overflow-y: auto` — 세로 스크롤 명시 보장
- `100vh` fallback 제공 (구형 브라우저 호환)

## 수용기준 검증

- AC-1 ✅: portrait 세로 스크롤 CSS 규칙 + data-testid 존재
- AC-2 ✅: landscape 전용 셀렉터 없음 → 가로 모드 회귀 없음
- AC-3 ✅: unfolded 분기에만 timeline-inner-scroll 렌더 → 토글 공존
- AC-4 ✅: data-orientation 조건부 → PC 무영향
- AC-5 ✅: 클릭/드래그 핸들러 코드 무변경

## 빌드 / 테스트

- 빌드: ✅ 3.31s
- E2E: ✅ 12/12 spec 통과
- DB 변경: 없음
