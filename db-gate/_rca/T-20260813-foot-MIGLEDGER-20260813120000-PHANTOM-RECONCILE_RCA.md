# RCA — T-20260813-foot-MIGLEDGER-20260813120000-PHANTOM-RECONCILE

- **Stage**: 1단계 RCA (READ-ONLY · prod write 0)
- **Author**: dev-foot · 2026-08-13
- **Source escalation**: supervisor MSG-20260813-172952-d1ob (via planner MSG-20260813-174305-fquv)
- **Method**: Supabase Management API `/database/query` READ-ONLY introspection (SELECT / pg_get_viewdef / catalog only). No DML/DDL. Raw log: `T-20260813-foot-MIGLEDGER-20260813120000-PHANTOM-RECONCILE_rca_readonly.log`
- **정본 = prod 실재** (blind-repair 금지)

## 결론 (한 줄)

**이것은 "삭제해야 할 phantom-row"가 아니라 NUMBERING COLLISION 이다.** prod `schema_migrations` 의 `20260813120000` 행은 **부모 TESTDATA stats 마이그가 아니라, 별건 supervisor 마이그 `foot_closing_enqueue_inv1_splitsign_guard_decouple` 의 정당 등재**이며 prod 에 **실제 적용돼 있다**. 같은 14자리 version(`20260813120000`)을 두 마이그가 공유해서, 부모 stats 마이그가 이 행에 가려진(shadowed) 상태다.

→ ★**티켓 기본 분기 "(정정) 원장 row 삭제"는 UNSAFE — 절대 실행 금지.** 삭제하면 정당 적용된 closing_enqueue 마이그가 역-orphan(prod 적용됨·원장 부재) = 새 divergence 제조.

---

## 1. 원장 row 실측 [RCA 1]

`supabase_migrations.schema_migrations` WHERE version='20260813120000':

| 컬럼 | 값 |
|------|----|
| version | `20260813120000` |
| **name** | **`foot_closing_enqueue_inv1_splitsign_guard_decouple`** |
| created_by | `supervisor-INV1-SPLITSIGN-DECOUPLE` |
| statements | 빈 배열 (reconcile-백필 표준 `'{}'`) |
| 중복 version 스캔 | **0건** (`ON CONFLICT (version) DO NOTHING` → 단일행) |

→ 이 행의 출처 = 별건 티켓 **T-20260813-foot-CLOSING-HERALD-INV1-SPLITSIGN-GUARD-DECOUPLE** (supervisor apply script `scripts/apply_20260813120000_foot_closing_enqueue_inv1_splitsign_guard_decouple_PROD_SUPERVISOR_T-20260813.mjs`, `VERSION='20260813120000'`). **부모 `foot_stats_visits_istest_filter` 출처 아님.**

**collision 확정**: 두 마이그가 같은 version 을 사용 —
- (A) `20260813120000_foot_closing_enqueue_inv1_splitsign_guard_decouple.sql` — supervisor, **APPLIED** (원장 등재)
- (B) `20260813120000_foot_stats_visits_istest_filter.sql` — 부모 T-20260812, **HELD·미적용** (commit fcb42ee3 에 파일 존재, 현 worktree 는 branch-race 로 부재)

## 2. prod 실재 재확인 (supervisor 발견 재현) [RCA 2]

| 축 | 실측 | is_test 필터 |
|----|------|:----:|
| view-leg `v_daily_visits` | pg_get_viewdef: `check_ins` 단독, customers join 없음 | **부재 ✗** |
| view-leg `v_daily_visit_rate` | reservations+check_ins CTE, customers join 없음 | **부재 ✗** |
| data-leg `customers.is_test=true` | **5건** (기대 ~215 아님) · pre-0713 total=218 · is_test_null=0 | **백필 미적용 ✗** |

→ 부모 stats 마이그(뷰 is_test 필터 + 215 백필) **view-leg·data-leg 둘 다 prod 실 부재 CONFIRM**. 부모 held(applied_at="", GO-token 미발행)와 **정합** — 부모는 실제로 한 번도 적용된 적 없음.

