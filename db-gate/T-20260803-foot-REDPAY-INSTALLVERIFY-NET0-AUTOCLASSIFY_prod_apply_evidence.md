# T-20260803-foot-REDPAY-INSTALLVERIFY-NET0-AUTOCLASSIFY — PROD DB 마이그 적용 증거

- **트리거**: supervisor FIX-REQUEST `MSG-20260803-234914-x1sg` (db_change auto-promote 제외 가드 T-20260622-meta-AUTOPROMOTE-DBCHANGE-GATE).
  commit `880be71a` 코드는 origin/main 병합됐으나 `db_change:true` — git merge 만으로 PROD DB 미적용(데이터-FE 불일치 위험).
- **적용자**: dev-foot / **적용 시각**: 2026-08-04 00:00 KST
- **대상 PROD**: Supabase `rxlomoozakkjesdqjtvd` (obliv-foot-crm)
- **마이그**: `supabase/migrations/20260803235500_foot_redpay_installverify_classify.sql` (version 20260803235500)
- **성격**: ADDITIVE read-only VIEW 2종 (신규 `v_redpay_installverify_pairs` + `v_redpay_reconciliation_daily` CREATE OR REPLACE, 말미 2컬럼 추가). base-table/컬럼/enum/제약/RLS/원장 무변경. txn-control 문 없음(sentinel-bypass 무관). payments 원장·매출 무접촉.
- **적용 경로**: `scripts/lib/foot_migration_ledger.mjs applyMigration()` — SQL 적용 + 원장(schema_migrations) idempotent 기록 단일 경로(Track3 표준).

---

## PRE-probe (적용 전, supervisor 진단 재현·확증)
```
1) ledger 20260803235500      : []                                  ← 원장 미기록(미적용 확증)
2) views present              : [v_redpay_reconciliation_daily]     ← 신규 pairs 뷰 부재
3) recon_daily install_verify cols : []                             ← ADDITIVE 2컬럼 부재
4) grants(authenticated)      : v_redpay_reconciliation_daily(구정의) SELECT 등
```
→ **FE(880be71a, RedpayReconcileTab.tsx·redpayInstallVerify.ts)는 main 배포됐으나 PROD DB에 pairs 뷰·2컬럼 부재 = 데이터-FE 불일치 실재 확인.**

## 적용
```
applyMigration(version=20260803235500, dryRun=false) → { applied: true, dryRun: false }
```

## POST-probe (구조 검증, 증거기반)
```
1) ledger 20260803235500      : [{version:20260803235500, name:foot_redpay_installverify_classify}]  ✓ 원장 기록
2) views present              : [v_redpay_installverify_pairs, v_redpay_reconciliation_daily]         ✓ 신규 뷰 생성
3) recon_daily install_verify cols : [install_verify_evidence, install_verify_presumed]               ✓ 2컬럼 실재
4) grants(authenticated)      : 두 뷰 모두 SELECT 포함 grant                                          ✓
```

## DATA-probe (기능 검증 — 분류 엔진 실동작, 증거기반 기대행 실재 확인)
```
A) v_redpay_installverify_pairs 총 분류 쌍 : 1
B) 실 분류 쌍 (4조건 evidence 실재):
   tid=1047479469, approval_no=28357864, amount=1,000원, cancel=-1,000원,
   gap_sec=27(≤120 ✓), tid_txn_count=2(단독 ✓), close_date=2026-07-14,
   evidence.classified='설치검증_추정', cond1~cond4 ALL true
D) v_redpay_reconciliation_daily install_verify_presumed=true 행 : 2 (해당 쌍의 승인행+취소행)
```
→ 분류 엔진이 실 PROD 데이터에서 **정당한 설치검증 테스트 쌍(1,000원·27초 취소·TID 단독)** 1건을 4조건 ALL 충족으로 정확히 분류. recon_daily 뷰 end-to-end 실행 + `install_verify_presumed` 전파 확인.
- (참고) 티켓 예시의 07-23 TID1047479153 1,004원 raw 는 현 PROD 조회 window 에 미존재 — 엔진 정상(다른 실쌍을 정확 분류). false-POSITIVE 없음(총 1건, 소액 whitelist·단독·수십초 전부 충족).

## 결론
- 마이그 PROD 적용 완료 + 원장 기록 + 구조/기능 증거 모두 GREEN → **데이터-FE 정합 회복.**
- 비파괴(read-only 파생). 롤백 = `supabase/migrations/20260803235500_foot_redpay_installverify_classify.rollback.sql`.
- 티켓 frontmatter `status: deployed` / `deployed_at` = 본 증거기반 적용 시각으로 확정 마킹.
