# Foot TEST-DUMMY-CLEANUP — AC-2 §4-B 경량 apply 패키지 (dev-foot)

Ticket: T-20260721-foot-TEST-DUMMY-CLEANUP (AC-2, db_change) · Branch: `db-gate/T-20260721-foot-TEST-DUMMY-CLEANUP-C2-CLEAR`
Trigger: DA 3차 VERIFY CONSULT-REPLY **MSG-20260721-150028-4ug6** — C2 CLEAR CONFIRMED(미귀속=0) → §4-B 경량 apply GREENLIT.
Author: dev-foot · 2026-07-21 KST

---

## 요약
DA §3차 GREENLIT 수신 → §4-B 경량 apply 패키지 조립 + 라이브 READ-ONLY preflight 실행(PASS). off-git 전-컬럼 스냅샷(+status_transitions) 기록 완료. **실 DELETE 미수행** — supervisor DB-GATE(dry-run 무영속) + 형 apply_gate 통과 후에만.

## 산출물
| 파일 | 역할 |
|---|---|
| `scripts/T-20260721-foot-TEST-DUMMY-CLEANUP_freeze.mjs` | PK-fixed freeze SSOT (commit 15c3adfe 계승). 9 cust + 6 ci + 7 st. EXPECT/술어/pre-sweep 상수. |
| `scripts/T-20260721-foot-TEST-DUMMY-CLEANUP_ac2_preflight.mjs` | **READ-ONLY** preflight — 스냅샷 dump + §2-3 guard + 독립 술어 self-test. (실행 완료·PASS) |
| `scripts/T-20260721-foot-TEST-DUMMY-CLEANUP_ac2_apply.mjs` | 트랜잭션 apply 러너. **DRY-RUN(ROLLBACK) 기본 / `--apply`(COMMIT) 게이트.** FK-graph introspection + POSTCHECK 내장. |
| off-git `~/.config/medibuilder-secrets/backfill-snapshots/foot-test-dummy-cleanup-20260721/snapshot_*.json` | 전-컬럼(+PII) 스냅샷 = 롤백 소스. no-snapshot-no-delete 충족. |

## 라이브 READ-ONLY preflight 결과 (2026-07-21T06:55Z, service-role)
- customers freeze 라이브 = **9/9** · check_ins = **6/6** · status_transitions(CASCADE) = **7/7** — freeze(15c3adfe)와 무drift.
- check_ins.customer_id ⊆ freeze customers (외부참조 0).
- 자식 census = **0 전 테이블**: payments·service_charges·package_payments·insurance_claims·form_submissions·medical_charts·reservations = 0. → 순수 stub, §4-B 경량 경로 전제 유지(§1 heavy 미발화).
- 독립 술어 self-test: freeze 전량 DUMMY 접두 매칭(비매칭 0) · 술어 재스캔 집합 = **정확히 9**(= freeze 집합, 잔여 더미 0·실환자 오포함 0) · silent-swallow 가드 통과.
- off-git 전-컬럼 스냅샷(customers 9 / check_ins 6 / status_transitions 7) 기록.

## §4-B 하드 precondition 배선 (apply 러너 내 fail-closed)
1. **① no-snapshot-no-delete** — off-git 스냅샷 존재+카운트(9/6/7) 대조. 없으면 ABORT. *(러너 실행 확인: ✅)*
2. **② 술어 self-test 독립배선** — selection(고정 PK)과 독립으로 이름접두 재판정 + freeze⊆술어집합 + 빈결과 가드.
3. **③ prod pre-sweep** — AC-1/AC-3 (commit `453e8475`) origin/main ancestor 확인. *(러너 실행 확인: ✅)*
4. **④ §2-3 재검증 + FK-graph introspection** — pg_constraint 로 customers/check_ins 참조 전 자식 열거 → freeze-scope 카운트 == {status_transitions:7, 그외:0}. 미지 자식>0 시 ABORT(§1 heavy 회부).
5. **⑤ 단일 TX** — DRY-RUN=ROLLBACK / APPLY=COMMIT. 자식→부모 explicit 순서 DELETE.
6. **⑥ POSTCHECK (DA §3차 하드)** — 순소실 == **정확히 9 customers + 6 check_ins + 7 status_transitions**(PK-fixed, 증거표 ✅카운트 아님) · prefix 잔존 0 · 실환자 collateral 0(total 감소 == 9). DRY-RUN 은 ROLLBACK 후 무영속 post-probe(9/6/7 잔존)까지 확인.

## 잔여 게이트 (dev-foot 미수행 — 순서 고정)
1. **supervisor DB-GATE** — prod DB 크리덴셜로 `ac2_apply.mjs`(무인자=DRY-RUN) 실행 → 무영속 evidence + MIG-GATE 4필드.
   - ⚠ 본 세션에 prod foot DB password(`SUPABASE_DB_PASSWORD`) 부재 → dev-foot 는 트랜잭션 pg-direct dry-run 미실행. READ-ONLY preflight 로 선택 무결성은 라이브 확증. 트랜잭션 trial-DELETE+ROLLBACK 은 크리덴셜 보유하는 supervisor DB-GATE 에서 실행.
2. **형 apply_gate** → `ac2_apply.mjs --apply` (COMMIT). 그 후 POSTCHECK evidence 기입 + `applied_at`.
3. 현장 회신은 AC-1/AC-3(INFRA) 통합 1회 공지(planner/responder 경유).

**DELETE 는 위 2게이트 통과 후에만. 본 커밋 시점 prod 무변경.**
