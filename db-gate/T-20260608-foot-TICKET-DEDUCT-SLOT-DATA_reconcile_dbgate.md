# T-20260608-foot-TICKET-DEDUCT-SLOT-DATA (reconcile-R5) — 42P13 해소 + AC1/AC3 재이식 db-gate 증거

- **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm PROD, foot 단일 Supabase)
- **표준**: Migration Ledger Reconciliation (DA-20260704-body-MIG-LEDGER-RECONCILE) — 정본=prod 실재
- **신규 마이그**: `20260706120000_foot_stats_reconcile_iv_exclude_sameday_conv.sql` (+ `.rollback.sql`)
- **격리(SUPERSEDED)**: `20260608160000_foot_stats_iv_exclude_trial_conversion.sql` / `20260619010000_foot_stats_by_category_pkg_created.sql` (+ 각 rollback)
- **실측 시각**: 2026-07-06 KST
- **검증 스크립트**: `_reconcile_stub_schema.sql`, `_reconcile_seed_verify.sql` (동봉), prod dry-run = Management API `/database/query` (read-only + BEGIN/ROLLBACK)

## 1. 정본 확정 (원장 ↔ prod 실재 divergence)

| 항목 | 실측 |
|------|------|
| `schema_migrations` 원장 | 20260608130000·20260608160000·20260619010000·20260622120000·20260623120000·20260623130000 **전부 미기록** (원장 tail=20260625140000) |
| prod 실물 `foot_stats_therapist_summary` | **10컬럼 v2** (roster·designated·treatment-exit-window 계보, OOB 물화) |
| prod 실물 `foot_stats_by_category` | **3컬럼, pkg_used 브랜치** (iv 필터 없음, OOB 물화) |
| `packages.contract_date` | 16/16 (100%) — 데이터 정상, 함수 body 에 필터만 부재 |

→ 두 함수는 OOB(대시보드/관리 API 직접)로 prod 물화됨. **base = 현행 prod prosrc 덤프** (md5 by_category=`daf173582…`, summary=`a2059a8e…`).

## 2. 42P13 root-cause 재현 (로컬 shadow)

prod 10컬럼 summary 설치 후 구 마이그(20260608160000, 7컬럼) apply 시도:

```
ERROR: cannot change return type of existing function
DETAIL: Row type defined by OUT parameters is different.
HINT: Use DROP FUNCTION foot_stats_therapist_summary(uuid,date,date) first.  -- 42P13
```

∴ 구 마이그를 db push/apply 하면 10→7컬럼 축소 = 42P13 + 6/9~6/23 후속계보 regress. → `.SUPERSEDED` 격리.

## 3. 신규 reconcile 마이그 검증 (로컬 shadow, prod-base 위)

| 검증 | 결과 |
|------|------|
| reconcile apply | ✅ 성공, **42P13=0** |
| 시그니처 by_category | ✅ `TABLE(category text, sessions bigint, amount bigint)` 불변 |
| 시그니처 therapist_summary | ✅ 10컬럼 불변 |
| AC1 필터 body 반영 | ✅ `session_type <> 'iv'` present |
| AC3 필터 body 반영 | ✅ `pk.contract_date = b.kst_date` present |
| 멱등 재적용(2회) | ✅ 성공 (CREATE OR REPLACE) |

### 3.1 기능 behavior (seed 데이터)
- **AC1**: iv used-session(₩50,000) **통계 제외**, heated_laser(₩30,000)만 집계. 차감 UI/이력 무변경.
- **AC3**: exp_total=2, converted=**1** (당일 생성 pkgA 만), rate=**50.0** (필터 미적용 시 100.0 이었을 것). 비당일 결제(pkgB) 미집계.

## 4. PROD dry-run (BEGIN→apply→ROLLBACK, prod 쓰기 0건)

- ✅ reconcile 가 **실 prod 카탈로그**에서 트랜잭션 apply 성공 — **42P13=0**, 시그니처 3컬럼/10컬럼 유지.
- ✅ ROLLBACK 후 prod body md5 = `daf173582…` / `a2059a8e…` (dry-run 이전과 동일) → **prod 무변경**.

### 4.1 PROD 숫자 이동 (read-only)
| 지표 | 현재 prod |
|------|-----------|
| AC1: iv used-session 수 / 제거 매출 | 0건 / ₩0 |
| AC3: converted(OLD any-payment) → converted(NEW sameday) | 0 → 0 (exp_total=1) |

→ 현 prod 데이터가 초기·희소(종로 오픈 초기)라 **두 필터 모두 현재 0 이동**(무회귀). 미래 데이터부터 정책대로 반영. 현장 사전고지 트리거 불요(숫자변동 0).

## 5. MIG-GATE 4필드

- **mig_files**: `supabase/migrations/20260706120000_foot_stats_reconcile_iv_exclude_sameday_conv.sql` (+ `.rollback.sql`). SUPERSEDED 격리: `20260608160000_*`, `20260619010000_*` (+rollback).
- **mig_dryrun**: PROD BEGIN→apply→ROLLBACK 성공, 42P13=0, 시그니처 보존, prod body md5 무변경(§4). 로컬 shadow fresh-apply 42P13=0(§3).
- **mig_ledger_check**: 관련 6버전 원장 미기록 = OOB divergence(정본=prod 실재). 본 마이그는 prod prosrc base + body-only 필터 → 재실행 안전. 원장 동기화(`db repair --status applied`)는 supervisor 소관(broader ledger sweep T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP). db push 로 SUPERSEDED 2종 재실행 금지.
- **mig_rollback**: `20260706120000_*.rollback.sql` — 두 함수를 reconcile 직전 prod prosrc 로 복원(필터 제거), 시그니처 불변, 42P13 불가. shadow 검증 완료.

## 6. 20260619010000 처리 근거

repo 20260619010000 은 by_category 를 pkg_used(소진)→pkg_created(생성/판매, CROSS JOIN LATERAL) 로 바꾸는 **KPI 귀속단위 변경**이며 **G1(김주연 총괄 confirm, human_pending: MSG-20260619-020826-m4cw) 미충족 = prod 미적용·parked**. planner 본문의 "iv-exclude" 표기는 부정확(실체=pkg_created). point-2 지시대로 **prod base(pkg_used)+iv-exclude** 채택, pkg_created 원본 강행 금지. 20260619010000 은 `.SUPERSEDED` 격리로 **별도 적용 차단**. pkg_created 재추진 시 G1 confirm 후 **신규 timestamp** 마이그 필요(구 timestamp 부활 금지 — 본 reconcile 뒤 순서라 무효).

## 7. 게이트

- **supervisor DDL-diff** — ▶ 대기 (비파괴·시그니처 보존 body-only, CEO 게이트 불요, autonomy §3.1).
- **AC4 컬럼 마이그** `20260608130000` (additive·nullable) = 병행 위임(MSG-20260706-050227-hl29). **AC4 주입로직 = 본 티켓 제외** → follow-up T-20260706-foot-DEDUCT-SLOT-DWELL-INJECT.
