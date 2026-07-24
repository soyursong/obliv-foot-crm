# (B) 서류테스트2 완료건 FK-closure — RE-DRY-RUN 리포트 (READ-ONLY, WRITE 0)

- 생성: 2026-07-24 (DA CONDITIONAL-GO 후 재-dry-run, 아침 hand-enum 스냅샷 폐기)
- 근거: planner NEW-TASK MSG-20260724-215409-q3zd / DA verdict MSG-20260724-214823-roen (DA-...-FKCLOSURE-PURGE-GATE.md §1)
- 모드: **READ-ONLY 재-dry-run. hard-DELETE 미실행. WRITE 0. prod 무변경.**
- 러너: `scripts/..._B_redryrun_fullfk.mjs` (동적 full-FK fixpoint census, ref 192700eb 계승·확장 — payments/service_charges/package_sessions/packages 까지 부모로 walk)
- 대상: 서류테스트2 F-5113, customer=80df7a6b-077d-46db-b9db-31591f3977a4, check_in=7f3f8b79
- 증거 JSON: `scripts/..._B_REDRYRUN_EVIDENCE.json`

## ★ 종합 판정: **ABORT (hard-DELETE 금지) — 재-adjudication 필요**

DA §1 게이트 "a/r·n 보유 자식 0 확인" **FAIL**. 아침 hand-enum(~11행)이 놓친 자식이 대량 검출 = foot dummy gate 4차(22→30) undercount 교훈 재현. Q1 매출정합도 미CLEAR. fail-closed 원칙에 따라 삭제 착수 불가.

---

## 1) full-FK fixpoint census — hand-enum undercount 재현

동적 census(children→grandchildren 소진)로 확정 스코프 밖 자식 **8개 테이블** 신규 검출:

| 부모 | 자식.컬럼 | 건수 | confdeltype | 확정스코프 |
|---|---|---|---|---|
| check_ins | check_in_services | 9 | **CASCADE(c)** | ✗ 신규 |
| check_ins | status_transitions | 6 | **CASCADE(c)** | ✗ 신규 |
| customers | health_q_tokens | 1 | **CASCADE(c)** | ✗ 신규 |
| customers | reservations | 1 | **NO ACTION(a·차단)** | ✗ 신규 |
| customers | notification_logs | 1 | **SET NULL(n·silent)** | ✗ 신규 |
| customers/check_ins | form_submissions | 10 | **NO ACTION(a·차단)** | ✗ 신규 ★ |
| customers | health_q_results | 1 | **RESTRICT(r·차단)** | ✗ 신규 ★★ |
| payments | payment_reconciliation_log | 324 | **SET NULL(n·silent)** | ✗ 신규 ★★★ |
| (seed) check_ins/payments/service_charges/package_sessions/packages/assignment_actions | — | 11 | 확정스코프 | ✓ |

- **실 삭제 근사 = 28행** (seed 11 + CASCADE 자식 16: check_in_services 9 + status_transitions 6 + health_q_tokens 1).
- **SET NULL silent 순소실 대상 = payment_reconciliation_log 324행** (삭제 아님 — payment_id=NULL 로 정산 대사원장 훼손) + notification_logs 1.
- **차단자(a/r) = health_q_results 1[RESTRICT], reservations 1[a], form_submissions 10[a]** — 전부 확정스코프 밖.

### ★ DA §1 게이트 판정: a/r·n 보유 자식 **≠ 0 → FAIL**
RESTRICT 1 + NO ACTION(스코프밖) 11 + SET NULL 325(324+1) 검출. 아침 스냅샷은 이 전량을 미인지.

## 2) Q1 매출정합 fail-closed 증거 (hinge = service_charges 명세 grain)

- **service_charges 실체 확증**: base 18,840+10,535=**29,375**, copay 5,600+3,100=**8,700**, is_insurance_covered=true → 공단부담 split 권위 (payments net0 아님).
- **CLEAR-A ❌ 미CLEAR**:
  - `is_simulation` 컬럼 = **customers 에만 존재**. payments·service_charges 에는 **컬럼 부재**.
  - customers(서류테스트2) `is_simulation` = **FALSE** (sim_true=0, sim_notrue=1) → 시뮬레이션 유니버스 밖 = 실 유니버스 內.
