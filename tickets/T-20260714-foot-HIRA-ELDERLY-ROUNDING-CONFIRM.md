---
id: T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM
domain: foot
priority: P1
hotfix: false
status: deploy-ready
qa_result: pending (supervisor 게이트 + pg_proc PREFLIGHT(C10) + 배포 대기)
db_change: true
db_migration: supabase/migrations/20260714133000_calc_copayment_elderly_floor_rounding.sql (calc_copayment v1.4, pg_proc DROP+CREATE)
db_gate: REQUIRED (본인부담 금액 직결). DA 정책자문 = 기존 SSOT §2-2-3 규정 정정(신규 컬럼·테이블·enum 0, DDL=함수 body 교체만) → 스키마변경 0. supervisor 게이트 + pg_proc PREFLIGHT(deploy-precheck C10) 필수.
mig_files: up.sql + rollback.sql + apply.mjs 동봉. up=20260714133000_calc_copayment_elderly_floor_rounding.sql / rollback=동명.rollback.sql(→v1.3 CEIL 복원) / apply=scripts/apply_20260714133000_calc_copayment_elderly_floor_rounding.mjs
mig_dryrun: "No-Persistence Protocol PASS — DRYRUN=1(BEGIN..ROLLBACK) Status 201 green. up.sql 내장 COMMIT 0(txn-control 없음) 확인 → sentinel-bypass 무해. 사후 무영속 introspection: PRE-probe {has_floor:false,has_ceil:true}(v1.3 CEIL live) → POST-probe(DRYRUN 후) {has_floor:false,has_ceil_elderly:true} = prod 무변경 확정(DRYRUN 미반영)."
mig_ledger_check: "DROP+CREATE FUNCTION only(4-arg 단일 signature 유지, 오버로드 0). 데이터행 UPDATE 0(forward-only). schema_migrations 원장 write = supervisor exec lane 전속(dev-foot INSERT 안 함). base=v1.3(20260714120500 prod-live)."
mig_rollback: "rollback.sql = v1.3(20260714120500) CEIL body CREATE OR REPLACE 복원. 인자수 무변경 → 추가 DROP 불요. last-known-good=v1.3(v1.2/v1.1로 안 내림)."
build: pass (npm run build ✓ built in 5.31s)
scenario_count: 15 (신규 spec 12 PASS: 절사 비정수배 3 + 경계 3 + AC 정수배 3 + 정액무영향 1 + override 1 + parity 3 실검산) + 3 (parity/source 정적) ; 기존 T-20260713 spec 22 PASS(경계 CEIL→FLOOR 갱신 포함). 합 34 PASS.
e2e_spec: tests/e2e/T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM.spec.ts
spec: tests/e2e/T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM.spec.ts
deploy_commit: (아래 commit 참조)
deployed_at: n/a (NOT yet deployed — supervisor 게이트+PREFLIGHT+COMMIT apply 대기)
bundle_hash: copayCalc 클라 미러(Reservations/Closing/CheckIn 청크 인라인) — supervisor 운영배포 후 재검증. 권위=서버 RPC(v1.4).
created: 2026-07-14
completed: 2026-07-14
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (FIX-REQUEST MSG-20260714-134316-qcxo)
---

# T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM — 노인 정률구간 100원 미만 절사 정정

## SPEC (FIX-REQUEST 재정의)
종전 NEW-TASK(관행 10원 절사 `FLOOR(x/10)*10`) 및 현행 v1.3(`CEIL(x/100)*100`, 100원 올림)을
**규정 확정값 = 100원 미만 절사 `FLOOR(x/100)*100`** 로 정정.

### 규정 근거 (조사관/주무관 소명용 — 코드 주석·commit·마이그 헤더 인용)
- 국민건강보험법 시행령 별표2 제19조 제1항: 외래 본인부담금 "100원 미만은 제외한다" = **100원 미만 절사(버림)**. 법제처 https://www.law.go.kr
- 심평원 외래 본인부담기준표: 전 구분 "100원미만 절사" 동일. https://www.hira.or.kr
- 베가스 10원 단위 관찰(백승민) = 비급여/자보 혼재 추정, 급여 외래 규정과 별도 → **폐기**.

## 구현
1. **서버 RPC calc_copayment v1.4** (단일권위): elderly_flat 정률 3구간 `CEIL((v_base*rate)/100.0)*100` → `FLOOR(...)`.
   - 15k초과~20k=10% / 20k초과~25k=20% / 25k초과=30%.
   - 정액 1,500 구간(≤15k) 무영향. 타 등급 일반 정률경로(else)·의료급여 1종·override 경로 무변경.
2. **클라 copayCalc.ts** 미러(parity): 동일 3구간 `Math.ceil` → `Math.floor`.
3. base=v1.3(20260714120500 prod-live). hira governed/4구간/NULLFIX v1.2 전부 유지(델타=rounding only).

## 검증 (34 PASS)
- **절사 자체 회귀(비정수배)**: 18,050×10%=1,805 → **1,800**(CEIL 1,900 아님) / 21,990×20%=4,398 → **4,300** / 27,010×30%=8,103 → **8,100**.
- **경계**: 15,001→1,500 / 20,001→4,000 / 25,001→7,500 (각각 CEIL 대비 100원↓).
- **AC 정수배(절사 무관 통과)**: 18k→1,800 / 22k→4,400 / 27k→8,100.
- **parity**: copayCalc.ts=Math.floor / RPC=FLOOR / elderly 구간 CEIL 잔존 0 / 규정식 검산 일치.
- 기존 T-20260713 spec 경계 3건 CEIL→FLOOR 갱신(회귀 정합).

## MIG-GATE (db_change=true)
- No-Persistence Protocol PASS (frontmatter mig_dryrun 참조). PRE=CEIL live → DRYRUN 201 → POST 무변경.
- **apply(COMMIT) = supervisor exec lane**. dev-foot 는 up/rollback/apply.mjs + dry-run 증거까지 제공.

## §5 비블로킹 flag → planner FOLLOWUP (별건)
현행 CEIL 로 정률구간 3건 100원씩 초과징수 관찰(경영BO). 코드 fix(forward)가 우선 — 본 배포 무관.
대상건 식별·정정(refund/조정) 필요여부는 별도 FOLLOWUP 소명(소급 UPDATE=본 티켓 범위 밖).

ball=dev-foot(impl → deploy-ready) ✅ → **supervisor**(게이트+PREFLIGHT C10+COMMIT 배포) → 필드소크(라이브 65세 정률건 100원 절사 확인)
