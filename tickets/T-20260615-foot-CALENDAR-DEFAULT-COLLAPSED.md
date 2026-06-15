---
id: T-20260615-foot-CALENDAR-DEFAULT-COLLAPSED
title: "[달력] 진료대시보드 진입 시 좌측 달력 패널 디폴트 접힘"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: none (FE presentation only)
commit_sha: e72db30c
created: 2026-06-15
assignee: dev-foot
reporter: planner
source_msg: MSG-20260615-213036-bvdr
risk_verdict: GO
---

# T-20260615-foot-CALENDAR-DEFAULT-COLLAPSED — 달력 디폴트 접힘

**surface**: `src/components/CalendarNoticePanel.tsx` (좌측 고정 사이드 패널, AdminLayout 전역 렌더)

## 요청
진료대시보드(DoctorTools/DoctorCallDashboard) 등 진입 시 좌측 달력(캘린더) 패널이 항상 접힌(collapsed) 상태로 시작하도록 디폴트 변경.

## 구현
- `CalendarNoticePanel.tsx` `pcCollapsed` 초기값 `false` → `true`.
- AdminLayout 은 `<CalendarNoticePanel />` 를 props 없이 전역 렌더 → 외부 전달 초기값/`defaultCollapsed` prop 경로 없음. 내부 상태 단일 소스라 초기값만 변경하면 충분.
- **AC-3 판단(localStorage 충돌)**: 본 컴포넌트에 마지막상태 기억(localStorage) 로직 **없음** → 매 진입·새로고침마다 항상 접힘으로 시작하는 게 "항상 접힘 디폴트" 의도와 정확히 일치. 추정 구현/재확인 불필요.
- DB 변경 없음 (FE presentation only).

## E2E (`tests/e2e/T-20260615-foot-CALENDAR-DEFAULT-COLLAPSED.spec.ts`)
- AC-1: 진입 시 PC 달력 접힘(pc-cal-bar) + 펼치기 버튼(pc-cal-expand) 노출, 접기 토글 미노출.
- AC-2: 펼치기 클릭 → 미니캘린더/접기 토글 정상 노출, 접힘 strip 사라짐.
- AC-3: 새로고침 재진입 시 다시 접힘.
- 회귀: T-20260606-foot-CALENDAR-COLLAPSE-ROTATE spec 을 새 디폴트(접힘 시작)에 맞게 갱신 — 접힘 strip 회전 텍스트 부재 + 펼침 정상 렌더 회귀 보존.

## 검증
- `npm run build` ✓ (5.58s)
- Playwright desktop-chrome: DEFAULT-COLLAPSED 3/3 + COLLAPSE-ROTATE 2/2 = 6/6 PASS.
