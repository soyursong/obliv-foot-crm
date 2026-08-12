# T-20260812-foot-CLOSING-HERALD-EMIT-TIMING-DRIFT-REEMIT — foot lane FIX 설계 (apply-gated)

**작성**: dev-foot · 2026-08-12 · **write/DDL 0 (artifacts only · supervisor 물리 GO-token 전 미적용)**
**SSOT (canonical · 발명 금지)**: `agents/docs/da_replies/da_decision_foot_closing_herald_emit_timing_drift_reemit_20260812.md`
**RC**: `db-gate/T-20260812-foot-CLOSING-HERALD-EMIT-TIMING-DRIFT-REEMIT_RC.md` (AC1, read-only)
**lane-split (planner MSG-20260812-172623-ei6e)**: (A)테스트격리 CI 불변식=**dev-meta**(본 lane 아님) / **본 foot lane = B-narrow + Q3 α + Q3 β**

---

## 산출물 (전부 apply-gated · write 0 until supervisor 물리 GO-token)

| # | 파일 | class | 게이트 |
|---|------|-------|--------|
| 1 | `supabase/migrations/20260812180000_foot_closing_enqueue_divergence_loudfail.sql` | DDL(function CREATE OR REPLACE) | supervisor **DDL-diff / MIG-GATE** + 물리 GO-token |
| 1d | `…20260812180000….dryrun.mjs` | No-Persistence sentinel | supervisor MIG-GATE 시 실행 |
| 1r | `…20260812180000….rollback.sql` | 대칭 역전(806150000 정본 복원) | — |
| 2 | `scripts/reemit_20260812_closing_emit_timing_drift.mjs` | corrective data-write(DDL 0) | supervisor **DB-GATE dry-run** + 물리 GO-token + **H1~H4** |

---

## (1) Axis-B-narrow — enqueue divergence-aware loud-fail (DA Q1 §49~51)

- **무엇**: 현행 prod enqueue(20260806150000 TOTALS-RECOMPUTE-PORT)의 primary `INSERT … ON CONFLICT (clinic_id,close_date,revision) DO NOTHING` 의 **silent-drop** 을 **divergence-aware** 로 강화.
  - `GET DIAGNOSTICS ROW_COUNT = 0`(충돌) 시 stored slot payload 와 incoming 실 payload 를 **INV5 축**(`total_amount_krw` / `daily_closings 확정합=Σsystem_totals`)으로 대조.
  - **identical(진성 멱등 재시도) → true no-op**(DO NOTHING 유지·침묵) / **material 상이(phantom-collision) → `RAISE WARNING`(loud-fail·표면화)**.
- **DA (B) supersede+rev bump 재정의 = REJECT-as-mechanism** → 본 마이그는 구현 안 함.
- **H7 준수**: mutate-on-conflict 아님(stored 행 UPDATE/supersede 0) · `RAISE WARNING`(NOT EXCEPTION) → txn abort 없음 → **마감확정 절대 비차단**.
- degraded fallback INSERT = plain DO NOTHING 유지(최소-payload 에 INV5 축 필드 부재 → 대조 무의미).
- **불변**: TOTALS-RECOMPUTE-PORT 산식·INV1~5·200000 supersede-fix·grant-seal 전부 806150000 정본 계승. split 3함수 무접촉(회귀 0).
- **change-class = ADDITIVE/CORRECTIVE**(function-diff 1건·시그니처 불변·스키마/테이블/데이터 변경 0·롤백 대칭) → §3.1 파괴게이트 면제 **BUT DDL 실재** → DDL-0 carve 아님 → supervisor MIG-GATE + 물리 GO-token 선행 필수. ('DDL 0'≠GO-token 면제, DA §110/§128).
- **self-test**(up.sql $verify$): loud-fail 마커·GET DIAGNOSTICS·mutate-on-conflict 0(H7)·806150000 산식 계승·supersede 유지·INV5·C23 seal → 실패 시 배포 중단.

## (2) Q3 오염 정정 — α reemit + β phantom-void (DA Q3 · H1~H4)

### 핵심 발견 (worker 실측 — DA §76/H5 확증)
- worker `process_closing_confirmed_outbox()` 는 `WHERE dlq=false AND status IN('pending','processing')` 로 select — **`superseded` 를 필터하지 않음**.
- ∴ phantom rev0 를 `superseded=true` 로만 두면 여전히 `dlq=false·pending` → **worker 가 80k 발송(double-announce)**.
- ∴ α LEG2 phantom 중립화는 **`dlq=true`(worker 제외) + `superseded=true`(reader 제외)** 둘 다 필요. 부모 reemit(superseded-only)만으론 불충분.

### sub-case α (실 closed dc[진성] 존재 + CF-5 phantom: 08-07~08-11)
- **LEG2**(중립화 먼저): phantom rev0(H2 지문 = rev0 ∧ memo='CF-5 자동 마감 spec' ∧ 80k) → `dlq=true·superseded=true` (rows-affected=1 guard·H3 archive-first, hard-DELETE 금지).
- **LEG1**(reemit): 부모 경로 재사용 unlock→reconfirm → confirm_guard revision+1 + enqueue 재발화 → rev+1 신 슬롯(진성 total) emit + 구 rev supersede. per-date 원자 txn.

### sub-case β (실 closed dc 부재: 08-06) — closing 합성 절대금지
- 08-06 rev0 = 부모 failed/dlq 아티팩트(CF-5 phantom 아님)이며 **이미 dlq=true → worker/reader 제외(emit 0 만족)**. 스크립트 자동 write 0.
- β-1(진성 미마감)/β-2(dc 소실) **DoD 판별은 planner/DA 소관** — 합성 금지·자동 void 금지.

### ★BETA_HOLD 안전판 (08-12 형)
- **08-12 의 daily_closings 자체가 CF-5 test-artifact**(memo='CF-5 자동 마감 spec' ∧ 80k · 실 EOD 미도래). 이 dc 를 reconfirm 하면 **false 80k 를 rev+1 로 발사** = closing 합성 = **금지**.
- ∴ classify() 가 `dc=test-artifact` 를 감지하면 **BETA_HOLD → 자동 write 0**. 실 EOD 후 재-probe(dc→진성 total) 시 ALPHA 로 재분류되어 정정. under-correct ≫ over-correct.

### HARD 가드
- **H1** seal-before-backfill: `--apply` 는 `--axis-a-sealed`(Axis-A=CF-5 prod-write-ban, **dev-meta lane** 배포/봉인) 동반 필수 — 미봉인 시 abort(재오염). apply-time fresh re-probe.
- **H2** freeze: phantom 지문 정확 매칭 + rows-affected=1 abort-guard(blanket/단일-count UPDATE 금지).
- **H3** archive-first: dlq/superseded 마킹(hard-DELETE 금지·가역·audit).
- **H4** before-image 스냅샷(census 출력) + rollback(대칭).

---

## 시퀀싱 (엄수)
1. **Axis-A(dev-meta) 배포/봉인 선행**(H1). ← 본 foot lane 소관 아님.
2. supervisor MIG-GATE(B-narrow DDL-diff + dryrun) + 물리 GO-token → (1) apply.
3. supervisor DB-GATE(Q3 dry-run: 스크립트 DRY census 검토) + 물리 GO-token → (2) `--apply --axis-a-sealed` (β-1 확정 시 `--beta1-confirmed`).
4. deployed 전환 시 `applied_at`(DDL-ATOMIC) 기록.

> **write 0 until supervisor 물리 GO-token.** DA 판정=change-class only(AC-1). apply-gate/순서=supervisor chokepoint.
