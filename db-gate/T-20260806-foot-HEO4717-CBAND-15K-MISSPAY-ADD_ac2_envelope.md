# T-20260806-foot-HEO4717-CBAND-15K-MISSPAY-ADD — AC-2 SOP 봉투 + DRY-RUN 증적

**작성**: dev-foot / 2026-08-06 · **선행**: AC-0 census(ff46ba19) · AC-1 gateplan(ab3ab828)
**게이트 상태**: comp-gate **RESOLVED**(김주연 총괄 4항 confirm, thread 1785980401.321779) → blocked→approved
**SOP**: Cross-CRM Data-Correction Backfill SOP (mutable-field under-recognition 정정, 비파괴·forward-only·ADDITIVE)
**change-class**: ADDITIVE 1회성 Data-Correction · db_change=false(no-DDL) · §3.1 대표게이트 면제(DA verdict 계승)

---

## 1. 확정값 (comp-gate, 재정의 아님 — reporter 직접 confirm)
| 항목 | 값 |
|---|---|
| 고객 | 현은호 **F-4717** / customer_id=`6412fbf7-8a53-4d49-af7a-491e1d731b4c` |
| 항목 | 케어 토어 밴드 (service `e17ba3a3-4842-4097-87bc-0778a64d2755`, 정가 15,000, 풋화장품 소매) |
| 금액 | **15,000원** (실수금 완료) |
| 결제일 | **2026-07-28** (방문 당일 · F-4717 방문일 내) |
| 결제수단 | **카드** |

## 2. Write target (DA CONSULT-REPLY MSG-20260806-102803-0uof 계승)
- **payments INSERT 1행** — `recordManualPayment` 'checkin' 라우트 페이로드 **동형**(canonical 단일 write-path).
- `package_id = NULL` (CTB=비패키지 소매) · `method = 'card'` · `created_at = '2026-07-28 03:00:00+00'`(=07-28 12:00 KST).
- `check_in_id = c33dfc76-cda5-48e6-9b34-277281b26626` (07-28 done returning) 로 **bind → orphan payment 회피**(gate plan verify-gate; 07-28 done 방문 실재).
- `status = 'active'`(default) · `is_simulation = false`(default) · `payment_type = 'payment'` · `installment = 0`.
- **external_* 전부 NULL** = pg_provider **external/manual**(VAN 미결속). ★VAN raw 승격 **HARD REJECT** 유지 — census상 07-28 매칭 15,000 카드 VAN 부재. 미매칭 VAN 5건(07-18/25/27/29) 어느것도 F-4717 귀속 금지.

## 3. AC-2 SOP 봉투 구성요소
| 요소 | 구현 |
|---|---|
| target-set freeze | 대상행 = F-4717 CTB 15,000 카드 단일 payment(부재→신규 1행). 상수 고정(apply 러너 §확정 상수). |
| freeze 재검증 abort | txn 내 (a) F-4717 15,000 active payment count=0 재확인 ≠0 → `FREEZE_ABORT` (b) bind check_in 실재/귀속 재확인 NULL → `FREEZE_ABORT`. |
| 단일 트랜잭션 | plpgsql DO 블록 1개 = freeze→INSERT→POSTCHECK 원자 실행. |
| rows-affected=1 | `RETURNING id INTO` + `GET DIAGNOSTICS ROW_COUNT` ≠1 → `ROWCHECK_ABORT`. |
| service_role 컨텍스트 | Supabase Management API `/database/query`(SUPABASE_ACCESS_TOKEN) = service_role 상당, RLS 미적용. |
| 판정근거 스냅샷 | AC-0 census(DIAG-REPORT) + AC-2 reverify(_ac2_reverify.mjs 출력) 동봉. |
| 롤백 SQL | 아래 §5. |

## 4. AC-3 매출 중립 evidence (DRY-RUN 무영속 확정)
```
HTTP 400  DRYRUN_OK new_id=fa48ecc7-… before=8426360 after=8441360 delta=15000 dupe15k=1 ci_bind=c33dfc76-…
post-probe: [{"c":0}]   ← ROLLBACK 무영속 재확인(여전히 0건)
```
- 07-28 방문 연결 check_in = **c33dfc76**(done, returning, KST 2026-07-28) 특정.
- v_daily_revenue single-leg 산식(`(created_at AT TIME ZONE 'Asia/Seoul')::date` · `status='active'`) 기준
  07-28 clinic 순매출 **8,426,360 → 8,441,360 = 정확히 +15,000 1건만 증가**. 이중계상 0.
- F-4717 15,000 active payment count: 0(before) → 1(after) exactly.
- **무영속 증명**: DRYRUN_OK 는 RAISE EXCEPTION 경유 강제 ROLLBACK → post-probe 0건 재확인.

## 5. 롤백 SQL (apply 후 필요 시)
```sql
-- 추가행 hard-DELETE (신규 backfill 행 · 의존행 없음 · guarded)
DELETE FROM payments
 WHERE customer_id = '6412fbf7-8a53-4d49-af7a-491e1d731b4c'
   AND amount = 15000
   AND check_in_id = 'c33dfc76-cda5-48e6-9b34-277281b26626'
   AND memo LIKE '케어토어밴드%누락 사후기록%';
-- 예상 rows-affected = 1. (apply POSTCHECK 의 new_id 로 대체 특정 가능.)
```

## 6. 실행 러너
- 재검증(READ-ONLY): `scripts/..._ac2_reverify.mjs`
- DRY-RUN / APPLY: `scripts/..._ac2_apply.mjs`  ( 기본=DRY-RUN 무영속 · `--apply`=COMMIT )

## 7. AC-5 supervisor 게이트 (apply 선행조건 — dev-foot 자가 apply 금지)
- [ ] supervisor dry-run 무영속 재현 (rows==1 · delta+15,000 · dupe15k==1)
- [ ] POSTCHECK 재현
- [ ] deploy-precheck **db_only** (C18 GO직전 DA-HOLD 재확인)
- [ ] **supervisor GO → apply(`--apply`)** → AC-3 apply POSTCHECK 재검 → planner FOLLOWUP

**현 상태**: dry-run 무영속 PASS. **prod WRITE 0**(apply 미실행). supervisor AC-5 GO 대기.
