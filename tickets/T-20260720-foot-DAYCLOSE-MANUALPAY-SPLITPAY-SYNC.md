---
id: T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC
domain: foot
priority: P1
status: deploy-ready
deploy_commit: feat/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC HEAD (rebased onto origin/main a843b4b7) — 정확한 SHA는 push 후 정본 티켓(_handoff/tickets) 기재
bundle_hash: index-CiADM7LQ   # 로컬 브랜치 재빌드 해시(dist/assets/index-CiADM7LQ.js). CF prod 반영 후 supervisor version.json 대조.
deploy_ready_at: 2026-07-24 14:23:00+09:00   # FIX-REQUEST(MSG-20260724-134311-9yue) 재통합 후 fresh 재마킹. 직전 qa_fail(2026-07-24) 이후.
qa_result: null   # 재통합(rebase onto origin/main a843b4b7 + SSOT 수렴) 완료 → 재QA 대기
db_change: true
db_migration: none (파트1 데이터정정 DDL 0 · 파트2 코드 스키마 무변경)
build: PASS (npm run build ✓ tsc -b + vite, 재통합 후 재빌드 2026-07-24)
e2e: tests/e2e/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC.spec.ts (8 passed) + 부모(DAYCLOSE-MANUAL-PAY)/CHART2 회귀 13 passed = 21 passed (재통합 후 재실행 2026-07-24)
mig_files: none — schema 마이그 없음(DDL 0). 데이터정정 SQL = scripts/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC_apply.sql
mig_dryrun: DRYRUN_PASS (freeze 지문 1건 · double-apply 0 · RETRO 겹침 0 · due 1,260,000→0)
mig_ledger_check: N/A — schema_migrations 원장 무접점(DDL 없음, 데이터정정만)
mig_rollback: scripts/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC_rollback.sql
report: db-gate/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC_evidence.md
supervisor: required (금융성 수납/미수 + 파트1 prod 정정 + E2E 회귀)
parent: T-20260714-foot-DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC (단건 fix · deployed 07-15)
created: 2026-07-20
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (NEW-TASK MSG-20260720-191507-soif)
---

# T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC

일마감 수기 등록 분할결제(카드+이체, 2 결제수단)가 정본(package_payments/payments)에 연동되지 않아
고객 미수 잔존 + 2번차트 수납내역 미표시. 부모(단건 fix)의 분할결제 커버리지 갭.

## 파트1 — F-4717 현은호 미수 즉시 정정 (완료)
- RC = **(c)** closing_manual_payments 에만 기록·canonical 미생성. 이체 leg 1,260,000 미정본화 → phantom 미수.
- 실제 전액 완납: 카드 4,500,000 + 이체 1,260,000 = 5,760,000 = 24회권 total.
- 정정: 이체 leg → package_payments 정본화 + paid_amount 재집계(5,760,000) + manual 행 soft-void → net-zero.
- 지문 교집합 freeze(단일 count UPDATE 금지) · dry-run→apply→postverify(미수 0) · 롤백 SQL 동봉 · 원장 무접점.
- RETRO-BACKFILL(07-14 백필셋) 겹침 0건(F-4717 는 07-20 신규 = 백필셋 밖) → double-canonicalize 없음.
- 상세: db-gate/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC_evidence.md

## 파트2 — 분할결제 write-path 확장 (근본 수정)
- `src/lib/manualPaymentWritePath.ts`: `PaymentSplit` + `splits?: PaymentSplit[]` 확장. 부모 SSOT 위 행 확장(병렬 경로 신설 0, AC7 유지).
  - normalizeSplits: splits 우선, 미지정 시 amount+method 단일 행(하위호환) — **단일 합산지점**.
  - package: 행 별 package_payments + paid_amount=합 재집계(미수 정합).
  - checkin: 행 별 payments(동일 check_in_id) + 칸반 done. single: 행 별 payments.
- `src/pages/Closing.tsx` ManualEntryDialog: "+ 분할결제 추가" 버튼 → 행2+ 입력(결제수단/금액) + 합계 표시.
  - canonical 라우팅: 분할 시 splits 전달(각 행 canonical 1행) / 단건 시 기존 시그니처(무회귀).
  - rollup(manual) 라우팅: 분할 시 행 별 closing_manual_payments 1행(카드/이체 subtotal 정합).
- 매출 이중계상 방지: 행 합=총액, canonical 1회 반영, canonical↔closing_manual 상호배타(early-return).

## 재통합 (2026-07-24, FIX-REQUEST MSG-20260724-134311-9yue)
- 88h stale 브랜치(대상커밋 38658e39 origin/main 미병합·145 behind) → **origin/main(a843b4b7) 위로 rebase**.
- 형제티켓 T-20260720-foot-RECEIPT-MANUAL-PAY-SPLIT-METHOD(b7616d1f, main 병합)가 동일 SSOT
  `manualPaymentWritePath.ts` 를 `splits`/`PaymentSplit` 규약으로 먼저 수정 → **명명 충돌**.
- **수렴 원칙(병렬경로 신설 금지·double-canonicalize 방지)**: part2 의 `legs`/`PaymentLeg`/`legCount` 를
  배포된 형제 규약 `splits`/`PaymentSplit`/`splitCount` 로 통일. `normalizeSplits()` 단일 정규화 함수 =
  두 진입점(영수증 팝업 CustomerChartPage + 일마감 수기 Closing.tsx)이 수렴하는 **단일 합산지점**.
  part2 의 견고성(행 검증·기록행수 결과 반환)은 흡수. Closing.tsx 는 `splits`/`splitCount` 로 이관.
- 형제 caller(CustomerChartPage, main 배포) 무접점 — 타입 정합은 tsc -b PASS 로 보증.
- 회귀: SPLITPAY 8 + 부모 DAYCLOSE-MANUAL-PAY 7 + CHART2-RECEIPT 6 = 21 passed. 형제 RECEIPT spec UI-gated 4 skip(기존 동작).

## AC
- [x] AC-SP1 package 분할 → pp 2건 + 미수 0 + net-zero
- [x] AC-SP2 checkin 분할 → payments 2건(동일 check_in) + 칸반 done
- [x] AC-SP3 single 분할 → payments 2건
- [x] AC-SP4 rollup 분할 → closing_manual 2건(subtotal 정합), canonical 0
- [x] AC-SP5 F-4717 파트1 정정 회귀(READ-ONLY): 미수 0 · canonical transfer 1건 · manual soft-void
- [x] AC-SP6 이중계상 방지 불변식: leg합=총액, canonical leg당 1회
