# T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP — 0821 GAP superseded-remap EVIDENCE

- **source**: recon-autoroute A11 DRIFT GAP-REPORT `MSG-20260821-081505-w3n0` (from data-architect)
- **class**: NEW-TID under known merchant (§9/§11-class) → superseded-remap seed (A11 규약 DA 자율·대표게이트 면제)
- **artifact-class**: `db_only` (no-DDL data-lane UPDATE, superseded_tids/소비뷰 = Opt-B′ 旣배포)
- **window**: 2026-08-18~08-21 (4d), feed 415 txn (foot_ok=313, nonfoot=98)

## remap 매핑
| merchant | label | old_tid | new_tid | band |
|---|---|---|---|---|
| 1777285004 | 풋(VAN) | 1047479261 | 1047535839 | 535xxx VAN |
| 1777288005 | 풋(유선) | 1047479473 | 1047538247 | 538xxx 유선 |

## pre-probe (READ-ONLY, 2026-08-21)
- superseded_tids 컬럼 실재 = 1
- 285004: tid=1047479261, superseded=NULL, active=true, domain=foot ✅
- 288005: tid=1047479473, superseded=NULL, active=true, domain=foot ✅
- 신 2 TID registry 전역 부재(count=0) → plain INSERT silent-drop 확증
- 뷰 표면화 현재=0

## dry-run (무영속 protocol) — PASS
- ① pre-probe: has_superseded_col=1, two_at_old_tid=2, new_tids_present=0
- ② trial-apply: rows_affected=2, new_tid_rows_in_txn=2 (DRYRUN_ROLLBACK_SENTINEL unwind)
- ③ post-probe: still_old_tid=2, new_tid_persisted=0 (무영속 ✅ PASS)
- ④ forecast: gap_rows_raw=2, gap_amt_raw=2,000,100, visible_now=0, visible_after_remap=2 (0→2 완전 수렴 ✅)

## prod-apply (mgmt API, 2026-08-21) — DA 자율·대표게이트 면제
- BEFORE-IMAGE: 285004 tid=1047479261/superseded=null/updated_at=2026-07-17 · 288005 tid=1047479473/superseded=null/updated_at=2026-07-20
- APPLY: up.sql executed
- AFTER-IMAGE:
  - 285004 → tid=1047535839, superseded=["1047479261"], active=true
  - 288005 → tid=1047538247, superseded=["1047479473"], active=true
- new_tid_persisted=2 ✅ · old_tid_in_superseded=2 ✅
- 뷰 v_redpay_reconciliation_daily @ 신 TID: **0 → visible** (535839:3행 · 538247:3행; raw gap 2건/₩2,000,100 external_status=Y, 538247 진성매출 ₩2,000,000 포함) ✅

## 정합 note
- A11 feed(4d net) cnt=2/amt=0 vs raw all-time cnt=2/amt=2,000,100 차이 = feed window·net 집계축 차이. remap 은 tid-membership 기반 → 신 TID raw 전량 소급 표면화(무관, silent-drop 아님).
- A11 baseline **28/43 → 28/45** (merchant 무증가·tid∪superseded +2). count<28/45 = 차기 예상외 회귀 신호.

## 파일
- migration: `supabase/migrations/20260821120000_redpay_foot_registry_0821gap_remap.sql` (+.rollback.sql +.dryrun.mjs)
- spec: `tests/e2e/T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP.spec.ts` (8 tests PASS)
- SSOT doc: `redpay_foot_terminal_registry.md` §11 표 2행 갱신 + POST-SEED 서브엔트리

## gates
- no-DDL 확인 (ALTER/CREATE/DROP/ADD COLUMN/INSERT/DELETE 0) — I4 spec PASS
- dry-run 무영속 PASS · rollback SQL 역전 대칭
- build exit 0 · spec 8/8 PASS
- DA CONSULT = GAP-REPORT 자체가 DA authority (A11 규약 DA 자율)
- 대표게이트 면제 (autonomy §3.1 ADDITIVE-equiv no-DDL data-lane)
- supervisor DDL-diff(0 DDL) QA in-flight (별개 트랙)