## 3. 부분적용(partial-DDL)·orphan 확인 [RCA 3]

- audit 테이블 `backfill_audit_20260812_istest` : **부재 (0건)**
- 부분 생성 object / 롤백 흔적 : **없음**

→ 부모 마이그는 prod 에 **물리 흔적 zero**. partial-apply 아님. **orphan 정리 leg 불요** → forward-doc 분기 해당 없음.

## 4. Provenance forensics [RCA 4]

- `20260813120000` 등재 경로 = closing_enqueue 마이그의 정당 supervisor DB-GATE apply (`created_by=supervisor-INV1-SPLITSIGN-DECOUPLE`).
- **적용 실재 교차검증**: `enqueue_closing_confirmed()` prosrc 에 `INV1-SPLITSIGN-DECOUPLE` 마커 **有** + `v_split_sign_ok` **有** → closing_enqueue 마이그는 **진짜 적용됨**. 원장행은 정당·정확.
- **tooling 우회 아님**: apply-runner chokepoint 는 closing_enqueue 에 대해 정상 동작. GO-token 정상.
- **skip 메커니즘 = collision**: `recordLedger` 의 `ON CONFLICT (version) DO NOTHING` 이 부모 stats 마이그를 조용히 삼킬 스위치. 부모가 추후 apply 되면 (a) 원장 기록이 no-op 되거나 (b) apply-runner "이미 원장에 있음 → skip" 게이트가 부모 **DDL 자체를 skip** → 부모 is_test 필터·백필이 영구 미반영.
- **false-negative 근원**: 부모(mig_ledger_check "충돌 0")·자식(mig_ledger_check "collision 쿼리 빈결과") **둘 다** collision pre-check 를 통과했다 — 각 체크가 **sibling closing_enqueue 마이그 등재 前** 시점에, **원장 + 자기 pending 파일**만 스캔하고 **같은 timestamp 를 쓰는 형제 티켓의 pending 마이그 파일은 미스캔**했기 때문. 타이밍 false-negative.

### ★ tooling 하드닝 cross-ref (별건 — 본 티켓 아님)
apply-time 에 **cross-ticket pending 마이그 파일 간 version 유일성 가드** 부재. authoring-time collision check 만으로는 형제 티켓 동시 timestamp 충돌을 못 잡음. → supervisor/meta 승격 후보. 본 티켓은 foot 원장 정합에 집중, 결함은 cross-ref 로만 표기.

---

## Stage 2 권고 (supervisor DB-GATE 소관 · dev-foot prod write 금지)

3분기 중 **(재수렴 + renumber)** 착지:

1. **`20260813120000` 원장행 KEEP** — closing_enqueue 의 정당·정확한 등재. prod schema_migrations **DELETE/UPDATE 불요** (이 행에 대한 write 0).
2. **부모 stats 마이그 파일 renumber** — held 상태의 부모 `20260813120000_foot_stats_visits_istest_filter.{sql,rollback.sql}` 를 비충돌 version 으로 재넘버(권고: `20260813130000` — `20260812234000` 뒤, 자식 `20260813150000` 앞 → 부모→자식 apply 순서 보존). **repo authoring 변경(prod write 아님)**, 단 부모가 supervisor freeze(canonical=commit fcb42ee3)·human_pending 이므로 **실 renumber 실행은 Stage 2 에서 planner/supervisor 와 조율**해 수행.
3. **자식 `20260813150000`** — 원장 미충돌(유일). 부모 renumber 후 stack-order 보존 → 자식 apply-stack hazard 해소.

**(정정)=원장행 삭제 분기 = REJECT** (역-orphan 제조). **(forward-doc)=orphan 정리 분기 = N/A** (partial-DDL zero).

---

## 순서 (불변)
①원장 정합(본건: KEEP row + 부모 renumber) → ②부모 218-blanket 승인 → ③부모 clean apply → ④자식 apply.
