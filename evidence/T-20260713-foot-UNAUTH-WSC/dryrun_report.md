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

## dry-run (BEGIN..RAISE→ROLLBACK, 무영속)
- 전 FK 재앵커 → dup 참조 자식(전 FK) **0** → dup DELETE **2** → **ROLLBACK**.
- 무영속 사후확증: dup customers 잔존=2 · dup 자식 check_ins=2 (실변경 0).
- 커밋 마이그(20260713140000) 자체도 COMMIT→ROLLBACK 치환 실행 PASS(plpgsql 동적 FK 루프 정상).

## apply 절차 (supervisor 최종 DB-GATE 후 · WSC_APPLY=1)
1. archive-first(off-git `_backup`): dup master 2행 + 자식 relink 로그 8행 선적재 (DA §4 archive tracked CREATE 금지 준수).
2. archive 정합 검증(2·8).
3. applyMigration(20260713140000): 전 FK 재앵커 + guard(dup 자식 0 assert) + DELETE + 원장 정직등재.
4. post-verify: dup 소멸(0) · raw 무손실(2) · dup 참조 0 · raw 자식 인수 · **147 무접촉** · 원장 1행.

## abort 불변식 (승인·속도 무관)
- 147(`fn_selfcheckin_today_reservations`) **무접촉** (WS-C 는 customers/자식 DML 만).
- 키오스크 anon raw-PHI-0 (§15-5-1) 무관(반환면 미접촉).
- freeze 재검증 abort: baseline customers≠4 또는 재앵커 후 dup 자식≠0 시 즉시 롤백.
- PHI 위생: 평문 성명/전화 git 금지 → redacted 스냅샷만 커밋(_artifacts/…_judgment_snapshot.redacted.json).

## MIG-GATE 4필드
- mig_files: `20260713140000_wsc_oxrow_merge_reanchor_remove.sql` (+ `.rollback.sql`)
- mig_dryrun: **pass** (BEGIN..ROLLBACK 무영속 + 커밋 마이그 SQL 무영속 실행 PASS)
- mig_ledger_check: net-new(20260713140000 미등재) → apply 시 정직등재. 무충돌.
- mig_rollback: `.rollback.sql` — _backup 에서 dup master 재삽입 + 자식 old_customer_id 재앵커 복원.
