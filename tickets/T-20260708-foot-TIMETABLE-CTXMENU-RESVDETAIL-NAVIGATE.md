---
id: T-20260708-foot-TIMETABLE-CTXMENU-RESVDETAIL-NAVIGATE
domain: foot
priority: P2
status: deploy-ready
qa_result: pending
deploy_commit: 214b9a1e
deployed_at: 2026-07-08 (main merge — CF/Vercel 자동배포)
db_change: false
db_migration: none
db_gate: N/A
build: pass
scenario_count: 3
spec: tests/e2e/T-20260708-foot-TIMETABLE-CTXMENU-RESVDETAIL-NAVIGATE.spec.ts
bundle_hash: n/a (FE 배선/라우팅만 — Dashboard.tsx / Reservations.tsx 주석)
created: 2026-07-08
completed: 2026-07-08
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: 김주연 총괄 (U0ATDB587PV)
slack_channel: C0ATE5P6JTH
ui_screenshot_gate: not_applicable
routing_fallback: "ID 라우팅 정상(전체 Reservation 객체 전달) — 폴백(예약관리 목록)은 resv 부재 방어 경로에서만 발동, 정상 경로는 항상 그 예약 상세 오픈"
summary: "대시보드 통합시간표 예약 박스 우클릭 [예약상세] → prefill 신규동선(handleCardResvDetailOrCreate)에서 예약관리(/admin/reservations) 정본 화면 '페이지 전환'(handleResvDetailNavToMgmt)으로 교체. 전체 Reservation 객체를 location.state.openReservationDetail 로 전달(예약 ID 기준 식별) → 예약관리 수신부(navDetailConsumed, Reservations.tsx L740)가 그 예약의 정본 ReservationDetailPopup 을 추가 fetch 없이 바로 오픈(예약관리에서 그 예약 식별). ReservationDetailPopup = 예약관리 정본 화면에서만 단일 마운트(대시보드 로컬 인스턴스 0) → 다른 경로 사용 중이므로 팝업 유지(제거 안 함). 폴백: resv 부재(방어) 시 openReservationDetail 미전달 → 예약관리 목록 화면(ID 라우팅 불가 폴백, dead 진입점 방지) — 정상 경로는 항상 그 예약 식별. ★인접 무접촉: T-20260708-foot-DASH-TIMETABLE-RESV-BROKEN-QUICKADD-DISABLE 의 QUICKADD 슬롯 신규생성 게이팅(dashResvCreateDisabled/onSlotClick) 불변 확인(E2E S3-1). 고객박스(체크인 큐) CustomerQuickMenu 는 prefill 동선 유지(불변, E2E S3-2). 예약 데이터/상태/저장 무접촉(화면 전환만, FE-only, E2E S3-3). T-20260630-foot-RESV-DETAIL-NAV-PREFILL AC2(예약박스=prefill 통일)를 open-existing 복원으로 supersede — 해당 spec AC2 갱신(L6176 '기존 open-existing 동선 복원 필요 시 재도입' 명시분 이행). 검증: build PASS / 신규 E2E 10 PASS(3 시나리오) / T-20260630 정적가드 7 PASS / QUICKADD 인접 회귀 PASS. DB/스키마/마이그/RLS 변경 0. 실 브라우저 페이지 전환·상세 오픈은 supervisor field-soak(갤탭 실기기)로 종결. ⚠ 사전존재 stale/flaky E2E(본 변경 무관, baseline stash 대조 확인): T-20260611-CTXMENU-UNIFY-CANONICAL AC1-4·T-20260611-RESV-DASH-CTXMENU-DETAIL-NAV S1-1(둘 다 T-20260630 이 retire 한 handleResvOpenDetailFromCtx/FromMenu 참조 stale), RESV-CUSTCTX-PREFILL·RESV-DETAIL-NAV-PREFILL '빈 폼' 브라우저 상호작용 flaky. 본 커밋이 유발한 유일 신규 실패는 RESV-DETAIL-NAV-PREFILL AC2(supersede 대상)였고 갱신 완료."
---

# T-20260708-foot-TIMETABLE-CTXMENU-RESVDETAIL-NAVIGATE

원천: NEW-TASK MSG-20260708-115726-jb1d (planner). 요청자: 김주연 총괄(C0ATE5P6JTH).

## 요청

대시보드 통합시간표 우클릭 컨텍스트 메뉴 [예약상세] 클릭 시 대시보드 인-플레이스 상세 팝업/신규예약
prefill 동선 대신 **예약관리 화면으로 페이지 전환**하며, 가능하면 **그 예약을 예약관리에서 바로 식별**.

## AC / 구현

- **AC1**: 예약 박스 우클릭 [예약상세] 핸들러 = `handleResvDetailNavToMgmt`.
  `navigate('/admin/reservations', { state: { openReservationDetail: <Reservation> } })` 로 페이지 전환.
- **AC2 (ID 라우팅)**: 전체 Reservation 객체를 state 로 전달 → 예약관리 수신부가 예약 ID 기준으로 그 예약의
  정본 상세 팝업을 바로 오픈(예약관리에서 식별). **폴백**(resv 부재 방어): openReservationDetail 미전달 →
  예약관리 목록 화면. 정상 경로에서 폴백은 발동하지 않음(항상 그 예약 식별).
- **AC3 (팝업 유지/제거 재량)**: ReservationDetailPopup 은 예약관리 정본 화면에서 사용 중 → **팝업 유지**.
  이 메뉴 항목에서만 navigate 로 교체(대시보드 로컬 인스턴스는 애초 0, 단일 정본 유지).
- **AC4 (무접촉)**: 예약 데이터·상태·저장 무접촉. 화면 전환 동작만(FE-only, db_change=false).

## 인접(ADJACENCY) 무접촉

- T-20260708-foot-DASH-TIMETABLE-RESV-BROKEN-QUICKADD-DISABLE 의 신규 생성 affordance 게이팅
  (`dashResvCreateDisabled` / `onSlotClick`)은 건드리지 않음. 본 건은 [예약상세] 항목 핸들러만. (E2E S3-1)
- 고객박스(체크인 큐) CustomerQuickMenu 의 prefill 동선(`handleCardResvDetailOrCreate`)은 불변. (E2E S3-2)

## E2E (3 시나리오, 10 테스트, 정적 source-integrity gating)

- 시나리오1: 예약박스 [예약상세] = 예약관리 페이지 전환 + openReservationDetail(예약 ID) + 폴백 + 신규 배선.
- 시나리오2: 예약관리 수신부 state 소비 → setDetail(resv) 그 예약 상세 오픈 + 1회 소비 가드 + 팝업 단일 마운트.
- 시나리오3: QUICKADD 게이팅 무접촉 + 고객박스 prefill 불변 + FE-only(데이터/저장 무접촉).
