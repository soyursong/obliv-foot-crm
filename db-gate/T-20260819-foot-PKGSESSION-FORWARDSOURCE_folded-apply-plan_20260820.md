# T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE — 328 folded APPLY 계획 (2026-08-20)

- **task**: planner NEW-TASK `MSG-20260820-024504-8p5n` (DA delta-note 전건 BLESS 착지 · fold-(i) APPROVED)
- **from**: dev-foot · **write0 · APPLY 미착수 · deploy-ready 미마킹** (GO-token 前)
- **정본**: `da_decision_foot_pkgsession_backfill_316_applyset_reapprove_20260819.md` **ADDENDUM #1**
- **DA BLESS**: `MSG-20260820-023932-2vf5` — 328 count-exact BLESS · ∩0 disjoint CONFIRM · prev-image parity CONFIRM · P-floor co-set CONFIRM
- **prod**: rxlomoozakkjesdqjtvd

---

## 0. 현재 ball · 착수 조건 (불변)

- **현재 ball ≠ dev-foot.** 선행 게이트 (a)(b)(c)(d) 진행 중. 본 산출 = **계획 확정 + apply-instant census 로직 준비**(write0).
- **GO-token 발행 접수 시 planner 가 APPLY sequencing 활성 relay → 그때 dev-foot APPLY 착수.** 그 전까지 **write0 · 미착수**.
- ★**AC-1 (fold ≠ GO-token 면제)**: '3.8% immaterial'/'fold'/'db_change=false[DA]' 는 **328 단일 apply 의 1차 supervisor DB-GATE + 물리 GO-token 선행 chokepoint 를 면제하지 않음**. apply-gate 주체 = **supervisor**(DA 아님·DA no-apply). Gate-B(DA) BLESS ≠ apply 허가.
- ★**apply_before_go 금지**: GO-token 前 prod DDL/UPDATE 선집행 금지. GO-token 前 APPLY/deploy-ready 미마킹 유지.

## 1. fold 결정 요약 (planner fold-(i) APPROVED)

- **328 단일 folded APPLY** = 부모 316 backfill APPLY 에 interval-delta 12행을 fold. **316 별도 + delta 별도 2사이클 금지.**
- **328 = 42→316 과 동일 C6 방법론(min-sum 술어)의 post-source-closure 재-instantiation** (신규 adjudication 아님·coherence-extension). backfill.sql **문자동일**(per-row CASE 불변·auto-widen 0·억지채움 0).
- source-closure(web_fe landing 2026-08-20 01:56 · 5경로 물리 소스폐쇄) 로 forward-generation 정지 → matched **stable at 328**. delta 12 = landing 이전 생성 bounded 집합(정지확증 TRUE).

## 2. 실 APPLY SQL (fold = 부모 backfill.sql 재사용 · 신규 파일 아님)

- **APPLY 대상 SQL** = `supabase/migrations/20260724130000_foot_pkgsession_link_backfill.backfill.sql` (부모 T-20260724, origin/main 존재).
  - source-closure 후 **live 실행 시 자연히 328 count-exact** — 별도 프리즈 328 리스트 불요(fold-(i) 근거 (c): backfill.sql live CTE 를 landing 후 실행하면 자연히 328).
  - §6 4대 가드 불변: ①status='used' ②prepaidSessionType SSOT(코드 우선·비가열 먼저·체험 제외) ③type별 FIFO rn=rn·package_session_id IS NULL 멱등 ④flag∧FK **함께 SET**(co-set).
  - DDL 0 (data-lane UPDATE). schema_migrations 원장 무관.
- **rollback** = `20260724130000_foot_pkgsession_link_backfill.folded328.rollback.sql` (본 티켓 신규 · full-328 pre-image 정확복원). apply-instant 재캡처 pre-image 로만 채워짐(gen_rollback_328.mjs).

## 3. apply-instant census (GO-token 후 · APPLY 직전 live 재실행 · write0)

**스크립트**: `scripts/T-20260819-foot-PKGSESSION-FORWARDSOURCE_apply_instant_census_328.mjs`
DA gate order 2단계 요건 4항 (전부 GREEN 이어야 supervisor DB-GATE→GO-token→APPLY):

| # | census | 통과 기준 |
|---|--------|-----------|
| ① | **count-exact** | backfill.sql live CTE `matched` == **328** 정확일치 ∧ `matched == C6 min-sum`(억지채움 아님) ∧ auto-widen 0 |
| ② | **∩=0 disjoint** | 프리즈316 ∩ 현 = **316**(non-re-clobber, Q2조건①) · 프리즈316 이탈 0 · `distinct_target_ps == 328`(collision 0) · delta target ∩ 316 target = **0** · already-linked(이미 CIS 링크된 세션) = **0**(phantom already_paid 0) |
| ③ | **G-B full 328 live pre-image** | apply 직전 live 재캡처 = **328 전건**(★delta-note 12행 merge 로 대체 금지). 2컬럼(package_session_id/is_package_session) + prev_flag/prev_psid. 전건 prev_psid=NULL ∧ prev_flag=false |
| ④ | **P-floor co-set** | 대상 328 전건 co-set 대상(flag=false∧FK-null) · orphan(flag=true∩FK-null) baseline 박제(POST-VERIFY 무증가 대조). apply co-set = backfill.sql 가드④ 구조보장 |

