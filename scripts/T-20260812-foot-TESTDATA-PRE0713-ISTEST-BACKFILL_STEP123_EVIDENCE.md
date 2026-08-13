# T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL — STEP1~3 증거 (apply-gated)

- **작성**: dev-foot / 2026-08-13
- **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm / prod)
- **성격**: 산출물 준비 + READ-ONLY 검증 완료. **prod DDL/UPDATE 0** (GO-token 前 apply 금지 준수).
- **아티팩트-클래스**: `db_only` (뷰 DDL 2 + 데이터 백필 1. src/FE 무변경 → E2E exempt).
- **게이트**: ★supervisor DDL-diff + DB-GATE GO-token 선행 필수. GO-token 後에만 apply.

---

## STEP1 [선결·재확인] — census vs DA 실측 SSOT 재대조 (완결)

planner RESUME §Step1: "census 가 어느 매출 surface 를 is_test 미필터로 결론했는지 재확인 vs DA 실측(v_daily_revenue 는 이미 customers.is_test customer-join 필터함)."

**결론: DA 실측이 LIVE prod ground-truth 와 정합. census(마이그 파일 기준) 오판 — prod 뷰가 out-of-band drift.**

`pg_get_viewdef` LIVE prod 실조회 (Management API, READ-ONLY):

| surface | is_test 필터? | is_simulation 필터? | customer-join | 판정 |
|---------|:---:|:---:|:---:|------|
| **v_daily_revenue** | ✅ `NOT COALESCE(c.is_test,false)` | ✅ | LEFT JOIN customers ON customer_id | **DA 주장 CONFIRMED**. 마이그파일(20260718)은 stale(status=active만). prod drift. 백필 즉시 반영 → 무개정. |
| **v_daily_visits** | ❌ | ❌ | 無 | STEP2 대상 (is_test 조인추가) |
| **v_daily_visit_rate** | ❌ | ❌ | 無 | STEP2 대상 (양 CTE) |

★ census 블로커②("매출뷰 is_test 미필터·축은 is_simulation")는 마이그 파일만 본 오판. LIVE prod 는 v_daily_revenue 가 is_test+is_simulation 양축 customer-join 필터. DA CONSULT-REPLY(MSG-20260812-194644-zwq7)의 census ⑤ FALSIFIED 및 축=is_test canonical 판정과 100% 정합.

### ▶ 별건 planner surface (다른 매출 surface is_test 미필터 — RESUME §Step1 "별건 surface" 보고 대상)

LIVE prod 실조회 결과, **STEP2 범위(2뷰) 밖에 is_test 미필터 매출/통계 surface 추가 존재**. 본 티켓 권한범위(is_test on 2 visit views + backfill) 밖 → **planner FOLLOWUP 별건 보고**(본 티켓에서 미수정):

| surface | is_test | is_simulation | 성격 |
|---------|:---:|:---:|------|
| `v_daily_avg_spend` | ❌ | ❌ | 매출/객단가 — is_test·is_simulation 양축 미필터 |
| `v_monthly_therapist_perf` | ❌ | ? | 월 치료사 매출 — customer-join 無 |
| `v_monthly_consultant_perf` | ❌ | ? | 월 상담사 매출 — customer-join 無 |
| `foot_stats_revenue` (RPC) | ❌ | ✅ (is_simulation NOT EXISTS) | /admin/stats RevenueSection 매출. **is_test 미필터** → 백필된 215명 이 RPC 매출엔 잔존 |

→ 215명이 이 4개 surface 에는 계속 노출. DA/planner 가 별건 ADDITIVE 티켓 여부 판단.

---

## STEP2 [ADDITIVE·통계뷰 is_test 필터] — CREATE OR REPLACE VIEW ×2 (준비완료, apply-gated)

- 파일: `supabase/migrations/20260813120000_foot_stats_visits_istest_filter.sql` (+ `.rollback.sql`)
- 패턴: LIVE v_daily_revenue 미러 = `LEFT JOIN customers cu ON cu.id=<grain>.customer_id ... AND NOT COALESCE(cu.is_test,false)`.
  - is_test 축만 이식(planner RESUME 권한범위). is_simulation 축 = 별 axis(DA GO 밖) → 미이식.
