# T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP — DB-GATE APPLY POST-PROBE EVIDENCE

apply: 2026-07-28 dev-foot direct Management API apply (rows_affected assertion=2 PASS, DO-block GET DIAGNOSTICS IF<>2 RAISE).
project_ref: rxlomoozakkjesdqjtvd
mig: supabase/migrations/20260728170000_redpay_foot_registry_0728gap_remap.sql (no-DDL data-lane superseded-remap UPDATE)

## 1. registry 2행 (tid=신 · superseded=구, positive)
```json
[
 {
  "merchant_id": "1777288008",
  "tid": "1047538246",
  "superseded_tids": [
   "1047479475"
  ],
  "terminal_label": "풋(유선)"
 },
 {
  "merchant_id": "1777289006",
  "tid": "1047538239",
  "superseded_tids": [
   "1047479480"
  ],
  "terminal_label": "풋(멀티)"
 }
]
```

## 2. v_redpay_reconciliation_daily 소급 표면화 (DA positive assertion — rows-affected 단독 불충분, 뷰 소급표면화까지)
```json
[
 {
  "tid": "1047538239",
  "rows": 10,
  "amt": "11390000"
 },
 {
  "tid": "1047538246",
  "rows": 2,
  "amt": "10200"
 }
]
```
- 기대: 239→10행/₩11,390,000, 246→2행/₩10,200

## 3. 뷰 표면화 합계
```json
{"c":12,"amt":"11400200"}
```
- 기대 12행 / ₩11,400,200 (dryrun forecast 0→12 실측 수렴)

## 4. cross-tenant 무오염 (신 TID 보유 행 domain 분포 — foot 2행만)
```json
[{"domain":"foot","c":2}]
```

## 5. no-DDL 확증
- 본 마이그 = 순수 UPDATE 1문 (ALTER 0 · ADD COLUMN 0 · CREATE OR REPLACE VIEW 0 · INSERT 0 · 제약변경 0).
- superseded_tids 컬럼 + UNION 뷰 = Opt-B′(20260724170000) 旣배포 자산 무접촉.