- census 는 `_apply-instant-census-328_result.json`(결과) + `_gb-preimage-full328.json`(rollback 소스 full-328 pre-image) 2파일 박제.
- ★census PASS ≠ APPLY 허가. supervisor 물리 GO-token(db_apply_guard.sh lane) 선행 필수.

## 4. 게이트 순서 (ADDENDUM #1 §게이트순서 · 물리 chokepoint 선행)

1. **DA delta-note** (ADDENDUM #1) → 4항 BLESS ✅ (MSG-20260820-023932-2vf5)
2. **선행 게이트 (a)(b)(c)(d)** — 현재 진행 중(ball ≠ dev-foot):
   - (a) FM3 총괄(김주연) **328-scoped 재확인**(₩74.63M/316 → ₩77.45M/328) — responder relay in-flight. 총괄 확인 前 APPLY 금지.
   - (b) dev-sales KC dict `_FOOT_PKG_BACKFILL_KC_INCL` **316→328 resync** 배포(REVENUE_DELTA HIGH 오경보 차단, pre-APPLY)
   - (c) supervisor DB-GATE dryrun 무영속→DATA-diff→**물리 GO-token**
   - (d) supervisor codex 실SQL re-crosscheck (C19 deduct_session_atomic/consume_ 계약자산 body-drift + §15-5-10 caller-tier + A12 md5 re-seal)
3. **dev-foot apply-instant census** (본 §3 · GO-token 후 APPLY 직전 live 재현 · write0) — 4항 GREEN
4. **G-C-2 갱신** — A6 known-correction ₩77.45M 등재(DA 자기소관) + dev-sales/FM3 통지(328) + 원장 무접점(12 delta 포함) 실측
5. **dev-foot 328 folded APPLY** — `backfill.sql` (문자동일·328 count-exact) 을 `db_apply_guard.sh` chokepoint(GO-token ed25519+sha256+TTL verify · 격리 pinned worktree)로 집행. **write0/DDL0 until GO-token.**
6. **POST-VERIFY** (본 §5) — 7항 GREEN → applied_at 기입 + bus deploy_exec_done emit

## 5. POST-VERIFY (APPLY 후 · write0)

**스크립트**: `scripts/T-20260819-foot-PKGSESSION-FORWARDSOURCE_post_verify_328.mjs`

| # | POST-VERIFY | 기준 |
|---|-------------|------|
| ① | 328 flag=true & FK-set | apply 대상 328 전건 is_package_session=true ∧ package_session_id NOT NULL |
| ② | double-link 0 | 한 세션에 2+ CIS 링크 = 0 |
| ③ | gap 무변 | used = matched + gap 잔차(구조적 unmatched · 무재분류) |
| ④ | 환불행 무접점 | 비-used(환불/취소/삭제) 회차 링크 = 0 (가드①) |
| ⑤ | A6 ₩77.45M 정합 | flip 총액(328 price 합) = ₩77,450,000 (false HIGH 미발화) |
| ⑥ | 프리즈316 무손상 | 프리즈316 전건 apply 대상 포함·flip 완료(무이탈) |
| ⑦ | 원장 무변 · orphan 무증가 | payments/closing_manual 무접점 · orphan(flag=true∩FK-null) census baseline 대비 무증가 |

## 6. 재-CONSULT HARD REJECT (ADDENDUM #1 HA1~HA3 승계)

- **HA1** 328 을 신규 adjudication/magnitude 재litigation 오독 · backfill.sql 술어 widen 하여 328 도달 · disjoint census 없이 blind fold.
- **HA2** G-B 롤백을 delta-note 12행 merge 로 대체(apply 직전 live 재캡처 = 328 전건 불변) · prev-image parity apply-instant 재현 없이 blind · Q2조건①(프리즈316 ∩ 현=316) 무시 blind fold.
- **HA3** 'fold'/'immaterial'/'db_change=false[DA]' 를 supervisor DB-GATE/물리 GO-token 면제로 오독 · flip 총액 ₩74.63M 착지(₩77.45M=328 필수) · 12 delta 원장 무접점 재확인 누락 · DA 에 apply/census 요구.

---

## 산출물 (본 커밋 · write0 prep)
- `db-gate/…_folded-apply-plan_20260820.md` (본 문서)
- `scripts/…_apply_instant_census_328.mjs` (apply-instant census 4항 · full-328 pre-image 박제)
- `scripts/…_gen_rollback_328.mjs` (pre-image → rollback VALUES 생성기)
- `scripts/…_post_verify_328.mjs` (POST-VERIFY 7항)
- `supabase/migrations/20260724130000_foot_pkgsession_link_backfill.folded328.rollback.sql` (full-328 pre-image 정확복원 템플릿)

## 착수 대기 (write0)
GO-token 발행 접수 + planner APPLY-sequencing 활성 relay 시점에 §3 census(live 재현) → §5 APPLY → §5 POST-VERIFY 순으로 집행. **그 전까지 prod write 0 · deploy-ready 미마킹.**
