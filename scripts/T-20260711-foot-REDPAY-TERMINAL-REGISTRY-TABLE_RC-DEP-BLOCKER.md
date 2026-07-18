# T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE — prod apply 시도 RC 블로커

FIX-REQUEST MSG-20260718-005439-qoi0 (supervisor NO_GO: migration_not_applied_prod) 처리 중 발견한
**cross-ticket 의존 + ledger drift** 블로커. 단독 apply 불가 → supervisor GO 대기.

## BEFORE prod 실측 (2026-07-18 01:58 KST, Management API, ref rxlomoozakkjesdqjtvd)
- `to_regclass('public.redpay_terminal_registry')` → NULL
- `to_regclass('public.v_redpay_unclassified_merchants')` → NULL
- `to_regclass('public.v_receipt_settlement_daily')` → **NULL** ← 핵심
- schema_migrations '20260711140000' → 0행
- schema_migrations '20260710120000' → 0행 ← 선행 마이그도 미적용
- ledger max version = 20260718130000 (전후 마이그는 적용됨 = 국소 2건 drift)
- v_redpay_reconciliation_daily viewdef = registry 미파생(hardcoded prior)

## apply 시도 결과 = FAIL (transaction 롤백, 부분적용 0)
```
ERROR: 42703: column p.ocr_receipt_datetime does not exist
LINE 259: (p.ocr_receipt_datetime AT TIME ZONE 'Asia/Seoul')::date,
```
Management API /database/query = 암묵 단일 txn → 실패 시 전량 롤백. prod 상태 무변경 확인.

## Root Cause
1. **미기록 cross-ticket 하드 의존**: 20260711 마이그가 `CREATE OR REPLACE VIEW v_receipt_settlement_daily`
   재정의 시 `payments.image_url` + `payments.ocr_receipt_datetime` 컬럼 참조.
   이 2컬럼 + 원본 뷰 = **T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD** 소유 자산.
2. **선행 마이그도 drift**: 20260710120000 = status in_progress, `deploy_order_gate: MIGRATION_FIRST`.
   supervisor DDL-diff→apply 미실행(현 유일 critical path) + FE-gated + 인간게이트 2종(OCR시크릿·레드페이 DRY_RUN).
   → prod 미적용. 20260711 이 이 위에 얹혀 hidden dep 형성.
3. **dryrun false-pass (no-persistence/sentinel-bypass class)**: 20260711 티켓 `mig_dryrun: pass` 근거가
   "풀 up apply(**stub deps**)" — 부재 컬럼/뷰를 stub 으로 대체해 통과. prod 실재 미증명 → 이번 apply 에서 노출.

## 원장정합 (Migration Ledger Reconciliation): 정본=prod 실재. drift = {20260710120000, 20260711140000} 2건.

## 검증된 remediation (순서 고정: 20260710 → 20260711)
선행 20260710120000 apply 안전성 pre-check(2026-07-18 02:0x KST):
- 전부 ADDITIVE: `ADD COLUMN IF NOT EXISTS` ×3 (payments.image_url·ocr_receipt_datetime, receipt_ocr_results.parsed_approval_no)
- `receipt_ocr_results` total=0행 → no-full-PAN CHECK VALIDATE 위험 0(13+연속숫자 0건), 부분 UNIQUE idx 무충돌(image_url 전량 신규 NULL)
- `CREATE OR REPLACE VIEW v_receipt_settlement_daily` 신설. 의존(receipt_ocr_results·redpay_raw_transactions·payment_reconciliation_log·v_redpay_reconciliation_daily·customers.chart_number) 전량 prod 실재 확인.
20260710 적용 후 20260711 재적용 시 잔여 의존 0 → 클린 예상.

## BLOCKER — supervisor 판단 필요 (deploy 권한)
20260710 은 **별도 티켓의 prod deploy** = supervisor DDL-diff GO 미클리어. dev-foot 단독 self-authorize 불가.
요청: (A) 20260710120000 + 20260711140000 **paired forward-apply** 에 대한 supervisor GO,
  또는 (B) 20260710 을 별도 deploy 흐름으로 선행시킨 뒤 20260711 재-FIX.
runner `T-20260711-...apply.mjs` 는 GO 후 `--apply` 로 20260711 즉시 적용 가능(BEFORE/AFTER evidence 자동 첨부).
20260710 용 runner 는 GO 확정 후 동일 패턴으로 추가 제작.

*author: dev-foot / 2026-07-18 / status: NOT deploy-ready (blocker escalated to supervisor)*
