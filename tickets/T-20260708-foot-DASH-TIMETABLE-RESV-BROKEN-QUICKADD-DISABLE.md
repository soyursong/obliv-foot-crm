---
id: T-20260708-foot-DASH-TIMETABLE-RESV-BROKEN-QUICKADD-DISABLE
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 589d977d
deployed_at: 2026-07-08 (main merge 완료 — CF Pages 자동배포)
db_change: false
db_migration: none
db_gate: N/A
build: pass
scenario_count: 4
spec: tests/e2e/T-20260708-foot-DASH-TIMETABLE-RESV-BROKEN-QUICKADD-DISABLE.spec.ts
bundle_hash: n/a (FE 배선/게이팅만 — Dashboard.tsx/Reservations.tsx)
created: 2026-07-08
completed: 2026-07-08
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: 김주연 총괄 (U0ATDB587PV)
slack_channel: C0ATE5P6JTH
ui_screenshot_gate: not_applicable
summary: "동일 대시보드 예약동선 2 AC. [AC1 버그] 통합시간표 즉석 생성 예약건 차트 미오픈 + 예약관리 고객박스 클릭 무반응. RC(코드확정)=예약관리(Reservations.tsx) 고객박스 plain-span onClick 의 `if (!r.customer_id) return;` 조기반환이 미연결(customer_id=null, 대시보드 워크인 생성건) 클릭을 silent no-op(현장 '무반응' 신고)으로 만듦. 일간(TIMEGRID)/주간 두 뷰 모두 조기반환 제거 → handleResvOpenChart 위임(미연결=안내 토스트=정상 반응 / 연결=차트 오픈). handleResvOpenChart 는 customer_id=null 을 toast.info('고객 정보가 연결되어 있지 않습니다')로 graceful 처리 → 무반응 아님. 취소건+연결=인앱 차트(REFIX-8 AC8) 유지. [AC2 정책] 대시보드 통합시간표 신규예약 생성 진입점([빠른 예약 추가] 모달=빈 슬롯 클릭) 차단. dashResvCreateDisabled=true → DashboardTimeline onSlotClick 미전달(undefined) → 빈 슬롯 클릭 생성 비활성 + '+' 생성유도 표식도 은닉. ★핵심 회귀 보존: 당일 예약 시간변동(카드 드롭 리스케줄)은 SlotDropCell useDroppable + handleDragEnd 로 onClick 과 독립 경로 → 생성 차단이 시간변동을 죽이지 않음(E2E AC2-5 검증). 예약관리 등 다른 surface 신규생성은 스코프 밖(불변) — Reservations.tsx 에 dashResvCreateDisabled 미개입, RESVMGMT-GRID-CLICKCREATE-7ADJ/WEEKLY-CELLCLICK-CREATE 회귀 pass 로 예약관리 생성경로 보존 확인. 정책 해제 시 dashResvCreateDisabled=false 로만 복구(handleQuickSlotClick·QuickReservationDialog 코드 보존). FE-only, DB/스키마/마이그/RLS 변경 0. 검증: build PASS / 티켓 E2E 11 PASS / 회귀(CHART-OPEN-GUARD·RESV-MGMT-CTXMENU-DETAIL-5FIX·RESVMGMT-GRID-CLICKCREATE-7ADJ·RESVMGMT-REFIX-8·SLOT-MOVE-REVERT·DASH-SLOT-DRAG·WEEKLY-CELLCLICK-CREATE) 35 PASS 4 skip. 실 브라우저 동작(차트 오픈/무반응 해소/생성차단/시간변동보존)은 supervisor field-soak(갤탭 실기기)로 종결."
---

# T-20260708-foot-DASH-TIMETABLE-RESV-BROKEN-QUICKADD-DISABLE

원천: 김주연 총괄(C0ATE5P6JTH). 동일 대시보드 예약동선 2 AC (버그 + 정책).

## AC1 — 버그: 통합시간표 즉석 생성 예약건 차트 미오픈 + 예약관리 고객박스 무반응

- **증상**: 대시보드 통합시간표에서 즉석 생성한 예약건을 클릭해도 고객 차트가 안 열림.
  예약관리로 넘어와 해당 예약건 고객박스를 클릭해도 무반응.
