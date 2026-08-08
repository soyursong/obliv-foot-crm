# T-20260801-meta-DBGATE-GUARD-XCRM-ROLLOUT — foot leg 이식 evidence

- **repo (canonical)**: obliv-foot-crm (`rxlomoozakkjesdqjtvd` prod)
- **정본 참조**: happy-flow-queue(crm)@e1e4202 (08-05 GO) · body@f924e408 (single-prod DEV_REF empty 선례)
- **계보**: HONORSYS(784b8114) → scalp2 AC-3(ecc96a0f) → body AC-2(f924e408) → crm(e1e4202) → **foot(본건)**
- **artifact-class**: `ops_only` (scripts/ + .githooks/ + db-gate/ 전용 — src/FE·EF 무접점)
- **db_change**: false (guard 인프라만; prod DDL/DML 미집행) · **DA CONSULT**: 불요(신규 컬럼/테이블/enum 0)

## requirement 이행

### 1. guard-lib 이식 (byte-parity, 환경 pin 교체)
- `scripts/apply_gate_lib.mjs` — 핵심 로직 crm/body byte-identical(주석·환경 pin·naming만 교체).
  - `FOOT_PROD_REF='rxlomoozakkjesdqjtvd'` / `FOOT_DEV_REF=null` (dev DB 미생성 → empty-guard, fail-closed).
  - `assertDbGateGo` (A∧C 복합) + `assertApplyGateForRunner` (DML/DDL 러너 chokepoint) superset.
- `scripts/db_apply_guard.sh` — SQL-file(DDL) lane chokepoint. `PROD_REF=rxlomoozakkjesdqjtvd` / `DEV_REF=""`.
- **pubkey byte-identical**: `db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem`
  - sha256 = `884f9283ae62d473ce8df27570f565b31e954862707fbe6da09f0fbf0c96daa3` (crm/body 전 CRM 동일, key_id=supv-dbgate-2026a).

### 2. gated TEMPLATE
- `scripts/_TEMPLATE_apply_runner_gated.mjs` — foot `foot_migration_ledger.applyMigration` 패턴 반영 정본.
  APPLY 직전 `assertApplyGateForRunner` 호출 + content-binding(migrationSqlFile) + evidenceLog 계약 고정.

### 3. prepush lint 가드 #5
- `scripts/check-apply-runner-gate.sh` — push range 신규/변경 `scripts/apply_*.mjs` 중 `--apply` 보유 +
  `assertApplyGateForRunner` 미배선 → BLOCK(fail-closed). 탈출구 `APPLY_RUNNER_GATE_BYPASS=1`(사유 의무).
- `.githooks/pre-push` §⑤ 로 배선 (기존 ①ghost ②red-CI ③deploy-order ④non-FF 뒤에 append).

### 5. apply 경로 전수 census + 재실행 가능 러너 chokepoint 물리 배선 (runner_gate_unwired 교훈)
- **census**: `scripts/apply_*.mjs` = **132건**. `--apply` prod-write 통로 보유 = **30건**.
  - foot 러너 대부분 `scripts/lib/foot_migration_ledger.mjs` 의 `applyMigration()`/`query()`(Management API POST) 경유.
- **재실행 가능(최근 idempotent applyMigration) 러너 4건 = 실 COMMIT 직전 chokepoint 배선**:
  | runner | ticket | binding |
  |---|---|---|
  | apply_20260807120000_foot_cancel_sync_outbox_emit.mjs | T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE | migrationSqlFile=MIG_DIR/FILE |
  | apply_20260807120000_foot_inflow_kiosk_selfcheckin_candidate.mjs | T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE | migrationSqlFile=MIG_DIR/FILE |
  | apply_20260805171000_171100_171200_foot_repay_pkglink_revtransition_fwdfix.mjs | T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX | migrationSql=combinedSql (3-파일 concat) |
  | apply_20260804170000_foot_closing_herald_payload_pkg_reconcile.mjs | T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE | migrationSqlFile=MIG_DIR/FILE |
  - ★ repay 러너(08-05)는 이전 착수에서 이미 `assertApplyGateForRunner` 배선돼 있었으나 **`./apply_gate_lib.mjs`
    모듈이 origin/main 에 부재(phantom import) = 착지 0 상태**였음. 본 leg 의 guard-lib 신설로 import 해소.
- **legacy 러너(range 밖, ≤07-29 one-shot·backfill·이미 소진)**: 카피 소스 아님 → 대상 아님(crm 정본 동일 scope).
  향후 재생산은 lint 가드#5 가 차단, 신규 러너는 gated TEMPLATE 를 카피 소스로.

## 기계 증적 (재현 커맨드 = commit 본문)
- `node --check` 8파일(lib·test·template·러너4·repay) 전건 OK.
- `node --test scripts/apply_gate_lib.test.mjs` = **20/20 pass** (HONORSYS 계약 무회귀).
- runner-gate CLI: prod+`--apply`+notoken → **exit1(go_token_missing)** / dry(`--apply` 미지정) → apply=false exit0 /
  미지 ref(body prod) → **exit1(unknown_ref)**.
- `db_apply_guard.sh --dry-run`(prod config, notoken) → **abort exit1(go_token_missing)** — ①ref해석 ②pin대조 ③GO검증 순서 실측.
- lint: 배선 4러너 → PASS(exit0) / legacy ungated(`--apply` 보유) 대조 → FAIL(exit1).
- pubkey sha256 = `884f9283…c96daa3` (byte-parity 확인).
- E2E: `ops_only`(deps/스크립트 lane, src/FE 무접점) → `e2e_spec_exempt_reason` = 비-UI 인프라 가드.

## 후속
- scalp2 runtime 백스톱(⑤⑥, MSG-20260808-172706-75ni) 검증 GO 후 동반 이식 예정 — 본 leg 는 기존 스코프로 독립 착지.
- supervisor code-gate 동형 매트릭스 검증 대기.
