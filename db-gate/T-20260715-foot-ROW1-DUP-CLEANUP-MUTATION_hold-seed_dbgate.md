# T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION — ROW1 hold-seed DB-GATE 인계 evidence

- 수행: dev-foot / 2026-07-24. **ADDITIVE** — hold-registry 에 ROW1 active-hold row 1건 INSERT (ROW1 실데이터 unmutated).
- 트리거: planner NEW-TASK **MSG-20260724-073838-7z2g** (P2). 부모 티켓 blocked/human_pending 유지.
- 전제(supervisor NOTIFY MSG-20260724-073403-in6a): hold-guard 구조는 prod LIVE(deployed@07:33, commit 08c8e377)
  이나 **registry_rows=0 → ROW1 fail-closed 보호 미발효**. 본 seed 로 registry_rows≥1 시 실효 보호 발효.
- 순서 게이트(엄수): **seed → registry_rows≥1 확인 → ROW1 DUP-CLEANUP 파괴 apply**. seed 미완 시 파괴 apply 착수 금지.
  본 seed 는 파괴 apply 와 **별개 저위험 ADDITIVE**(무보호창 최소화 목적 우선 착수).

---

## 산출 파일 (이번 태스크)
| 파일 | 역할 |
|---|---|
| `supabase/migrations/20260724120000_foot_data_correction_hold_registry_guard.seed.sql` | **ROW1-concrete seed** (주입식 템플릿 + FREEZE-상수 정합 가드 §A). ← supervisor 가 실 UUID 주입해 apply |
| `supabase/migrations/20260724120000_foot_data_correction_hold_registry_guard.seed.dryrun.sql` | 무영속 seed dry-run (registry_rows≥1 재현 + 회귀행렬 probe+3종, 단일 DO 블록·RAISE unwind) |
| `scripts/T-20260715-foot-ROW1-HOLD-SEED_dryrun.mjs` | dry-run 러너 (Management API·PRE/POST-PROBE) |

## ROW1 재baseline FREEZE 상수 (PK-VALUES 고정 · git-safe PK8)
> SSOT: `db-gate/T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL_freeze_evidence.md`
> + `scripts/T-20260715-foot-ROW1-DUP-CLEANUP_recharacterize_forensics6_ver1recovery.mjs`

| 역할 | id PK8 | clinic PK8 | tail | 상태 |
|---|---|---|---|---|
| ROW1 (hold 대상 = freeze target) | `0356b229` | `74967aea` | ver=1 `9089` | 07-18 OOB drift → 현재 phone=DUMMY-… |
| RAW (**keep** = 정정 후 존치 정본) | `c51dd5e0` | `74967aea` | live `9089` | 정본 유지 |

- **hold 사유 = ROW1 DUP-CLEANUP freeze** (`reason='cleanup'`, `guard_scope='phone_dummy_normalize'`, `hold_ticket='T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION'`).
- **keep=RAW 맥락**: DUP-CLEANUP 결착에서 정본 존치행은 RAW(c51dd5e0, live 9089). ROW1 은 ver=1(9089) 복구 후 freeze.
  본 hold 는 복구·결착 window 동안 ROW1 이 재차 phone→DUMMY 정규화되는 것을 fail-closed 차단.

## seed.sql 식별 앵커 정합 (§A · false-freeze/오대상 등록 방지)
| # | 가드 | 판정 |
|---|---|---|
| A0 | :row1_id/:clinic_id 미주입·placeholder 차단 | ✅ RAISE |
| A1 | 주입 row1 PK8 == `0356b229` (FREEZE 상수) | ✅ 불일치 시 RAISE (오대상 차단) |
| A2 | 주입 clinic PK8 == `74967aea` (FREEZE 상수) | ✅ 불일치 시 RAISE |
| A3 | 주입 row 가 해당 clinic 에 실재 | ✅ dangling target 차단 |
| A4 | 동일 clinic tail-9089 정본(keep=RAW) sibling 실재 | ⚠ soft(부재 시 WARNING·등록 계속) |
| §B | 멱등 INSERT (`ON CONFLICT … WHERE released_at IS NULL DO NOTHING`) | ✅ 재실행 안전 |

