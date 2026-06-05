---
id: T-20260606-foot-CALENDAR-COLLAPSE-ROTATE
domain: foot
status: deploy-ready
priority: P2
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260606-foot-CALENDAR-COLLAPSE-ROTATE.spec.ts
e2e_spec_exempt_reason: null
qa_result: pass
created: 2026-06-06
commit: pending
component_note: "planner 추정(진료환자목록 DATENAV 달력)과 다름 — 실제 원인은 대시보드 좌측 사이드바 CalendarNoticePanel PC 접힘(pc-cal-bar) 세로 날짜 strip. 재현으로 확정."
---

# T-20260606-foot-CALENDAR-COLLAPSE-ROTATE — 달력 접기 시 글씨 회전 버그

## 요청
문지은 대표원장 (#project-doai-crm-풋확장, 6/6). 달력을 접으면 캘린더 내부 글씨(요일/날짜)가
전부 회전·뒤집혀 보임. 기능은 정상, 시각만 깨짐. P2, FE-only CSS 렌더(GO).

## 원인 (재현으로 확정)
대시보드 좌측 `CalendarNoticePanel` PC 접힘 상태(`pc-cal-bar`)의 세로 날짜 strip을
`writing-mode: vertical-rl` + `transform: rotate(180deg)` 로 구현.
한글(CJK)은 `vertical-rl` 만으로 세로 정상 표기되는데 거기에 `rotate(180deg)`까지 적용해
날짜 문자열("6월 6일 (토)")이 통째로 위아래로 뒤집힘.

## 조치
- `src/components/CalendarNoticePanel.tsx` 세로 날짜 strip:
  `transform: rotate(180deg)` 제거 → `text-orientation: upright` 로 교체.
  한글·숫자·괄호 모두 똑바로 선 채 위→아래로 읽힘(정상 방향).
- 회귀: 펼치기 시 미니캘린더 요일 헤더(일~토)·날짜 셀 정상 방향 유지(원래 transform 없음).

## AC
- AC-1: 달력 collapse 후 세로 날짜 strip 텍스트가 회전/뒤집힘 없이 정상 방향. expand 회귀 방지.

## 검증
- build OK (3.56s). tsc 통과.
- E2E `tests/e2e/T-20260606-foot-CALENDAR-COLLAPSE-ROTATE.spec.ts` (desktop-chrome, 실브라우저):
  접기→strip transform 에 180° 회전 행렬(`matrix(-1,0,0,-1)`) 부재 단언 + 펼치기 회귀 2종 pass.
- DB 변경: 없음 (FE-only CSS).
