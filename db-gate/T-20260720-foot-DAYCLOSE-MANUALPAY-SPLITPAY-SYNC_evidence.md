# T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC — 파트1 prod 데이터 정정 evidence

## 대상 (F-4717 현은호, 지문 교집합 freeze)
- customer `6412fbf7-8a53-4d49-af7a-491e1d731b4c` (F-4717 / 현은호)
- package  `9455ca84-5798-413b-bd45-7457616d7f55` (24회권, total_amount 5,760,000)
- manual   `d38b38fb-a60d-41b1-91fa-05548c9f51bf` (close 2026-07-20, transfer 1,260,000, memo "이체 영수증 미발행")

## 근본원인 (a/b/c 특정) → **(c)**
분할결제 카드+이체 중:
- 카드 4,500,000 → package_payments 정본화됨(memo "영수증 업로드", 05:17)
- 이체 1,260,000 → **closing_manual_payments 에만 기록·canonical(package_payments) 미생성** → phantom 미수 1,260,000
- 실제: 4,500,000 + 1,260,000 = 5,760,000 = 패키지 total (전액 완납). 미수는 순전히 이체 leg 미정본화로 인한 허수.

## 정정 (net-zero, 원장 무접점)
1. 이체 leg 1,260,000 → package_payments 정본화 (fee_kind=package, created_at 2026-07-20T16:03+09:00)
2. packages.paid_amount 재집계 → 5,760,000 (미수 0)
3. closing_manual_payments 행 soft-void (voided_at set) → 일마감 이중계상 방지
   → 일마감 2026-07-20: canonical +1,260,000 / manual −1,260,000 = **net-zero**

## dry-run (READ-ONLY projection)
```
freeze manual 지문 매칭: 1건 (기대 1)
기존 canonical transfer leg: 0건 (기대 0 = double-apply 없음)
RETRO(T-20260714-...-RETRO-BACKFILL) 겹침 행: 0건 (기대 0 — F-4717 는 07-20 신규, 07-14 백필셋 밖)
due_before=1,260,000 → due_after_projected=0 (기대 0)
✅ APPLY 안전 (net-zero, 미수 0 수렴)
```

## postverify (APPLY 후 실측)
```
due_after=0 (기대 0)
manual soft-void=true (기대 true, voided_at=2026-07-20 11:23:58Z)
canonical transfer leg=1건 (기대 1)
✅ 정정 성공 (net-zero, 미수 0)
```

## MIG-GATE evidence (db_change=true, 파트1 DDL 0 = 데이터정정)
- **mig_files**: (schema 마이그레이션 없음 — DDL 0. 데이터정정 SQL: scripts/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC_apply.sql)
- **mig_dryrun**: DRYRUN_PASS (freeze 지문 1건 · double-apply 0 · RETRO 겹침 0 · due_after=0) — preflight_dryrun.mjs
- **mig_ledger_check**: N/A — schema_migrations 원장 무접점(DDL 없음, 기존 테이블/컬럼 데이터만 정정)
- **mig_rollback**: scripts/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC_rollback.sql (정본화 행 삭제 + paid_amount 원복 4,500,000 + soft-void 해제)

## 데이터정책 자문 게이트 (§S2.4)
신규 컬럼·테이블·enum 추가 없음(기존 package_payments/packages/closing_manual_payments 컬럼만 사용) → data-architect CONSULT 불요. db 스키마 db_change=false, 데이터정정만 db_change=true.

## scripts
- scripts/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC_diag.mjs (READ-ONLY 진단)
- scripts/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC_preflight_dryrun.mjs (스냅샷+dry-run)
- scripts/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC_apply.sql / _apply.mjs (APPLY+postverify)
- scripts/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC_rollback.sql (롤백)
