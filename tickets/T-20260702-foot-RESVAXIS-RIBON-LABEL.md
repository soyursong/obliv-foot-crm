---
id: T-20260702-foot-RESVAXIS-RIBON-LABEL
domain: foot
priority: P3
status: deploy-ready
qa_result: pending (supervisor 표준 FE QA 대기)
deploy_commit: PENDING
deployed_at: n/a (NOT yet deployed — supervisor QA 대기)
bundle_hash: n/a (NOT yet deployed)
db_change: false
summary: "예약격자 세로축 4분류 마지막 라벨 리본 full 라벨 텍스트 3차 변경 — '리본(발각질)' → '[리본]'. A1 단일 SSOT 상수 RIBBON_BADGE_LABEL(@/lib/resvSlotAgg) 리터럴 1줄 교체 → KIND_AXIS_LABELS.ribbon.full 이 이 상수 재사용하므로 일간 세로축 좌측 행 라벨·주간 요일 헤더 리본 칩 양쪽 자동 반영(A3). A2 시간칸 밑 축약 '초-재-힐-리' 중 리(ribbon.abbr='리')·초/재/힐 full/abbr 라벨 전부 불변. A4 리본 카운트 소스(isRibbonBrief=간략메모 [발각질케어] 칩, RIBBON_BRIEF_KEYWORD='발각질')·취소 제외·정렬 로직 회귀 없음(predicate 무변경). Reservations.tsx 무접촉(상수 재사용으로 렌더 경로 그대로). FE-only / DB·RPC·스키마 무변경. build OK(5.17s). E2E spec 신규 T-20260702-foot-RESVAXIS-RIBON-LABEL 10건 + 예선 4SEG-ABBR spec 라벨 supersede 갱신 = 20/20 PASS(desktop-chrome). 리본 라벨 3차 변경(§13.1.A REDEFINITION) — reporter(김주연 총괄) 직접 지시 승인, policy_superseded 기록됨."
created: 2026-07-02
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260702-foot-RESVAXIS-RIBON-LABEL.spec.ts
medical_confirm_gate: n/a (예약관리 예약격자 — 진료대시보드/진료관리 비대상, §11/§11.1)
data_consult: n/a (신규 컬럼·테이블·enum 없음 — DDL 0, 스키마 무접촉, §S2.4 자문 게이트 비대상 / autonomy §3.1 DA CONSULT·대표 게이트 면제)
coordination: 예선 T-20260702-foot-RESVAXIS-YAXIS-4SEG-ABBR spec 의 라벨 assertion(AC1-1/AC2-1) 을 '[리본]' 으로 supersede 갱신 + 동 spec AC1-3 stale 소스검증(BODYSPLIT 배열 refactor 후 잔존한 `{...}` JSX 형태) 을 실제 소스 `label: KIND_AXIS_LABELS.{kind}.full` 로 정합화. Reservations.tsx·Customers.tsx 등 인접 코드 미접촉.
---

## 요청 (현장 / planner NEW-TASK)
origin 김주연 총괄 직접 지시(reporter). 예약격자 세로축 4분류 마지막 라벨 '리본(발각질)' → '[리본]' 텍스트 교체 1건. 리본 라벨 3차 변경(§13.1.A REDEFINITION) — policy_superseded 기록됨.

## AC
- A1: 세로축 리본 full 라벨 상수(RIBBON_BADGE_LABEL / KIND_AXIS_LABELS.ribbon.full) '리본(발각질)' → '[리본]'.
- A2: 시간칸 밑 축약 '초-재-힐-리' 중 '리' 및 초/재/힐 라벨 전부 불변 (변경 대상 아님).
- A3: 일간·주간 뷰 양쪽 동일 반영.
- A4: 리본 카운트 소스(간략메모 [발각질케어] 칩)·취소 제외·정렬 회귀 없음.

## 게이트
- 스키마 0 / DB 무접촉 → DA CONSULT·대표 게이트 면제(autonomy §3.1).
- supervisor 표준 FE QA만.

## 구현 노트
- 변경 파일: `src/lib/resvSlotAgg.ts` (RIBBON_BADGE_LABEL 리터럴 1줄).
- KIND_AXIS_LABELS.ribbon.full = RIBBON_BADGE_LABEL 재사용 구조라 일간 세로축(Reservations.tsx:124 DAY_ROW_KINDS)·주간 요일 헤더(Reservations.tsx:2188) 양쪽 자동 반영. Reservations.tsx 코드 무변경.
- E2E: `tests/e2e/T-20260702-foot-RESVAXIS-RIBON-LABEL.spec.ts` (신규 10건, A1~A4) + 예선 4SEG-ABBR spec 라벨 supersede.
