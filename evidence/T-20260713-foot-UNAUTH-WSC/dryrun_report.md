# WS-C 오염행 정정 — dry-run + apply 준비 리포트 (dev-foot)

- 티켓: T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK (WS-C)
- DA 근거: DA-20260713-foot-SELFCHECKIN-WRITE-HARDEN **Q2 GO** (복합 merge/re-anchor, WS-A 랜딩 후)
- 상태: **dry-run PASS(무영속) · apply 는 supervisor 최종 DB-GATE 후** (WSC_APPLY=1 게이트)
- 실환자: **0** (전부 test/DUMMY)

## freeze셋 (VALUES 고정 · 재SELECT 금지)
| pair | dup master | raw 대응 | dup 성격 |
|---|---|---|---|
| A | `512998d0` (성명 마스킹/전화 tail …5453) | `8fa12f4c` (raw, 39초前) | new |
| B | `0356b229` (성명 raw/전화 tail …9089) | `c51dd5e0` (raw) | returning |

## per-row confirm (INV-3 · 결정적 FK키 부재 → 약신호 per-row)
- 두 check_in 모두 `reservation_id=NULL` → 결정적 merge키 없음.
- pair A: name-stem(최*트↔최종*) + phone-tail(…5453) + temporal(39s) = 3신호. **ACCEPT.**
- pair B: name **EXACT** + phone-tail(…9089); temporal gap 19.7h(주의·supervisor 검토). 2신호. **ACCEPT.**
- 실환자0 → 기본채택(INV-3: 약신호 단독 auto-merge 금지 원칙은 destructive 전 사람게이트=본 리포트+supervisor로 충족).

## ⚠ 토폴로지 divergence (DA Q2 자식모델 초과)
DA Q2 자식모델 = check_ins/status_transitions. **실측 = 6 FK테이블 8행:**

| FK | pair A | pair B | delete_rule |
|---|---|---|---|
| check_ins.customer_id | 1 | 1 | NO ACTION |
| health_q_tokens.customer_id | 1 | 1 | CASCADE |
| health_q_results.customer_id | 0 | 1 | CASCADE |
| customer_consult_memos.customer_id | 0 | 1 | CASCADE |
| package_payments.customer_id | 1 | 0 | NO ACTION |
| packages.customer_id | 1 | 0 | NO ACTION |
| (+ status_transitions ×11 via check_in_id — 재앵커 불요) | | | |

- **CASCADE(health_q*,consult_memos) + NO ACTION(check_ins,packages,package_payments) 혼재** →
  check_ins-only 재앵커(DA 문자 그대로)로는 dup 삭제 시 (a) NO ACTION 차단 또는 (b) CASCADE 순소실.
- ∴ **전 FK full re-anchor 가 유일한 순소실0 경로.** = DA "merge/re-anchor + 순소실0" 원칙의 실토폴로지 충실 실행(설계변경 아님).
- raw 대응행은 각 자식종을 **0건 보유** → merge 충돌(unique) 없음(clean re-parent).

## DA CONSULT-REPLY(2lha) guardrail G1–G3 확인 (supervisor DB-GATE 확인점)

> child-model divergence **RESOLVED** — DA 2lha: 전 6 FK full re-anchor = **faithful execution**(scope 확장/설계변경 아님, net-loss-0 grain-agnostic). 명시 2종(check_ins/status_transitions)은 illustrative 였을 뿐 scope 상한 아님. 아래 3종 guardrail 을 마이그 + dry-run + apply 러너 전부에 반영.

| G | 내용 | 반영 위치 | dry-run 실측 |
|---|------|-----------|--------------|
| **G1** (financial 원장 무접점) | package_payments 재앵커 = `customer_id` **FK-only UPDATE**, 금액/결제 컬럼 무접촉. 재앵커 전후 `SUM(amount)`/`SUM(vat_amount)`/`COUNT` 불변 assert 동봉 (변동 시 `WSC_ABORT_G1` 전체 롤백) | 마이그 DO블록 · merge-dryrun DO블록 · apply 러너 post-verify | `SUM(amount) 100→100` · `SUM(vat) 0→0` · `cnt 1→1` = **불변 ✅** |
| **G2** (clinical PHI) | health_q_tokens/health_q_results/customer_consult_memos 재앵커 = FK 컬럼(`customer_id`) **1개만 SET**, 내용/동의링크 무변경. 평문 PHI off-git(스냅샷 redacted·로그 name redact) | 마이그 재앵커 루프(동적 FK, SET 1컬럼) | 재앵커 대상 = FK 컬럼뿐(내용 컬럼 미접촉) |
| **G3** (최중요·CASCADE 순서 불변식) | CASCADE+NO ACTION 혼재 → 순서 고정: **(1)** 전 6 FK 자식 raw master 로 re-anchor UPDATE 완료 → **(2)** dup master 6 FK 전반 자식 **0건 재검증**(잔존 시 `RAISE` abort·전체 롤백) → **(3)** archive-first remove(master empty→CASCADE 무해화) | 마이그 DO블록이 이 순서 강제(re-anchor→`v_remaining=0` assert→DELETE) · apply 러너 archive-first 선행 | 재앵커 후 dup 자식(전 FK)=0 → DELETE 2 |

**판정근거 스냅샷 자식건수 = 기계열거된 전 6 FK 카운트**(information_schema 동적 열거 · 2종 부분집합 금지 · 손열거 undercount 차단, orphan_archive_fk_guard_sop §2-0):

