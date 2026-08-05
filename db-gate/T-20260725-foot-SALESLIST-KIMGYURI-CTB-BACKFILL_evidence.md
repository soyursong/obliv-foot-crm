# DB-GATE evidence — T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL

**김규리 CTB 3건 backfill · field-gated 행별 3분기 (prod 실측 확정, blanket 3-INSERT 아님)**

- canonical_repo: obliv-foot-crm · artifact_class: db_only (DML backfill, DDL 0, FE 0)
- db_change: true (DML only — check_in_services / payments 데이터, 스키마 무변경)
- da_consult_ref: DA-20260725 rwrj (CONSULT-REPLY2, line-only HARD NO-GO + payments 동반 atomic + field-gated) / j28n (CONDITIONAL GO 3게이트)
- C1 실수금 게이트: **CLEARED** — 김주연 총괄(U0ATDB587PV) "웅 맞음"(reply_ts 1785919227.259839) + 결제수단=카드(reply_ts 1785920773.694879), 채널 C0ATE5P6JTH
- ⚠ **GO-token 前 prod apply 금지** — 본 evidence = 무영속 dry-run 까지. 실 apply = supervisor DB-GATE GO-token 후 chokepoint(apply_mgmtapi.mjs, GATE_TOKEN 게이트).

## 1) prod 실측 census (service_role read-only, write 0)

스크립트: `scripts/T-20260725-foot-SALESLIST-BACKFILL_ac1_readonly_census.mjs`

| 대상 | customer_id | 김규리 staff | CTB 라인 실측 | 매칭 payment 실측 | **분기 확정** |
|------|-------------|-------------|---------------|-------------------|----------------|
| F-4550 이영수 | b3b7eac9-…-c31a | therapist 3a0c6774(07-25 방문 담당) | **부재**(price=15000 라인 0) | **부재**(기존 280,000/07-25 card = CTB 무관 별거래) | **①payments+line atomic INSERT** |
| F-5016 김미성 | e4abf027-…-5ca1 | therapist 3a0c6774(07-22 방문 담당) | **부재** | **부재**(8,810/07-22·1,400×n = 무관) | **①atomic INSERT** |
| F-4906 백연재 | 7c599062-…-e5f4 | therapist 3a0c6774(07-22 방문 담당) | **기존재** f519496a(15000, seller=NULL) | **기존재** 853cbcec(15,000 card 07-22, 동일 ci=6cf773c3) | **②링크정합 = seller 귀속만**(신규 INSERT 금지) |

- 김규리 staff = admin d26717cb / therapist 3a0c6774 2행. **seller=therapist 3a0c6774** 채택 — 3 check_in 전부 therapist=3a0c6774 실측 + 기존 CTB seller 관례(라인 76199926·f30b5680=3a0c6774) 정합. admin 아님.
- CTB service = e17ba3a3 "Care Toe Band (CTB)" 15,000 (category_label=풋화장품 → SalesStaffTab cosmetic 집계 대상).
- CTB=비급여 → 골든 payment 853cbcec service_charge_id=NULL → **service_charge 브릿지 불요**.

## 2) 이중계상/급여split 오염 방지 (SalesStaffTab netting)

SalesStaffTab: payStats revenue = `payment.check_in_id→check_ins.therapist` 귀속 / 화장품 차감(cosmeticByTherapist) = `line.check_in_id→check_ins.therapist` 기준. → **payment 와 line 을 동일 check_in 에 페어링**해야 차감이 상쇄되어 순증 0.

- F-4550: 앵커 ci=cba142a6(07-25). payment(+15000→3a0c6774) − 차감(−15000→3a0c6774) = 치료매출 순증 0, 화장품 seller=김규리 +15000, systemTotal +15000.
- F-5016: 앵커 ci=39a3361f(07-22). seller=therapist=김규리 자기정합 → 동일 순증 0 + 화장품 +15000.
- F-4906: 라인·payment 기존재·동일 ci 링크 완료 → seller UPDATE 는 집계 SUM 불변(현행 버킷=COALESCE(NULL, therapist 3a0c6774)=김규리), 귀속 명시화만.

## 3) ⚠ F-4550 앵커일 = 07-25 (IMG_9059 표기 07-18 대비 shift) — 명시적 disclosure

IMG_9059 판매리스트 F-4550 표기일=**07-18**. 그러나 prod 실측:
- 07-18 방문(ci=85766c3b)은 therapist=5c17e4bc(김규리 아님)·해당일 카드거래 전무.
- 07-25 방문(ci=cba142a6)은 therapist=**3a0c6774 김규리**(seller 본인) + 동일자 카드거래 실재(280,000).
→ 실수금일(카드 트랜잭션 + 김규리 대면) 증거가 07-25 에 집중 → **accounting_date=2026-07-25 채택**. IMG 표기일은 판매리스트 근사치로 판단. **매출귀속 아무 차이 없음(순증 0, 화장품 김규리 +15000 동일)**, accounting_date 만 07-18→07-25. field 이견 시 planner 경유 조정 가능.

## 4) 멱등성 HARD

- 전 write = business-key(check_in+제품+금액) `WHERE NOT EXISTS` + 고정 PK `ON CONFLICT DO NOTHING` 이중가드. UPDATE = `seller_staff_id IS NULL` 가드.
- dry-run 에서 **mig SQL 2회 연속 실행** → 2회차 0-row 확증(F-4906 라인 이중계상 방지 포함).

## 5) dry-run (무영속, No-Persistence Protocol) — PASS

스크립트: `scripts/T-20260725-foot-SALESLIST-BACKFILL_dryrun_mgmtapi.mjs`
```
(0) baseline: new_lines=0, new_pays=0, f4906_seller=null
(1) canary  : BEGIN;COMMENT;ROLLBACK; → after=null (ROLLBACK 무영속 ✓, sentinel-bypass 없음)
(2) apply×2+verify (BEGIN…ROLLBACK): 무예외 = 구문/rows-affected/멱등 검증 통과 ✓
(3) post-probe: new_lines=0, new_pays=0, f4906_seller=null (prod 미변경 ✓)
✅ 예상 rows-affected(실 apply): line INSERT 2 + payment INSERT 2 + seller UPDATE 1 = 5 writes
```

## 6) ledger check — PASS

- version `20260805190000` schema_migrations 미존재(fresh, 충돌 0).
- 최신 ledger=20260805180000 < 본 version → 정순 정렬, backdating 없음.
- up.sql = 순수 DML(BEGIN/COMMIT/schema_migrations INSERT 없음) → dry-run txn-strip 무해. ledger mark 는 apply 스크립트가 별도 기록.

## 7) rollback — `..._backfill.rollback.sql`

- 삽입 4행 고정 PK DELETE(payment 2 + line 2) + F-4906 seller 귀속 되돌림(=3a0c6774 일 때만 →NULL). 재실행 안전(0-row).

## 8) POSTCHECK 계획 (apply 후 supervisor/dev)

1. apply_mgmtapi.mjs POSTCHECK: new_lines=2·new_pays=2·f4906_seller=3a0c6774 SELECT 재확인.
2. SalesStaffTab(담당치료사별 화장품 매출집계) 브라우저: 김규리 화장품 3건(45,000) 반영·귀속 표시 확인.
