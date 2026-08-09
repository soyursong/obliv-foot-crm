# T-20260810-foot-ARCHE-PORPHAN-CORRECTION — dev-foot apply-prep (correction script + dry-run)

- **ticket**: T-20260810-foot-ARCHE-PORPHAN-CORRECTION
- **owner**: agent-fdd-ops-planner · **assignee**: agent-fdd-dev-foot
- **prod ref**: rxlomoozakkjesdqjtvd (obliv-foot-crm)
- **DA SSOT**: `agents/docs/da_replies/da_decision_foot_arche_porphan_correction_spec_20260810.md` (verdict=조건부 GO · db_change=false)
- **artifact-class**: `db_only` (정정=INSERT-of-FK 재-결선 · DDL 0 · 매출축 무접촉 · e2e_spec_exempt=db_only)
- **mode**: 본 산출 = **apply-prep (script + DRY-RUN no-persistence)**. ★prod apply 미실행 — supervisor DB-GATE GO-token 후 supervisor 실행.
- **run date**: 2026-08-10

## 게이트 상태 (착수 前 필수 — 전건 satisfied)
| # | 게이트 | 상태 |
|---|---|---|
| 1 | DA CONSULT-REPLY (MSG-20260810-015024-v8dg) | ✅ verdict=조건부 GO (Leg-A 단독) |
| 2 | dev-foot BLOCKING census (Q-A/Q-B/Q-C) | ✅ `evidence/..._census_result.md` |
| 3 | DA §Q5 forward-seal FORENSIC | ✅ **H1 (seal)** — `evidence/..._forensic_seal_result.md` (commit edc447d5) |
| 4 | planner spec 확정 → status approved | ✅ ticket status=approved (Leg-A / A-28 auto / B-absent per-row / B-amb 0) |
| 5 | **dev-foot apply-prep** (본 산출) | ✅ 스크립트 + dry-run + freeze 재검증 + 판정근거 스냅샷 |
| 6 | supervisor DB-GATE (DDL-diff + dry-run 재검증 + GO-token + POSTCHECK) | ⏳ **대기** (prod apply 는 이 단계) |

## 산출물
- **correction 스크립트**: `scripts/T-20260810-foot-ARCHE-PORPHAN-CORRECTION_apply.mjs`
  - `--dry-run`(default): SELECT-only. no-persistence **by construction**(UPDATE 미발행). freeze 재검증 → plan → 스냅샷 → counterfactual POSTCHECK.
  - `--apply`: A-resolvable fill-on-NULL UPDATE. **HARD-GATED** — `db-gate/{TICKET}_GO.token.json`(+`.sig`) 실재 AND `--i-have-go-token` 없으면 REFUSE. per-row 가드 · 매출축 무접촉 · B-absent 무접촉 · apply 직전 freeze 재검증(신규 orphan → abort).
- **판정근거 스냅샷**: `evidence/T-20260810-foot-ARCHE-PORPHAN-CORRECTION_apply_snapshot.json`
  - `leg_a_plan`(28 · cis_pk→pick_ps_id · before=null · price/original_price 동봉) · `b_absent_routing`(34 · NO-AUTO-LINK) · `af_caveat_rows`(2) · `invariant_before/expected_after` · `rollback_sql`(before-image 기반 reversibility).

## DRY-RUN 결과 (2026-08-10 · prod write 0)
```
[freeze-recheck] live P-orphan=62 · frozen=62 · novel(freeze밖 신규)=0 · vanished=0
[partition]      A_resolvable=28 · B_ambiguous=0 · B_absent=34 · total=62   (census 일치)
[invariant before] P-orphan=62 healthy=49 flag_true=111 Σprice=27,950,000 Σorigprice=34,200,000
[expected after]   P-orphan=34 healthy=77 (Σprice / flag_true 불변)
[AF caveat] 2건 per-row 확인 flag: 89443cb7… , ae8fcdb3…
```
- freeze-set 무변동(novel=0) = Q5 seal(H1) 정합, 신규 유입 없음.
- A-28 target package_session **전건 status='used'** · 미claim · check_in_id 일치 · type 일치 = 유일확정.
- **매출축 불변 by construction**: `package_session_id`(FK) 만 write. `price`/`original_price`/`payments`/`paid_amount`/`credit_ledger` 무접촉 (DA G4).
- ps double-claim 0 (28 pick_ps_id distinct) — healthy 49 overwrite 방지(preserve-on-non-NULL).

## 스코프 경계 (DA/census 확정)
- **Leg-A 단독**: foot = 구매시점 완납/선납(prepaid-at-purchase) → 방문일별 선수금 원장 gap 부재 → Leg-B(선수금 원장) 불요.
- **A-resolvable 28**: exact-anchor 유일확정 → auto fill-on-NULL (본 correction 대상).
- **B-absent 34**: 매칭 package_session 부재(draw-down 행 미생성) → ★재-결선 아님. 현장확정 라우팅(다수 테스트/더미고객 void 후보). **본 스크립트 절대 무접촉.**
- **B-ambiguous 0**.
- **AF-2 caveat**: `비가열레이저 - AF`(2건) session_type 매핑근거 약함 → apply per-row 확인 권고(스냅샷 `af_caveat_rows` flag).

## supervisor DB-GATE 인계 (step 6)
1. DDL-diff: **DDL 0** (데이터 UPDATE만 · db_change=false).
2. dry-run 재검증: `node scripts/T-20260810-foot-ARCHE-PORPHAN-CORRECTION_apply.mjs` (no-persistence) 재현.
3. GO-token 발행 → `db-gate/T-20260810-foot-ARCHE-PORPHAN-CORRECTION_GO.token.json`(+`.sig`).
4. apply: `node scripts/..._apply.mjs --apply --i-have-go-token`.
5. POSTCHECK 불변식(스크립트 내장): rows_affected==28 · P-orphan 62→34 · healthy 49→77 · Σprice/flag_true 불변 · frozen 62 한정. 실패 시 `rollback_sql` 즉시 되돌림.
