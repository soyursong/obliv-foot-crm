---
ticket_id: T-20260706-foot-RRN-BIRTHDATE-DERIVE-ISSUE-BLOCK
status: deploy-ready
priority: P0
domain: foot
created_at: 2026-07-06
build_ok: true
spec_added: tests/e2e/T-20260706-foot-RRN-BIRTHDATE-DERIVE-ISSUE-BLOCK.spec.ts
db_changed: true
rollback_sql: supabase/migrations/20260710180000_fn_customer_birthdates_version_aware_vault.rollback.sql
data_architect_consult: N/A — 신규 컬럼/테이블/enum 0. 기존 함수 본문 內 키 소스만 교체(CREATE OR REPLACE, 시그니처 무변경). supervisor Option B 승인(07-06) + 대표 LAUNCH-P0(MSG-6mim) 범위 內.
db_gate: supabase/migrations/20260710180000_fn_customer_birthdates_version_aware_vault.sql (fn_customer_birthdates RPC body만, version-aware Vault dual-key. 테이블/컬럼/enum/RLS/GRANT 무변경 — supervisor 함수-diff Gate 대기)
risk_level: GO (1/5 — RPC body만, 시그니처 무변경 CREATE OR REPLACE. rrn 파생 2순위 분기의 키 소스만 GUC-only→version-aware. 실행 로직은 이미 라이브·검증된 20260710170000 fn 블록과 byte-identical. rrn_decrypt 무접점.)
deploy_ready: true
commit_sha: c2fc36b2
# ── MIG-GATE 4필드 ──
mig_files: supabase/migrations/20260710180000_fn_customer_birthdates_version_aware_vault.sql (멱등 CREATE OR REPLACE + $verify$ 인-트랜잭션 self-test 가드) / .rollback.sql 동봉
mig_dryrun: 로컬 `npm run build` PASS(4.97s, TS/vite 무오류). SQL 검증 = (a) BEGIN…COMMIT 內 $verify$ 가드가 apply 시점 자체검증(foot_rrn_key_v2·decrypted_secrets·rrn_encryption_version·app.rrn_key 경로 존재 + TABLE 시그니처 유지 확인 → 실패 시 전체 tx abort·영속 0). (b) fn 실행 로직이 이미 prod 라이브·supervisor 실측 검증된 20260710170000 fn 블록과 executable byte-identical(comment/GRANT 재확인 외 0 diff). 풋 dev DB 미생성 + DB pw single-operator(RRN Runbook) → prod 트랜잭션 dry-run/apply = supervisor lane(본 배치 lane 오픈, supervisor 07-10 read-only 실측 선행).
mig_ledger_check: schema_migrations(version=20260710180000)=미기록(신규) / 파일=존재 / prod=fn_customer_birthdates GUC-only(app.rrn_key→구키 단일, supervisor 2026-07-10 read-only 실측) — apply 전 3자 정합. rrn_decrypt는 20260710170000로 이미 dual-key 착지(divergence: 170000의 fn 블록만 prod 미착지 → 본 마이그가 정본 기준 fn만 forward 재수렴). apply=ledger helper 경유(schema_migrations 자동 INSERT).
mig_rollback: supabase/migrations/20260710180000_fn_customer_birthdates_version_aware_vault.rollback.sql (직전 20260613120000 GUC-only 정의 CREATE OR REPLACE 복원, 시그니처/GRANT/PHI 가드 무변경·데이터 무손실. rrn_decrypt 롤백 대상 아님.)
---

## 요청 (FIX-REQUEST, supervisor P0 — MSG-20260710-164601-ato2 · CEO MSG-6mim · umbrella PRELAUNCH-SUPERVISOR-APPLY-BATCH)

06-25 RRN 키 rotation 후 신규/재암호화분(rrn_encryption_version=2, 47행)은 Vault 신키
`foot_rrn_key_v2` 로 암호화됨. rrn_decrypt/rrn_encrypt 는 이미 version-aware Vault dual-key
로 전환(20260710170000)되어 전 70행 복호 가능.

**유일 잔여 갭**: `fn_customer_birthdates` 의 rrn 파생 분기(2순위)가 여전히
`current_setting('app.rrn_key')`→구키 폴백 단일 경로(pgp crypto 사용 함수 전수 스캔 결과
이것만 GUC-only). → v2 47명(균검사·피검사) birth_date 파생 실패 → 발급 게이트 차단 지속의 RC.

## 구현

`fn_customer_birthdates` 의 rrn 파생 분기(2순위)를 rrn_decrypt 와 **동일한 Vault dual-key
패턴**으로 전환:
- v2 신키: 루프 밖 1회 `vault.decrypted_secrets` 에서 `foot_rrn_key_v2` READ (별도 키값 불요).
- v1(및 legacy): 기존 GUC `app.rrn_key`→구키 `obliv_foot_rrn_key_2026` fallback 유지(무회귀).
- 행별 `rrn_encryption_version` 기준 `v_key := CASE WHEN ver=2 THEN v_key_v2 ELSE v_key_v1 END`.
- v2 Vault 키 결측/조회실패 시 fail-safe(해당 행 파생 NULL — 구키 오복호 금지).

## Acceptance Criteria

- **AC1**: v2(47명) birth_date 파생 성공 → 발급 게이트 통과. (supervisor apply 후 실측)
- **AC2**: v1(23명) birth 파생 무회귀(구키 경로 유지).
- **AC3 (무회귀 하드)**: 신규 복호 surface 0 · RLS/GRANT 변경 0 · 시그니처 무변경 ·
  birth_date_display(YYYY-MM-DD)만 반환(rrn 평문/뒷자리/성별코드 미노출) · rrn_decrypt 무접점.
- **AC4**: phi_access_log audit 무회귀(fn_customer_birthdates 는 원래 audit 미기록 함수 — parity 유지).

## 검증 (supervisor 수행 예정, apply 후)

- v1/v2 샘플 birth 파생 성공 + 발급 게이트 통과 + phi_access audit 무회귀.
- 등록 에러 surface(confirmRrnSaved→rrn_decrypt)는 rrn_decrypt dual-key로 이미 해소 개연 — 동반 실측.
