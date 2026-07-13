# 재스코프 6→5 재실증 (SPLIT 집행)

- Ticket: T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL
- 근거: planner SPLIT FIX-REQUEST MSG-20260714-020001-7xrp / DA q0fb(MSG-20260714-015408) + uulc addendum(015456) + reconciliation INFO(MSG-20260714-015905-oq42)
- 축 구분(DA INFO): identity-resolution 'ADOPT'(resolvability) ≠ PHI-realness 'CLEAR'(실환자 게이트축). 별개 축.

## 재스코프 내용
- **6→5**: row1(0356b229/c51dd5e0/tail 9089) **제외(HOLD)**. DA q0fb NOT-CLEARABLE(실환자 배제불가).
- **대상 5건 (전건 realness CLEAR = test/DUMMY = 실PHI 0)**:
  | # | phantom8 | raw8 | tail4 | temporal_gap_h | realness |
  |---|----------|------|-------|----------------|----------|
  | 2 | 512998d0 | 8fa12f4c | 5453 | 0.01 | CLEAR |
  | 3 | 67ea1793 | 7ad9e9a4 | 0011 | 3.89 | CLEAR |
  | 4 | bd307dfe | d916d27b | 2200 | 3.90 | CLEAR |
  | 5 | 44a6a076 | d2ba1e9a | 1122 | 268.45 (~11.2d) | CLEAR |
  | 6 | 2dc21d1c | 38e1a858 | 0101 | 4.12 | CLEAR |
- **row5(44a6a076) 포함 판단**: clean-single(tail4+clinic non-masked 후보=**1**, raisedbar_result.json 실증) 충족 + realness CLEAR(test/DUMMY → 오조인 harm이 test 데이터로 한정) → **포함**. G0 tail4 충돌가드가 집행시점 재검증(≥2면 ABORT). ※DA/planner: dev 재량, 안전우선 HOLD도 무방했으나 clean-single 객관 충족 + harm 한정으로 포함.
- **row1 별트랙**: (A)-first 조사 → 결정적 test-account 증거 **없음**(오히려 실환자 신호: 지인소개 유입·phantom 실 RRN·시뮬/더미 플래그 전무). → planner FOLLOWUP → 대표 게이트(human_pending). row1_testaccount_investigation.md 참조.

## delta 재산출 (6건 → 5건)
| 지표 | 6건(舊) | 5건(신) |
|------|---------|---------|
| FK relink(자식 이동) | 27 | **23** |
| check_ins denorm refresh | 7 | **6** |
| phantom 삭제 | 6 | **5** |

## dry-run 재실증 (무영속)
- **mutation dry-run** (`scripts/..._mutation_dryrun.mjs`, BEGIN..ROLLBACK sentinel-RAISE):
  - sentinel 롤백 확인 ✅ · delta {moved:23, denorm:6, deleted:5}
  - post-probe: targeted 5건 잔존=5 ✅ · **row1(0356b229) held 잔존=1 ✅(절대 미삭제)** · _backfill_* 표=0 ✅
  - persistence: **NONE**
- **rollback roundtrip** (`scripts/..._rollback_roundtrip.mjs`, forward→rollback→assert→sentinel):
  - phantom 복원=5/5 ✅ · check_ins phantom 복귀=6(≥5) ✅ · post-probe 잔존=5 ✅
  - rollback_correct: true · persistence: **NONE**

## 마이그 가드 변경 요약
- map 5건. G0 count 체크 6→5.
- **[G0-hold] 신규 가드**: row1(0356b229)이 map 에 유입되면 fail-closed ABORT (held-row 침범 방지).
- tail4 충돌가드(C7)·§2-3-b 불변식(relink→0건검증→archive-first delete)·G-final 잔존0 = 불변.

## 게이트 상태
- (c) per-row PHI 판정 = DA 완료(5 CLEAR / row1 NOT-CLEARABLE). 5건 실PHI 0 → 대표 게이트 불요.
- (d) **supervisor DB-GATE 직행** — 본 재실증 후 QA-REQUEST. DESTRUCTIVE(relink+archive-first delete), C6 post-probe 유지.
- row1 = 별트랙 대표 게이트(planner). apply/deploy-ready = supervisor GO 前 금지.
