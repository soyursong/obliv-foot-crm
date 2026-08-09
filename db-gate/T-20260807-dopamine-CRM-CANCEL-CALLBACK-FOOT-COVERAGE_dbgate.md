# DB-GATE evidence — T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE (precheck 3차)

- **verdict**: **DB-GATE GO** (supervisor MIG-GATE PASS · qa_grade **Yellow**). change-class = **ADDITIVE** (신규 테이블 1 + SECDEF fn 3 + AFTER UPDATE 트리거 1 + drain/alert 2 + cron 1 + §6 grant-seal). 파괴 0 · 기존행 mutation 0 · lifecycle rail 무접촉.
- **DA CONSULT**: MSG-20260807-061709-hpoa (Q1 locus=foot-emit CONFIRMED · payload-contract 3요건 명시 · ADDITIVE §3.1 대표게이트 면제 · 계약자산 편입 NONE).
- **게이트**: supervisor MIG-GATE (CEO 게이트 면제 = §3.1 ADDITIVE + DA GO). C22 N/A.
- **deploy_commit(C24 pin)**: `1e74ec6127eb6251853c1b3eadca1d2adde012fd` (PR#115 head == ticket tip == deploy_ready_commit).
- **⚠ 적용주체**: DB 적용 = **dev-foot 책임**(마이그 직접 실행 규약). supervisor = 사전 승인(본 GO) + 사후 POSTCHECK + env-flip 게이트.
- **⚠ GO-token lane**: foot 는 ed25519 GO-token lane 미배선(body/scalp2 만 wired). foot sanctioned DB-GATE GO = 본 `_dbgate.md` 메모 + supervisor 승인.

## 배포세트 (net-new)
| 파일 | 역할 |
|------|------|
| `supabase/migrations/20260807120000_foot_cancel_sync_outbox_emit.sql` | up (cancel_sync_outbox 테이블 + enqueue 트리거 + drain/alert fn + cron + §6 grant-seal) |
| `..._.dryrun.sql` | No-Persistence(단일 DO EXECUTE → 말미 RAISE EXCEPTION unwind, up.sql COMMIT 미전송) |
| `..._.rollback.sql` | 대칭 역연산 (cron→trigger→fn→table, lifecycle rail 무손상, 순소실0) |
| `supabase/functions/crm-cancel-sync-emit/index.ts` | 신규 EF (payment-twin 미러 · dark 게이트 CANCEL_SYNC_EMIT_ENABLED=false 기본) |
| (union) `..._20260807130000_...PLANA...` | ★이미 origin/main=prod-live, idempotent no-op — net delta 아님 |

## supervisor 검증 매트릭스 (독립 재검증 2026-08-07, precheck 3차 · tip 1e74ec61)
1. **C0 non-stale**: PASS — fresh 재마킹 07:23(qa_result cleared + deploy_ready_at 갱신 + qa_fail_* cleared). deploy_ready_commit=1e74ec61.
2. **C13 ancestry**: PASS — `merge-base --is-ancestor origin/main(38b008e04) 1e74ec61` = **YES**(FF-able). da5c501e(검증 union tip) ⊆ 1e74ec61 직계자식·superset. 0 LOST(PLANA 3d74f4aa·AC-2 54d3478e 보존).
3. **C24 sha-pin**: PASS — deploy_commit 1e74ec61 == PR#115 head(headRefOid) == ticket tip.
4. **C23 grant-seal (static)**: PASS — 신규 SECDEF 3종(enqueue_cancel_sync_from_reservations[trigger]·cancel_sync_drain[jsonb RPC]·alert_cancel_sync_dlq[void RPC]) 전부 per-fn `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role` + COMMENT intended-caller-tier:backend-only(C23-1) + blanket ALTER DEFAULT PRIVILEGES 미사용(C23-4). **C23-2 live anon/authenticated-EXEC=0 = apply-time POSTCHECK**(prod introspection, 아래).
5. **C26 ON CONFLICT arbiter**: PASS — `ON CONFLICT (event_id)` arbiter = `uq_cancel_sync_outbox_event_id UNIQUE(event_id)` 명시 제약(partial-index 아님) → 42P10 위험 0.
6. **C19 contract RPC body-drift**: N/A — net-new fn 3종, 등록 계약 RPC 재정의 0, 계약자산 편입 NONE(DA 확정).
7. **Dryrun No-Persistence**: PASS — sentinel RAISE EXCEPTION unwind + up.sql COMMIT-strip 경고 명시. dev+prod(rxlomooz) DB 재실행 A~G all_pass=t + post-probe `to_regclass(cancel_sync_outbox)=null`(무영속) + lifecycle_rail_intact=true.
8. **Ledger forward-only**: PASS — 20260807120000 monotonic(repo head 위 append) · OOB 충돌 0(전량 신설, 기존 dopamine_callback_outbox/enqueue_dopamine_callback/dispatch·payment_sync_outbox 무접촉).
9. **Rollback 대칭성**: PASS — cron unschedule → DROP TRIGGER → DROP FUNCTION×3 → DROP TABLE(idx/RLS/UNIQUE 동반). DROP FUNCTION=grant 동반소거(역 REVOKE/GRANT 불요). lifecycle rail·reservations 본체 무손상.
10. **Build**: PASS — qa_build_cf.sh RESULT: BUILD OK exit 0(FE tree byte-identical to origin/main, src/ 0파일).
11. **Payload contract conformance (독립 검증)**: PASS — 수신부 crm-cancel-callback(tm-flow) firsthand 직독:
    - 필수 필드 gate(L131) = `source_system·event_id·cancelled_at` + 매칭키(cue_card_id OR 복합키 source_crm+crm_reservation_id) → foot emit payload 전건 충족.
    - `cancelled_reason` = 수신부 **자체 상수** `CANCEL_MIRROR_REASON` co-set(L~235, payload `p.cancel_reason` 미참조) → 도파민측 불변식(is_cancelled⟹cancelled_at∧cancel_reason NOT NULL) 수신부 자족 충족. **DA "cancel_reason 동반" = source-side(foot reservations) DB 불변식(자체 컬럼, 입력필수 20260515), wire 필드 아님** → payload 생략 정확.
    - 단일 crm_reservation_id 단독 미송신(source_crm 항상 동반) → 400 REJECT 회피. ✓
12. **Lifecycle rail 무접촉 (gjv7 INVARIANT-1)**: PASS — 별개 신규 rail(cancel_sync_outbox→crm-cancel-callback live SSOT). dopamine_callback_outbox·enqueue_dopamine_callback·dopamine-callback-dispatch(→crm-lifecycle-callback) 무변경(마이그·롤백 무접촉 확인).
13. **C18/C21 DA HOLD/RETRACT**: CLEAR — signals(+archive) 본 forward-fix 대상 활성 HOLD/binding 0. dependency block=CONSULT-REPLY(06:17)로 해제. supervisor MQ inbox 미처리 DA 0.
14. **DA GO / change-class**: PASS — MSG-...hpoa GO(ADDITIVE·§3.1 면제·계약 무개정).
15. **Phase1.5 env / Phase2 browser**: N/A — db_only+ef_only(src/ UI 0파일, import.meta.env 0, browser baseline 대상 아님).

### C14 CI-green — **FREEZE-OVERRIDE (supervisor deploy-gate)**
- PR#115 statusCheckRollup: CF Pages·Vercel·Vercel-Preview 전건 **SUCCESS**(단 완료시각 08-06T22:25=head 08-07 07:22 이전 = FE byte-identical 이라 재빌드 무 → stale 아닌 unchanged 반영). GHA `CI · Push`/`secret-scan` run은 rollup 부재.
- GHA hosted-runner **systemic outage**(추적 티켓 CI-RUNNER-QUEUE-STUCK-FOOT=dev-meta P1 · REDPAY-MONITOR·CONSULTCONFIRM 동일 blocked): main push run 3h+ queued(NHIS-LOOKUP 31120541068)·nightly 3h38m fail = PR#115 고유 실패 아님.
- 배포세트 = EF(deno)+DB-migration only(FE 무변경). 정확성은 supervisor 독립검증(full mig+EF+수신부 직독 + prod-DB dryrun + build)으로 확보 → CI 인프라 outage 가 correctness-verified·ADDITIVE·dark-hold 배포를 무기한 차단 불가 → **freeze-override 정당**.

## Yellow 근거
1. C14 = direct green 아닌 freeze-override.
2. live-emit = dark→live env-flip(별 supervisor 게이트, 수신부 acceptance 1건 test-emit 후)로 defer.
3. C23-2 live anon/authenticated-EXEC=0 POSTCHECK = apply 후 검증.
4. cross-CRM cutover · 양축 수렴(is_cancelled ∧ cue stage) 현장검증 = 실 취소 이벤트 필요.

## dev-foot 적용 지시 (마이그 직접 실행 규약)
1. **qa_lease_guard.sh** 통과 확인 후에만 prod-mutating 진입.
2. mig `20260807120000` prod apply (union 130000=PLANA idempotent no-op, DDL-diff 확인). 
3. EF `crm-cancel-sync-emit` 배포 — ★`CANCEL_SYNC_EMIT_ENABLED` **미설정/false 유지(DARK)**. env-flip 금지(supervisor env 게이트 전용).
4. PR#115 FF-merge → origin/main(SSOT 랜딩).
5. **POSTCHECK 회신**(supervisor 사후검증용): 
   - C23-2: `has_function_privilege('anon','public.cancel_sync_drain()','EXECUTE')`=false ∧ `...alert_cancel_sync_dlq()`=false ∧ `...enqueue_cancel_sync_from_reservations()`=false. 'authenticated' 동일=false. service_role=true. (anon/auth-EXEC≠0 = 즉시 롤백)
   - 구조: cancel_sync_outbox + UNIQUE(event_id) + idx_due + trigger(AFTER UPDATE OF status, WHEN cancelled∧dopamine∧external_id) + cron 'foot-cancel-sync-drain' 등록.
   - 회귀0: lifecycle rail(dopamine_callback_outbox/enqueue_dopamine_callback/dispatch) 무변경 잔존.

## ★HARD guardrails
- (a) lifecycle rail(crm-lifecycle-callback) 재활성 절대 금지 = gjv7 INVARIANT-1 위반 → 자동 NO-GO.
- (b) env DARK 유지 — CANCEL_SYNC_EMIT_ENABLED=true flip = supervisor env 게이트 단독 권한.
- (c) 모든 prod-mutating 단계 직전 qa_lease_guard.sh.

— supervisor / 2026-08-07 · precheck 3차 (1차 07:00 NO-GO C13 · 2차 07:15 NO-GO C23+C14 · 3차 GO)
