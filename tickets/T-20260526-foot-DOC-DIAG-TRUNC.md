---
id: T-20260526-foot-DOC-DIAG-TRUNC
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
impl_commit: 0c42fe8
build_fix_commit: HEAD
build_ok: true
db_change: false
e2e_spec: tests/e2e/T-20260526-foot-DOC-DIAG-TRUNC.spec.ts
e2e_result: 29/29 PASS
created_at: 2026-05-26T19:53:00+09:00
deploy_ready_at: 2026-05-27T00:00:00+09:00
deadline: 2026-06-02
---

# T-20260526-foot-DOC-DIAG-TRUNC — 서류 상병코드 전건 노출

## 요약

서류(진단서·소견서·진료확인서·통원확인서·처방전·보험청구서) 상병코드 3~4건 선택 시
기존 2건만 표기되던 truncation 버그 수정.

## 수용 기준

- AC-1: 상병코드 3건 선택 → 서류 미리보기 3건 전부 표기 ✅
- AC-2: 상병코드 4건 선택 → 4건 전부 표기 ✅
- AC-3: 기존 2건 이하 regression 없음 ✅
- AC-4: 대상 양식 전종(진단서·소견서·진료확인서·통원확인서·처방전·보험청구서) ✅

## 구현 내용

- `htmlFormTemplates.ts`: 진단서/진료확인서/통원확인서/소견서/처방전/보험청구서 6종
  rowspan 3→5, 행 3·4 추가(`{{diag_row_3_style}}`/`{{diag_row_4_style}}` 가시성 플래그)
- `autoBindContext.ts`: `AutoBindContext.diagCodes` code3/name3/code4/name4 확장,
  `buildAutoBindValues` diag_code_3/4, diag_name_3/4, diag_row_3/4_style 반영
- `PaymentMiniWindow.tsx`: `buildCodeEnrichedValues` diag_row_3/4_style + diag_extra_codes_html 주입
- `DocumentPrintPanel.tsx`: IssueDialog allValues + handleBatchPrint 동일 플래그 주입
- `CustomerChartPage.tsx`: `ReservationAuditLogPanel` import 누락 build-fix (TS2304)

## E2E spec

`tests/e2e/T-20260526-foot-DOC-DIAG-TRUNC.spec.ts`
- 14 unit TC (4양식 × AC-1/2/3 + AC-4 rx_standard/ins_claim_form)
- 14 desktop-chrome TC (동일)
- 29/29 PASS (build-fix commit 포함)

## DB 변경

없음 (FE only)
