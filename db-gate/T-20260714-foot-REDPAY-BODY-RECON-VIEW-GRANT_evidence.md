# T-20260714-foot-REDPAY-BODY-RECON-VIEW-GRANT — MIG-GATE evidence

**정본**: `da_decision_body_redpay_read_mechanism_20260714.md` (DA CONSULT-REPLY GO, MSG-20260714-185604-e5vf)
**성격**: ADDITIVE — foot DB read-path (sibling 뷰 + 전용 read-only role + grant). DROP·타입변경·enum제거 0.
**대상 DB**: obliv-foot-crm Supabase `rxlomoozakkjesdqjtvd` (⚠ body DB 아님).

---

## 산출물 (foot DB)
1. `public.v_redpay_reconciliation_body` — `WHERE center='body'` 하드필터(리터럴) + `security_barrier=true`, recon 화이트리스트 컬럼(거래일시·금액·trxid·merchant·승인/취소상태). center 컬럼·center='foot' 행 미노출.
2. `body_recon_ro` — LOGIN·NOSUPERUSER·NOCREATE*·NOBYPASSRLS, `default_transaction_read_only=on`. `SELECT ON v_redpay_reconciliation_body` 만. base/foot뷰 grant 0. (패스워드 생성+body EF secret 전달 = supervisor 서브스텝.)

## 파일
| 종류 | 경로 |
|---|---|
| up | `supabase/migrations/20260714210000_redpay_body_recon_view_grant.sql` |
| rollback | `supabase/migrations/20260714210000_redpay_body_recon_view_grant.rollback.sql` |
| dry-run SQL | `supabase/migrations/20260714210000_redpay_body_recon_view_grant.dryrun.sql` |
| dry-run runner | `scripts/T-20260714-foot-REDPAY-BODY-RECON-VIEW-GRANT_dryrun.mjs` |
| dry-run log | `db-gate/T-20260714-foot-REDPAY-BODY-RECON-VIEW-GRANT_dryrun.log` |

---

## MIG-GATE 4필드
- **mig_files**: 위 3개 마이그 파일. OOB DDL 없음(정식 파일).
- **mig_dryrun: pass** — No-Persistence Protocol(txn-control strip 무 + plpgsql exception-handler assertion + 독립콜 post-probe). 격리 assertion A~D 전부 통과:
  - A: 뷰 정의에 `WHERE center = 'body'` 리터럴 실존
  - B: `center` 컬럼 뷰 표면 미노출(information_schema 0건)
  - C: center='body' 행 노출(1) / center='foot' 행 구조적 미도달(0) — 하드필터 실측
  - D: role grant 격리 — body 뷰 SELECT=true / base 테이블 SELECT=false / foot 뷰 SELECT=false
  - post-probe(트랜잭션 밖): 뷰/role/center컬럼 전부 미영속(false) = 무영속 증명.
- **mig_dryrun_postprobe: absent** — 뷰·role·center컬럼 prod 부재 실측(독립 콜).
- **mig_ledger_check: clean** — 3자 대조 일관(pre-deploy 미적용 상태):
  - FILE = present (3파일) / LEDGER(schema_migrations 20260714210000) = absent / PROD(뷰·role) = absent. divergence 0.
- **mig_rollback**: `20260714210000_redpay_body_recon_view_grant.rollback.sql` (뷰 grant 회수→DROP VIEW→DROP OWNED BY→DROP ROLE→원장 삭제. 전량 가역, base 무접점).

## dry-run 실행 결과 (요약)
```
✅ PRE: 뷰/role 부재(적용 전 clean)
✅ ASSERT: A(리터럴)·B(center미노출)·C(body노출/foot미도달)·D(grant격리) 전부 통과
✅ POST: 뷰 미영속 / role 미영속 (No-Persistence)
✅ DRYRUN PASS
```

---

## ★배포 순서 (supervisor 유의) — PROD apply 는 POLLER 배포 후
1. T-20260711-foot-REDPAY-TERMINAL-REGISTRY deployed
2. T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER (center DDL `20260714170000` + 폴러, commit ca8d1d40) deployed
   = `payment_reconciliation_log.center` 실존 + center='body' 행 실존
3. ★본 뷰/role deployed★ — center 컬럼 없으면 뷰 생성 실패. **현재 prod 에 center 컬럼 부재 확인(2026-07-14) → 아직 apply 불가, 선결 대기.**
4. supervisor 크리덴셜 생성 + body EF secret 전달
5. dev-body EF BFF + FE 실데이터 배선

부모결정 POLLER center DDL 과 **1 deploy unit 권고**(DA §Q3 L85). db_only → PROD apply 는 supervisor 별도 실행(`apply_migration_ose` 경로), git merge ≠ PROD 마이그 적용.

## supervisor deploy-precheck 4점 격리 실측 (dry-run 예행 완료, prod 재실측 대상)
1. 뷰 `WHERE center='body'` 리터럴 실존 + center/foot행 미노출 프로브 → dry-run A/B/C PASS
2. `body_recon_ro` base·foot뷰 grant=0 실측 → dry-run D PASS
3. FE 번들 foot 크리덴셜 grep=0 → **dev-body side**(body 레포), 본 foot 마이그 범위 밖
4. 부모결정 foot 대칭뷰 동시존재 → `to_regclass('public.v_redpay_reconciliation_daily')` NOT NULL 확인

## ⚠ 설계 관찰 (planner/supervisor 앞 — 비블로커 FOLLOWUP)
DA 정본은 body 뷰를 "부모결정 foot `center='foot'` 필터 뷰와 대칭 쌍"으로 기술하나, foot 측 격리 뷰(`v_redpay_reconciliation_daily`)는 **`redpay_raw_transactions`(center 컬럼 없음)** 를 **풋 merchant_id 17-set 하드필터**로 격리한다(center='foot' 술어 아님 — center 컬럼은 `payment_reconciliation_log` 에만 존재). 즉 **기능적 대칭**(둘 다 독립 하드필터·파라미터 공유 0·역방향 미교차)은 성립하나 **리터럴은 비대칭**(foot=merchant 화이트리스트 / body=center='body'). supervisor precheck (iv) "foot 대칭뷰 동시존재" = `v_redpay_reconciliation_daily` 존재로 판정(center='foot' 뷰 별도 부재). 도수매출→풋 recon 역방향 오염은 foot 뷰의 merchant 화이트리스트가 이미 차단(도수 band 1777274-276 구조적 배제).