- 워크인 보존: LEFT JOIN + COALESCE → customer_id=NULL 행 보존(check_ins 13 / reservations 132).
- reloptions/GRANT 무변경(security_invoker=off 현행 유지 = 최소 diff). 출력 시그니처 불변 → CREATE OR REPLACE 즉시역전.

### READ-ONLY body 검증 (무DDL 서브쿼리, 2026-08-13)
| 뷰 | 지표 | OLD | NEW(개정) | Δ | 해석 |
|----|------|----:|----:|----:|------|
| v_daily_visits | Σ visit_count | 1092 | 1081 | -11 | 뷰개정 즉시효(현 is_test=true 11 check_ins 제외) |
| v_daily_visit_rate | 분모 reservations | 1971 | 1960 | -11 | 현 is_test=true 11 reservations 제외 |
| v_daily_visit_rate | 분자 check_ins | 1092 | 1081 | -11 | 동일 |

- 백필 후 추가효(215명): v_daily_visits check_ins -204 / v_daily_visit_rate reservations -233 (READ-ONLY 실측).
- 파싱·델타·워크인 보존 전부 PASS.

---

## STEP3 [백필] — customers.is_test=true (Data-Correction Backfill SOP, 준비완료, apply-gated)

- 파일: `db-gate/T-20260812-..._apply.sql` (+ `rollback/T-20260812-..._rollback.sql`)
- **대상셋 freeze**: `scripts/..._freeze_targetset.json` — 215 ids pin. ★off-git(PHI 정책 §gitignore `*backfill*` — 215 raw UUID 덤프 git 미추적). committed 무결성 앵커 = 아래 sha256 상수(apply SQL 내장).
  - frozen count = **215** · sha256(ordered id list) = **1396a1b85bfc2daf1feae04b17ad2aeabe6497d38f15f55cdffa04b6fb93a99b**
  - created 범위 = 2026-05-19 06:34 ~ 2026-07-11 06:58 (전건 pre-0713 = 경계=B 확인)
  - ★ SQL `digest()` 재계산 = node 산출과 **bit-identical** 검증 완료(READ-ONLY) → apply freeze 가드 정상.
- **멱등**: `COALESCE(is_test,false)=false` 가드 (이미 true 3건 제외 → 실 215건). 재실행 안전.
- **before_image**: durable audit `backfill_audit_20260812_istest` (id·is_test_before·created_at·flipped_at).
- **dry-run**: apply 직전 flip 예정 행수 RAISE NOTICE.
- **freeze 가드**: apply 시점 live count/sha256 재계산 → frozen 값 불일치면 ABORT(대상셋 drift 방어).
- **POST-VERIFY**: flipped==215 · 잔여false==0 · 경계(7/13+)접촉==0 assert(불일치 시 트랜잭션 abort).
- **폴백**: `_backfill_rollback.sql` — audit(before=false) 행만 is_test→false 복원(기존 true 3건 무접촉 fidelity rollback).
- flag = customers 에만 (check_ins/payments/packages 무접촉 — DA: customer-join 으로 매출/통계 제외 resolve).

### 대상셋 재count (2026-08-13 READ-ONLY)
| 항목 | 값 |
|------|---:|
| pre-0713 customers total | 218 |
| 이미 is_test=true (제외) | 3 |
| **백필 대상 (false∪null, 멱등)** | **215** |
| 7/13 당일 (경계 EXCLUDE) | 81 |
| pre-0713 is_simulation=true (병기) | 4 |

---

## 하드가드 준수 확인
- ★ prod UPDATE/DDL 0 (본 단계 = 준비 + READ-ONLY 검증). apply = supervisor GO-token 後.
- CEO informational surface(§3.1) — 승인게이트 아님(가역+A/A확정)이나 apply 前 planner 통지.
- 체험권 차감 정정 31건(7/14+)과 disjoint(컷오프 교집합 0) — 무접촉.
- 원장 진료화면(진료대시보드/진료관리) 무접촉 — §11 게이트 무관(데이터/통계뷰 정정).

## 배포 순서 (supervisor)
1. STEP2 뷰개정 마이그 DDL-diff → GO-token → apply (즉시효 -11).
2. STEP3 백필 freeze-gated apply → GO-token → apply (215 flip).
   - 순서 무관(뷰·백필 독립)하나, 뷰 先 → 백필 後 시 통계 반영이 원자적.
