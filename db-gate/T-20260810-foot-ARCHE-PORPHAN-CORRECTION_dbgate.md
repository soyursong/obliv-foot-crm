# T-20260810-foot-ARCHE-PORPHAN-CORRECTION — supervisor DB-GATE evidence

- **gate**: DB-GATE (prod data-correction · mjs runner lane · DDL 0 · db_change=false)
- **prod ref**: rxlomoozakkjesdqjtvd (obliv-foot-crm)
- **verdict**: **GO → APPLIED → VERIFIED (Green)**
- **supervisor apply**: 2026-08-10 02:43 KST (17:43Z) · runner `scripts/T-20260810-foot-ARCHE-PORPHAN-CORRECTION_apply.mjs --apply --i-have-go-token`

## 게이트 체인 (선행 전건 satisfied)
| # | 게이트 | 상태 |
|---|---|---|
| 1 | DA CONSULT-REPLY (MSG-20260810-015024-v8dg · 조건부 GO) | ✅ (signals L85 corroborated) |
| 2 | dev-foot BLOCKING census (Q-A/Q-B/Q-C) | ✅ Leg-A 단독·A28/amb0/absent34 |
| 3 | DA §Q5 forward-seal FORENSIC = **H1(seal)** | ✅ commit edc447d5 |
| 4 | planner spec 확정 → approved (02:27) | ✅ |
| 5 | dev-foot apply-prep (script+dry-run+freeze+snapshot) | ✅ commit f1215b6e |
| 6 | **supervisor DB-GATE (본 evidence)** | ✅ GO-token + apply + POSTCHECK + 독립 POST-VERIFY |

## deploy-precheck (관련 C-check)
- **C0** fresh (직전 NO-GO 부재) · **C2** db_only exempt VALID (deploy commit f1215b6e = `scripts/`+`evidence/` only, `src/` diff 0)
- **C3** rollback 동봉 (before-image 기반 `package_session_id→NULL`)
- **C11/C12** N/A — DDL 0, data UPDATE만 (참조 컬럼 `package_session_id` 실재·healthy 49 기사용)
- **C18/C21** CLEAN — GO 직전 fresh 재확인: 대상 DA HOLD/RETRACT/bounce 0 (signals+supervisor MQ), 티켓 frontmatter status=deploy-ready·block_reason 0·deploy_hold 부재
- **C20** PASS — GO-token 독립 crypto audit (아래)
- **C28** N/A — carrier=check_in_services FK backlink, staff role/active/owner_tag 무접촉
- **C29** N/A — 서빙 웹번들 배포세트 아님 (db_only)

## GO-token (C20 독립 재검증)
- 파일: `db-gate/T-20260810-foot-ARCHE-PORPHAN-CORRECTION_GO.token.json` (+ `.sig`)
- key_id `supv-dbgate-2026a` · nonce `a2980e4f16baada3`
- issued `2026-08-09T17:42:31.941Z` → expires `18:27:31.941Z` (TTL 45m)
- content-binding `migration_sha256 = 02554b3168bd07062a9ff38241223194649b1c0190942801b1529f23ed4753fe` (= 러너 스크립트 raw bytes sha256, mjs-runner lane)
- ① ed25519 sig verify (committed pubkey) = **true**
- ② binding: ticket_id / gate=DB-GATE-GO / issued_by=supervisor / prod_ref / migration_sha256==runner-live-sha256 = **전건 일치**
- ③ timing: apply_ts(~17:43Z) ∈ [issued, expires] = **true** (apply_before_go 아님)

## apply 결과 + POSTCHECK (러너 내장)
```
[freeze-recheck] live 62 == frozen 62 · novel 0 · vanished 0
[partition]      A_resolvable 28 · B_ambiguous 0 · B_absent 34 · total 62
[APPLY]          rows affected = 28 (기대 28)
[POSTCHECK] ✓ rows==A ✓ P-orphan 34==34 ✓ healthy 77==77 ✓ flag_true 111 불변 ✓ Σprice 불변 ✓ Σorigprice 불변
```

## 독립 read-only POST-VERIFY (supervisor · Mgmt API elevated authctx · 러너 self-check 불신뢰)
- invariant: `{porphan:34, healthy:77, flag_true:111, sump:27,950,000, sumo:34,200,000}` — 전건 기대치 일치
- **double-claim ps = 0** (28 pick_ps_id distinct, 어떤 package_session도 복수 cis에 결선 안 됨)
- **B-absent 34 무접촉** — 전건 여전히 `package_session_id IS NULL` (현장확정 void 라우팅·본 apply 미포함)
- **A-28 결선 완료** — 전건 `package_session_id IS NOT NULL`
- 매출축 무접촉 확정 (FK-only write · price/original_price/payments/paid_amount/credit_ledger 무접촉)

## AF-2 per-row 확인 (census/planner flag 해소)
- `89443cb7…` / `ae8fcdb3…` (service_name `비가열레이저 - AF` → session_type `unheated_laser`)
- 둘 다 **동일 check_in_id + 동일 customer** 상 유일(unclaimed) `status='used'` package_session 으로 결선 → 물리 방문 anchor + 고객 + 유일성이 매핑 근거 약함을 구조적으로 보강.
- 매핑 오류 시 downside = **non-match(B_absent)** 이지 mis-link 아님 + 완전 reversible → auto-link 허용 판단.

## 잔여/후속 (비-blocking)
- **B-absent 34**: 재-결선 대상 아님(매칭 package_session 부재). 다수 테스트/더미고객 void 후보(김민경 17·박민석 3 등) → planner confirm-gate 라우팅 대기(본 apply 미포함). **auto void 금지.**
- **FINDING-1** (citation-gap): DA SSOT doc `agents/docs/da_replies/da_decision_foot_arche_porphan_correction_spec_20260810.md` 파일 미작성 — script/prep/ticket 인용하나 disk 부재. 판정 자체는 MQ MSG-20260810-015024-v8dg + signals L85 + ticket changelog 3중 실재. → DA 백필 통지.
- **FINDING-2** (runner 정렬): 러너가 canonical `scripts/apply_gate_lib.mjs` `assertApplyGateForRunner()`(ed25519 verify+binding+TTL) 대신 inline `existsSync` 게이트 사용. 본건은 supervisor 집행 + signed token + lease guard + C20 독립검증으로 backstop. → dev-foot 향후 correction 러너 정렬 권고.