## dry-run evidence (mig_dryrun · 무영속)
`node scripts/T-20260715-foot-ROW1-HOLD-SEED_dryrun.mjs` (2026-07-24, prod rxlomoozakkjesdqjtvd, 무영속):
```
PRE-PROBE (가드 LIVE 전제): [{"guard_trigger_live":1,"registry_table_live":true,"registry_active_before":0}]
SEED-DRYRUN RESULT: probe(registry_active=1, held_hold=1, expect≥1/=1)=PASS✓ case1(HELD→DUMMY expect BLOCK)=BLOCK✓ case2(FREE→DUMMY expect PASS)=PASS✓ case3(HELD staff real-phone expect PASS)=PASS✓ verdict=ALL PASS (registry_rows≥1 재현 + 회귀 0)
POST-PROBE (무영속 재확인): [{"registry_active_after":0,"row1_hold_persisted":0,"fixture_rows_persisted":0}]
```
- **registry_rows≥1 재현**: seed INSERT 후 `registry_active=1` (probe PASS). PRE=0 → seed 로 보호 발효 전제 충족 실증.
- **정상 corrective 회귀 0**: case2(FREE→DUMMY)·case3(HELD staff real-phone) PASS = 가드 apply 6/6 dry-run 결과와 정합.
- **의도된 보호**: case1(HELD→DUMMY) BLOCK = ROW1 fail-closed 보호 실효.
- **무영속 unwind 실증**: POST-PROBE active_after=0(원복)·row1_hold_persisted=0·fixture_rows_persisted=0. 단일 DO 블록 RAISE unwind, txn-control 내장 없음(sentinel-bypass 미해당).
- seed.sql 자체 compile+freeze-binding 검증(별도): A1/A2 통과→A3 dangling 차단(비실재 UUID, INSERT 미도달) / 오대상 PK8(deadbeef) A1 차단 = 무영속 확인.

---

## ▶ supervisor DB-GATE 실행 안내 (prod seed apply — deploy 권한)
> **범위**: 본 seed row 1건 INSERT (ADDITIVE). ROW1 파괴 apply 본체는 별도(CEO 재승인 + per-row GUC confirm 이중 게이트, 이 인계 범위 아님).

1. **실 UUID 주입**(supervisor/GUC 창): ROW1 실 UUID 전문 = FREEZE PK8 `0356b229…`, clinic 전문 = `74967aea…`.
   git 에는 PK8 만 공개 — 실 UUID 는 `db-gate/…_freeze_evidence.md`/forensics 러너 상수(`0356b229-e8c7-4655-aa6e-651b15370c1f`, clinic 조회) 참조.
   - psql: `psql "$PROD" -v row1_id='<ROW1 UUID>' -v clinic_id='<clinic UUID>' -f …_guard.seed.sql`
   - Management API: `:'row1_id'`/`:'clinic_id'` 수동 치환 후 `/database/query`.
2. **apply 후 registry_rows≥1 검증 쿼리** (evidence 캡처):
```sql
SELECT id, clinic_id, target_table, target_pk, guard_scope, hold_ticket, reason, released_at
  FROM public.data_correction_hold_registry
 WHERE hold_ticket='T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION' AND released_at IS NULL;
-- 기대: 1행 (target_pk=ROW1 UUID, guard_scope=phone_dummy_normalize, reason=cleanup)
SELECT count(*) AS registry_active FROM public.data_correction_hold_registry WHERE released_at IS NULL; -- ≥1
```
3. **멱등**: 재실행 시 `ON CONFLICT DO NOTHING` → 중복 active hold 미생성.
4. **롤백(필요 시)**: `UPDATE public.data_correction_hold_registry SET released_at=now(), released_by='…', release_reason='…' WHERE hold_ticket='T-20260715-…' AND released_at IS NULL;` (hard-DELETE 아닌 released 처리 — 해제 이력 누적).
5. **registry_rows≥1 evidence 수신 시** → planner 가 ROW1 DUP-CLEANUP 파괴 apply 선행조건 충족 마킹.

## 판단 note (supervisor 재량)
- `reason` 을 `'cleanup'`(DUP-CLEANUP freeze, planner 지시 정합)으로 설정. 가드는 `guard_scope`/`released_at` 만 조회 → `reason` 값은 가드 로직 무관(감사 표기용). `'forensics'` 선호 시 apply 시점 치환 가능.
