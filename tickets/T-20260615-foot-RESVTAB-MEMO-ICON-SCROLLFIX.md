---
id: T-20260615-foot-RESVTAB-MEMO-ICON-SCROLLFIX
title: "[2번차트] 예약내역 탭 메모 ✏️표시/편집 토글 + 체류시간 스크롤 탭영역 재한정"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: d23db1c0
created: 2026-06-16
assignee: dev-foot
reporter: planner
source_msg: MSG-20260615-194222-exqg
risk_verdict: GO
---

# T-20260615-foot-RESVTAB-MEMO-ICON-SCROLLFIX

FE-only · DB변경0 · DWELLSWAP(c6fed76) 직후 후속. 대상: `src/pages/CustomerChartPage.tsx` (2번차트).
별개 메모 티켓(DOCDASH-MEMO-*, MEDCHART-*-MEMO-*)과 화면·대상 상이 — 혼동 금지.

## AC-1 — 예약메모 UX (표시 ↔ 편집 토글) ✅
- 예약내역 탭 메모: **항상 열린 입력창 → 표시(텍스트 + 우측 ✏️ 아이콘)**.
- ✏️ 클릭 시 **인라인 편집폼(입력 + 저장/취소) toggle**.
  - 저장 = 기존 RPC/상태 그대로(insertReservationMemo append-only) 호출 후 display-only 복귀.
  - 취소 = 입력 폐기 후 display-only 복귀.
- **저장 로직·데이터모델 변경 금지(표시·토글만)** — `saveResvMemo` 가 기존 핸들러와 동일 호출
  (insertReservationMemo + `resvMemoInputs` 초기화 + `foot_crm_customer_refresh` 1번차트 알림) + `setEditingResvMemoId(null)`.
- 신설 상태: `editingResvMemoId` (null=전부 display-only). testid: `resv-memo-display` / `resv-memo-edit-form` / `resv-memo-save` / `resv-memo-cancel`.

## AC-2 — 체류시간 스크롤 재한정 ✅
- RC(실DOM 재현): 현행 slot-dwell-panel 은 자체 overflow 없음 → 휠/터치 스크롤이 **좌측 패널 전체(고객정보 포함)** 를 스크롤.
  현장은 이를 "체류시간 스크롤이 우측 2구역으로 전이"로 보고. (page.setContent 재현상 휠 스크롤의 우측 2구역 직접 전이는 미발생 — 핵심 회귀는 scope 미한정.)
- 수정: `slot-dwell-panel` 에 `max-h-[70vh] overflow-y-auto overscroll-contain` 추가 →
  체류시간 콘텐츠가 **이 탭 박스 내부에서만 스크롤**. 좌측 패널·우측 2구역 scrollTop 불변(실DOM 가드).
- 이 분기 한정 → 수납내역(payments) 등 타 탭 부수효과 0.

## AC-3 — DWELLSWAP 배치 불변 ✅
- 예약내역 탭(reservations, CLINICAL) 신설 / 체류시간(slot_dwell)↔수납내역(payments) 그룹 스왑 배치 미변경(회귀 가드 포함).

## 검증
- build OK (tsc + vite).
- E2E: `tests/e2e/T-20260615-foot-RESVTAB-MEMO-ICON-SCROLLFIX.spec.ts` (unit 프로젝트, auth 불요) — 소스미러 + 실DOM 스크롤 containment **7/7 PASS**.
- supervisor 실QA: 운영 번들 + 갤탭 실기기로 (a) ✏️ 토글·저장/취소 (b) 체류시간 스크롤 박스 내 한정 별도 확인 권장.

commit: d23db1c0
