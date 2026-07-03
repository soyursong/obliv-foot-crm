# T-20260703-foot-P1-DATALAKE-FACTPIPE — CRM raw → datalake 적재 무결성 검증

- **owner:** dev-foot
- **scope:** foot CRM(`rxlomoozakkjesdqjtvd`, clinic_slug=`jongno-foot`, clinic_id=`74967aea-a60b-4da3-a0e7-9c997a930bc8`) raw 적재 무결성 확인·보강
- **method:** service-role REST 직접 조회(silver PoC 재현 기준 `_silver/analytics/_scripts/fct_footbody_p1_poc.py`) + clean 재조회
- **verified_at (local):** 2026-07-03
- **db_change:** 없음 (적재 무결성 확인만 — 스키마 변경/보강 불필요)

---

## 1. 원천 raw 무결성 (AC1) — PASS

| 테이블 | count | 비고 |
|---|---|---|
| customers | 72 | 06-30 purge 보존 28 + 이후 신규 44 (28+44=72 정합) |
| reservations | 237 | ex-cancel 224 / cancelled 13 / source_system=dopamine 3 |
| check_ins | **105** (active 100, checked_in_at 100) | ※ 티켓 premise 103 → 실측 105/100 |
| payments | **22** | payment 19 + refund 3 / status active 18 + deleted 4 |

- **06-30 TESTDATA-PURGE post-verify 정합**: `db-gate/T-20260630-foot-TESTDATA-PURGE_pass2_post_verify.txt` 의 보존 28명 자식이력 payments=22 와 **정확히 일치**. orphan 0. → 누락·drift 없음.
- **스키마 성숙도(payments)**: `accounting_date`·`taxable_amount`·`tax_exempt_amount`·`tax_type`·`status` 전부 존재 → revenue split(급여/비급여/공단) SSOT 적용 가능(silver 실측 대상).
- **스키마 주의(check_ins)**: soft-delete 컬럼(`deleted_at`/`cancelled_at`) **없음** → active 판정 = `status != 'cancelled'` 만. (PoC의 deleted_at/cancelled_at 필터는 foot에서 no-op.)

## 2. 위생 게이트 (AC3) — 재현 PASS

- 더미폰(attribution_bridge §1 v2 R1/R2): **0건**.
- `[TEST-0609]` memo 결제: **0건**. `check_in_id IS NULL` 결제: **0건**.
- 06-30 purge 정합: post-purge baseline(created ≥ 06-30) = **44명**. (※ spec §2.B 서술 baseline 67 → 실측 44. 재확인 요청.)

## 3. 신환 정의 (AC2) — 재현 가능

- 신환 = `customers.created_at` 기준(foot reservation_type NULL 전건 → scalp 선례 created_at 1차 소스). 재현 OK.
- 내원율: all-time 0.4464(=visited 100 / resv_ex_cancel 224), 신환(post-0630) 내원율 0.6512(=28 / 43). `v_daily_visit_rate` 뷰 52행·anomaly(>100%) 0.

## 4. ⚠️ DoD② 급전 블로커 — arpu_consult = NULL (실 payments 15, 전건 test-era)

실 결제 정제 결과:

| 지표 | 값 |
|---|---|
| payments 실건(refund/deleted/test 제외 + check_in 연결) | **15** (≠ 티켓 premise 22; 22=refund 3·deleted 4 포함 총량) |
| 실건 금액 합 | 3,360,050원 |
| 실건 결제일 범위 | **2026-05-20 ~ 2026-06-19 (전건 `dt < 2026-07-01`)** |
| post-0630 신환(44명)의 실건 결제 | **0건** |
| → `poc_arpu_consult` (신환매출/신환결제) | **NULL** |

**핵심 충돌 (DA 판정 필요):**
- 15건 실건은 전부 **purge 보존 28명(created < 06-30)** 소유이며, 결제일 전건이 `dt < 2026-07-01`.
- **purge 계약** = 이 28명 + 22 payments를 "real 보존"으로 유지.
- **funnel viewspec §3** = `dt < 2026-07-01` = 테스트-era → 운영 trend **배제**.
- 두 계약을 동시 적용하면 foot 운영 baseline revenue = 0 / arpu_consult = NULL.
- → 즉 **"payments 실건 존재 = 결제게이트 MET → arpu 즉시 산출"** 전제가 현재 데이터로 성립하지 않음. DA가 (a) 보존 15건을 운영 revenue로 볼지 vs (b) §3대로 test-era 배제할지 ruling 필요.

## 5. datalake/bronze 적재 경로

- foot CRM는 `_bronze/` 별도 staging 스크립트 없음 → silver가 service-role REST로 **직접 소비**(PoC로 read 정상 확인). 별도 bronze 적재 보강 불요.
- 접근 키: `~/.config/medibuilder-secrets/foot-supabase-service-role` (정상).

## 6. 판정

- **dev-foot 소유 deliverable(CRM raw → datalake 적재 무결성): PASS** — raw 전건 present·정합(purge post-verify 일치)·drift 0·hygiene clean·ingestible. 보강 불요.
- **downstream 급전 corrections → agent-silver** (정확 모수: 실건 15 / check_ins 105·active 100 / 신환 44 / arpu NULL).
- **DoD② arpu·revenue 계약 충돌 → agent-data-architect CONSULT + planner FOLLOWUP** (purge-보존 vs §3 test-era 배제).
- fct 산출·라벨(sample_thin/arpu NULL/spend pending)은 silver 소유(경계 준수).
