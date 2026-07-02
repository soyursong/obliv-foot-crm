---
id: T-20260702-foot-SIDEBAR-STAFFCAL-GRAY-DUTYWIDTH
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 6105dd82 (fix(foot): 의사 근무표 헤더 아이콘 warm 잔존 제거 → 무채색 통일)
deployed_at: n/a (코드 origin/main 반영 — Vercel 자동배포·supervisor QA 대기)
bundle_hash: n/a (NOT yet verified on prod)
db_change: false
e2e_spec: tests/e2e/T-20260702-foot-SIDEBAR-STAFFCAL-GRAY-DUTYWIDTH.spec.ts (7 시나리오 — 마커/AC1 섹션브라운0/AC3 gray치환/AC2 의미색보존/AC4 로직불변/AC1+ 페이지전체 warm className 0, 全 PASS)
medical_confirm_gate: n/a (Handover /admin/handover = 근무 캘린더·인수인계 = 직원 스케줄링 surface. 진료대시보드·진료관리 아님 → §11/§11.1 게이트 무관, 순수 장식색 className 치환)
summary: "근무표 페이지(/admin/handover) 사이드바 2건 회귀 정정 FIELD-SOAK FAIL 3차 마무리. 직전 정비(aa7026d1 직원 근무 캘린더 무채색·e85f8a35 DutyRosterTab ROSTER_TYPE_COLOR 무채색·ebbd5c3c 가로폭 원복)로 본문은 이미 무채색·풀폭이나, Handover.tsx 상단 '의사 근무표' 섹션 헤더 CalendarDays 아이콘 text-teal-600 1건이 미치환 잔존 → THEME-MONOCHROME teal 램프에서 Umber(#6E6353) 브라운으로 렌더되던 마지막 warm 소스. text-gray-500 치환(직원 근무 캘린더 헤더 아이콘과 동일 무채색 통일). AC-1(④ 직원 근무 캘린더 warm 잔존 0): 맥스튜디오 브라우저 실렌더 육안 대조 — 근무표 페이지 전 경로(직원 근무 캘린더 MonthGrid/WeekStrip/CellAttendees·출근자 slate 칩·의사 근무표 DutyRosterTab·헤더 아이콘) warm className 전수 0건, gray 확정. 주말 red/blue·삭제 red-600 의미색 보존. AC-2(⑤ 의사 근무표 가로폭): ebbd5c3c 로 w-full·이름컬럼 w-28·셀 px-3/px-2 원복 완료 — 실렌더 풀폭·여유 확인(문지은 행 + 6요일 넓은 근무셀, 옹졸 해소·회귀0). 세로 컴팩트(h-8·py-1)·'원장님' 문구 제거 유지. 순수 FE className(1줄)·db_change=false. build OK(5.32s), spec 7 PASS(AC1+ 페이지 전체 warm className 0 가드 신설)."
created: 2026-07-02
assignee: dev-foot
owner: agent-fdd-dev-foot
---

## 요청 (planner NEW-TASK, MSG-20260702-164452-wmne)
현장(김주연 총괄, 풋센터) 사이드바 2건 회귀 정정.
- AC-1 ④ 직원 근무 캘린더 컬러: 브라운/warm 전부 제거 → 무채색 회색톤, 하드코드·토큰·인라인 전 경로 점검, warm 잔존 0.
- AC-2 ⑤ 의사 근무표 가로 폭: 세로 조밀·문구 제거 과정 회귀분('옹졸'), 가로 폭(width/min/max)만 원복. 세로·문구 제거 유지.
- 공통: 데이터·저장·스케줄 무접촉, 반응형 유지, 육안 검증 필수(빌드/grep만 pass 금지).

## 처리 요약
직전 세션들이 근무표 페이지 본문을 이미 무채색·풀폭으로 정비(aa7026d1·e85f8a35·ebbd5c3c). 본 세션은
맥스튜디오 브라우저 실렌더 육안 대조로 전 경로를 재점검, **의사 근무표 섹션 헤더 아이콘(text-teal-600
=Umber 브라운)** 이라는 마지막 warm 잔존 1건을 찾아 무채색화. AC-2 가로폭은 실렌더 풀폭 확인(추가변경 불요).

## 수용기준 결과
- AC-1 (④ 직원 근무 캘린더 warm 잔존 0): PASS — 페이지 warm className 전수 0건, 브라우저 실렌더 gray 확정.
- AC-2 (⑤ 의사 근무표 가로폭 원복): PASS — w-full·w-28·px-3/px-2 (ebbd5c3c) 실렌더 풀폭 확인, 옹졸 해소.
- 의미색 보존: PASS — 주말 red/blue·삭제 red-600 미치환.
- 순수 FE/무DDL: PASS — db_change=false, 데이터·스케줄 로직 무접촉.

## 후속
supervisor QA + 현장(갤탭 실기기) 재확인 게이트. 배포(origin/main 6105dd82) 후 Vercel 자동배포.