```
check_ins.customer_id            n=2  NO ACTION
health_q_tokens.customer_id      n=2  CASCADE
customer_consult_memos.customer_id n=1 CASCADE
health_q_results.customer_id     n=1  CASCADE
package_payments.customer_id     n=1  NO ACTION
packages.customer_id             n=1  NO ACTION
= 6 FK 테이블 · 8 자식행 (+ status_transitions ×11 via check_in_id, 재앵커 불요)
```
재실행 로그: `dryrun_rerun_G1G3_1520.log` (off-git·평문 PHI redact).

## dry-run (BEGIN..RAISE→ROLLBACK, 무영속)
- 전 6 FK 재앵커 → dup 참조 자식(전 FK) **0** → **G1 금액 불변 assert PASS** → dup DELETE **2** → **ROLLBACK**.
- 무영속 사후확증: dup customers 잔존=2 · dup 자식 check_ins=2 (실변경 0).
- 커밋 마이그(20260713140000) DO블록 로직을 merge-dryrun 이 1:1 미러(G1 assert 포함) 실행 PASS(plpgsql 동적 FK 루프 정상).

## apply 절차 (supervisor 최종 DB-GATE 후 · WSC_APPLY=1)
1. archive-first(off-git `_backup`): dup master 2행 + 자식 relink 로그 8행 선적재 (DA §4 archive tracked CREATE 금지 준수).
2. archive 정합 검증(2·8).
3. applyMigration(20260713140000): 전 6 FK 재앵커 + **G1 금액 불변 assert** + guard(dup 자식 0 assert, G3) + DELETE + 원장 정직등재.
4. post-verify: dup 소멸(0) · raw 무손실(2) · dup 참조 0 · raw 자식 인수 · **G1 package_payments SUM(amount) baseline 불변** · **147 무접촉** · 원장 1행.

## abort 불변식 (승인·속도 무관)
- 147(`fn_selfcheckin_today_reservations`) **무접촉** (WS-C 는 customers/자식 DML 만).
- 키오스크 anon raw-PHI-0 (§15-5-1) 무관(반환면 미접촉).
- freeze 재검증 abort: baseline customers≠4 또는 재앵커 후 dup 자식≠0 시 즉시 롤백.
- **G1 abort**: package_payments SUM(amount)/SUM(vat)/COUNT 재앵커 전후 변동 시 `WSC_ABORT_G1` 전체 롤백(원장 무접점 강제).
- PHI 위생: 평문 성명/전화 git 금지 → redacted 스냅샷만 커밋(로그는 .gitignore off-git·name redact 적용).

## MIG-GATE 4필드
- mig_files: `20260713140000_wsc_oxrow_merge_reanchor_remove.sql` (+ `.rollback.sql`)
- mig_dryrun: **pass** (BEGIN..ROLLBACK 무영속 + G1 금액 불변 assert PASS + 6 FK full re-anchor 후 dup 자식0)
- mig_ledger_check: net-new(20260713140000 미등재) → apply 시 정직등재. 무충돌.
- mig_rollback: `.rollback.sql` — _backup 에서 dup master 재삽입 + 자식 old_customer_id 재앵커 복원.

## 재검증 (dev-foot, 2026-07-13 14:32 KST · PUSH vx3z proceed)
- planner PUSH `MSG-20260713-140550-vx3z`(파괴적-apply-HOLD 해제·WS-C proceed) 수신 → merge dry-run **prod 재실행**.
- 결과 **재현 일치·PASS**: freeze 4행 정합(dup 2 masked + raw 2 PII) · reservation_id 부재(결정적키0)→per-row(INV-3)·실환자0 기본채택 · 전 FK 스캔 6종 8행 · full re-anchor 후 dup 자식 0 · dup DELETE 2 · ROLLBACK 무영속(dup customers 잔존 2 재확인).
- abort 불변식 재확인: 147(`fn_selfcheckin_today_reservations`) **무접촉**(마이그 DML=customers/자식 FK만·147 comment-only 무참조) · 키오스크 anon raw-PHI-0(§15-5-1) 무관(반환면 미접촉) · PHI 위생(git-tracked WSC 아티팩트 평문 성명/전화 0건 grep 실증) · 원장=apply 시 net-new 20260713140000 정직등재.

## G1–G3 보강 재검증 (dev-foot, 2026-07-13 15:20 KST · DA 2lha GO CONFIRMED 반영)
- DA CONSULT-REPLY(2lha) 수신: child-model divergence **RESOLVED** — 전 6 FK full re-anchor = faithful execution 확정. G1–G3 guardrail 을 마이그/dry-run/apply 러너 전부에 반영 후 prod 무영속 **재실행 PASS**(로그 `dryrun_rerun_G1G3_1520.log`, off-git):
  - **G1**: package_payments `SUM(amount) 100→100`·`SUM(vat) 0→0`·`cnt 1→1` = 불변 assert PASS(변동 시 WSC_ABORT_G1 롤백).
  - **G2**: clinical(health_q*/consult_memos) 재앵커 = FK 컬럼 1개만 SET·내용/동의 무접촉·평문 PHI off-git(로그 name redact 적용).
  - **G3**: re-anchor(6 FK) → dup 자식 0 재검증(전 FK) → archive-first remove 순서 마이그 DO블록이 강제. 무영속 재확증(dup 잔존 2).
  - 판정근거 스냅샷 자식건수 = **기계열거 전 6 FK 카운트**(2종 부분집합 아님·delete_rule 동반).
- ball → **supervisor 최종 DB-GATE**(WSC_APPLY=1, G1–G3 + 6 FK 카운트 확인) → 승인 시 archive-first apply → 현장 통합 confirm(스레드 1783902832.916999).