- **CLEAR-B ❌ foot lane 단독 확증 불가**:
  - payments.accounting_date = **2026-07-24 (금일)** → 소급(과거 마감일) 아님 ✓.
  - foot DB 에 `daily_closings`·`closing_confirmed_outbox`·`closing_manual_payments` 존재하나, **fct_revenue_daily 는 foot DB 부재(데이터레이크 별 lane)**.
  - (a)금일 서울오리진점 마감확정 payload 미발사 (b)fct 미포함 = **DA/dev-sales lane 대사 필요**, dev-foot 단독 미확증.
- ★ **둘 다 미CLEAR → payments/service_charges hard-DELETE ABORT** (fail-closed: 미증명+non-sim → 보고된 것으로 간주).
- ★★ **강등(is_simulation=TRUE flip) 폴백도 즉시 불가**: payments·service_charges 에 `is_simulation` 컬럼 부재 → 신규 컬럼 추가 필요 = **data-architect CONSULT 게이트 재선행 대상** (dev 임의 DDL 금지).

## 3) package 01ddef31 (AF레이저, memo=테스트용환불예정) 기계확증 ✅

- `package_payments`(선수금 원장) 테이블 **부재 → 0행 확증**.
- packages money: **total_amount=300,000, paid_amount=0** (paid0 확증). packages 스키마에 refund/insurance/closing/credit/deposit 컬럼 **부재 → 0 확증**.
- package_sessions: 회차 **1건(session#1 unheated_laser, status=used)** — 삭제 시 packages 01ddef31 = 0회차 orphan.
- 삭제순서: package_session → packages(session0·payments0 재검증) → orphan package. 승인 시에만.
- → 테스트 데이터로 기계확증. (단 회차 status='used' — 매출/명세 연동 여부는 §2 service_charges 판정에 종속.)

## 4) form_submissions 불변 트리거

- `trg_form_submissions_published_immutable` = BEFORE DELETE/UPDATE, **`OLD.status='published'` 일 때만** 42501 RAISE.
- closure 10건 전부 **status='printed', signed_at=null** → 삭제 시 42501 **미발화** (published 아님).
- 단 form_submissions FK 는 **NO ACTION(a)** → customers/check_ins 삭제를 차단(선삭제 필요) + 확정스코프 밖.

## 5) net-loss=0 준비 (완전성)

- 대상 테이블 전-컬럼 명시열거 완료(SELECT * 금지): customers 81 / check_ins 61 / payments 43 / service_charges 17 / package_sessions 19 / packages 40 / assignment_actions 11. (evidence JSON `columns`)
- freeze 는 확정스코프(11행) 기준으로만 존재. 신규 검출 8테이블은 freeze·archive 미포함 → archive-first 완전성 미충족.

---

## FOLLOWUP 권고 (planner 회신)

1. **hard-DELETE 전면 ABORT** — 확정스코프(11행) ≠ 실 closure(삭제28 + SET NULL 325 + RESTRICT 차단). no-snapshot-no-delete + a/r·n≠0.
2. **총괄 scope-확대 재confirm 필요**: form_submissions(10, 의무기록 printed)·reservations(1)·health_q_results(1)·health_q_tokens(1)·notification_logs(1)·check_in_services(9)·status_transitions(6)·payment_reconciliation_log(324) 포함 = DECISION-REQUEST zz4v 스코프 갱신 필요.
3. **Q1 CLEAR-B 대사를 DA/dev-sales lane 로 위임**: 금일 서울오리진점 마감확정 payload 발사여부 + fct_revenue_daily(this clinic·2026-07-24) 이 29,375/8,700 미포함 확인. 미CLEAR 시 payments/service_charges 는 삭제 대신 강등(is_simulation) 검토.
4. **강등 경로 채택 시 DA CONSULT 재선행**: payments/service_charges `is_simulation` 컬럼 신규 추가 = 스키마 변경 → data-architect 자문 게이트.
5. package 01ddef31 (paid0·orphan) = 테스트 확증 OK, 단 §3 회차-service_charges 연동 판정에 종속.

## HOLD 게이트 (변경 없음)
hard-DELETE 는 (1) 총괄 scope-확대 confirm (2) supervisor DB-GATE (3) 형 apply_gate **3게이트 모두 통과 후에만**. 본 리포트는 그 前 evidence 산출물.