- **RC (코드 확정)**: `src/pages/Reservations.tsx` 고객박스 plain-span onClick 의
  `if (!r.customer_id) return;` 조기반환. 미연결(customer_id=null, 대시보드 워크인 생성건)
  클릭을 silent no-op(현장 '무반응' 신고)으로 만들었음. 일간(TIMEGRID)·주간 두 뷰 동일.
- **Fix**: 조기반환 제거 → 항상 `handleResvOpenChart(resvAsCheckIn(r))` 위임.
  - 연결건 → 차트 오픈.
  - 미연결건 → `handleResvOpenChart` 내부 `toast.info('고객 정보가 연결되어 있지 않습니다')`
    graceful 처리(무반응 아님 = 정상 반응).
  - 취소건+연결 = 인앱 차트(REFIX-8 AC8) 유지.
- **회귀 대조**: T-20260610-foot-RESV-MGMT-CTXMENU-DETAIL-5FIX(deployed) 및
  CHART-OPEN-GUARD 회귀 pass — 예약관리 고객박스 무반응은 독립 버그로 확정, 5FIX 회귀 아님.

## AC2 — 정책: 대시보드 신규예약 생성 차단 + 당일 시간변동만 허용

- **정책(총괄)**: 대시보드(통합시간표)에서 신규예약 생성 진입점 전부 비활성, 당일 시간변동만 허용.
- **create affordance 열거**: 대시보드 통합시간표의 신규생성 진입점 = 빈 슬롯 클릭 → `handleQuickSlotClick`
  → `QuickReservationDialog`([빠른 예약 추가] 모달). 별도 [빠른 예약 추가] 버튼/우클릭 신규 진입점은
  통합시간표에 없음(빈 슬롯 클릭이 유일 생성 경로).
- **Fix**: `dashResvCreateDisabled = true` → `DashboardTimeline onSlotClick={dashResvCreateDisabled ? undefined : handleQuickSlotClick}`.
  onSlotClick undefined → `SlotDropCell` 빈 슬롯 onClick 미배선(생성 비활성) + '+' 생성유도 표식 은닉.
- **★핵심 회귀 보존**: 당일 예약 시간변동(카드 드롭 리스케줄)은 `SlotDropCell` `useDroppable` +
  `handleDragEnd` 경로 → onClick(생성)과 독립. 생성 차단이 시간변동을 죽이지 않음(E2E AC2-5).
- **스코프 격리**: 예약관리 등 다른 surface 신규생성 불변. Reservations.tsx 에 `dashResvCreateDisabled`
  미개입. NEWRESV 통합모달·QuickReservationDialog 코드 보존(정책 해제 시 플래그 false 복구).
- **공유경로 확인**: RESVMGMT-GRID-CLICKCREATE-7ADJ / WEEKLY-CELLCLICK-CREATE 회귀 pass →
  예약관리 생성경로 회귀 없음(대시보드에서만 조건부 게이팅).

## 게이트

- db_change=false (FE 배선·게이팅만, 스키마/마이그/RLS 0) → DA CONSULT/대표게이트/MIG-GATE 불요(autonomy §3.1).
- ui_screenshot_gate=not_applicable (기능 버그 + 게이팅, 위치/색상 지시 아님).

## 검증

- build PASS (`npm run build`, ✓ built in 5.35s).
- 티켓 E2E 11 PASS (AC1×3 / AC2×4 / AC2 회귀×3, source-integrity gating).
- 회귀 35 PASS 4 skip: CHART-OPEN-GUARD, RESV-MGMT-CTXMENU-DETAIL-5FIX, RESVMGMT-GRID-CLICKCREATE-7ADJ,
  RESVMGMT-REFIX-8, SLOT-MOVE-REVERT, DASH-SLOT-DRAG, WEEKLY-CELLCLICK-CREATE.
- 실 브라우저 동작(차트 오픈/무반응 해소/생성차단/당일 시간변동 보존)은 supervisor field-soak(갤탭 실기기)로 종결.

## 커밋

- 589d977d — fix(foot): 대시보드 신규예약 생성 차단(당일 시간변동 보존) + 예약관리 고객박스 무반응 해소.
