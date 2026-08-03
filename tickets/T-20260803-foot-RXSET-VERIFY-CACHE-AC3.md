---
id: T-20260803-foot-RXSET-VERIFY-CACHE-AC3
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 173276de1b7a
author: dev-foot
created: 2026-08-03
db_change: true
change_class: ADDITIVE
da_consult: replied
da_decision: DA-20260803-foot-RXSET-VERIFY-CACHE-AC3
da_ssot: da_decision_foot_rxset_verify_cache_ac3_20260803.md
gate: supervisor-ddl-diff
mig_files: [supabase/migrations/20260803210000_prescription_codes_verify_cache.sql]
mig_rollback: supabase/migrations/20260803210000_prescription_codes_verify_cache.rollback.sql
mig_dryrun: supabase/migrations/20260803210000_prescription_codes_verify_cache.dryrun.sql
applied_at:
e2e_spec: tests/e2e/T-20260803-foot-RXSET-VERIFY-CACHE-AC3.spec.ts
risk_verdict: GO
risk_reason: "ADDITIVE — prescription_codes 에 nullable verify_* 6컬럼 추가(NULL default·CHECK無·FK無·기존 RLS 상속). 동형 선례=20260716140100_rxset_hira_provenance_columns / 20260615120000_rxset_tag_meta. 청구/KPI/집계 reader 무입력. DA GO+ADDITIVE=§3.1 대표게이트 면제, supervisor DDL-diff 만. J3 staleness 가드(self-healing hash)·J2 read fallback FE 포함. backfill=N/A(첫 read recompute+populate warm-up). 신규 npm 0, prescription_codes write-RLS 무변경(populate=service-role/EF·기존 write 경로 상속)→ 재-CONSULT 트리거 무저촉. FE deploy-tolerant(컬럼 미적용 시 resolveVerifyVerdict recompute 폴백)."
---

# T-20260803-foot-RXSET-VERIFY-CACHE-AC3 — 약품 외부DB 검증결과 영속 캐시(AC-3)

## 출처
- DA CONSULT-REPLY **MSG-20260803-200734-wk4g** (data-architect → dev-foot, CONSULT-REPLY): **GO (ADDITIVE)·조건부**.
- 부모: T-20260629-foot-RXSET-DRUG-VERIFY-PHASE2 (AC-3 캐시스키마·AC-8 대량인덱스 carve → DA CONSULT·dry-run 게이트 유지).
- SSOT: `da_decision_foot_rxset_verify_cache_ac3_20260803.md`.

## 판정 수용 (dev-foot DDL 확정)
- **J1 배치 = Option A**(prescription_codes nullable 컬럼). DA "수용 가능" + 코드베이스 확립 선례
  (insurance_status·hira_provenance 동형 = 마스터에 nullable 컬럼 직접 추가). J3-a self-healing hash 채택으로
  inline staleness 규율 보장 → 별도테이블 불요. 마스터 write-RLS 무변경(재-CONSULT 트리거 무저촉).
- **J2 SSOT 방화벽(HARD)**: FE `src/lib/drugVerification.ts` = 판정 권위. 캐시 = 비-권위 materialization.
  읽기 권위 경로 `resolveVerifyVerdict()` 는 캐시 신선 시 HIT, 아니면 항상 recompute 폴백(캐시 유일진실 신뢰 금지).
- **J3 staleness 가드(DISPOSITIVE·필수)**: 택1-a self-healing = `verify_input_hash`(입력3필드 FNV-1a 지문)
  + `verify_model_version`. 읽기 시 hash/version 불일치 → 캐시 MISS → recompute(트리거 불요, FE 버전업 자동무효화).
- **J4 컬럼표준**: `verify_status`/`verify_ingredient`/`verify_matched_code`(placeholder 제외·FK아님)/
  `verified_at`(timestamptz)/`verify_input_hash`/`verify_model_version`. CHECK 無=app-enforced(값 진화 시 비-ADDITIVE 회피).
- **backfill = N/A**: 기존행 전부 NULL = 캐시 MISS = 첫 read recompute+populate 자연 warm-up.
- **계약자산 편입 = NOT-NOW**: foot-local 캐시(cross-fork RPC 아님)·cross_crm_data_contract 무개정.

## 산출물
- 마이그레이션(ADDITIVE): `supabase/migrations/20260803210000_prescription_codes_verify_cache.sql` (+rollback +dryrun).
- FE 가드(J2/J3): `src/lib/drugVerification.ts` — `VERIFY_MODEL_VERSION`, `computeVerifyInputHash`,
  `isVerifyCacheFresh`, `resolveVerifyVerdict`(read fallback), `pickVerifyMatchedCode`, `buildVerifyCacheWrite`(populate).
- E2E spec: `tests/e2e/T-20260803-foot-RXSET-VERIFY-CACHE-AC3.spec.ts` — 19 passed (J2/J3/J4 단위 + 마이그 정적 단언).

## 검증
- `npm run typecheck` clean / `npm run build` ✓ (built ~6.3s) / playwright AC-3 spec **19 passed, 0 failed**.

## ball → supervisor
- **supervisor DDL-diff** (§3.1 ADDITIVE+DA GO = 대표게이트 면제, DDL-diff 게이트만). PROD apply·`applied_at` 스탬프 = supervisor.
- 재-CONSULT 조건(DA): 캐시가 계약공유 컬럼/enum 신규도입 / matched_code 가 외부 code 테이블 FK 승격 /
  prescription_codes RLS write-profile 변경 필요 시 → 현 스펙 모두 무저촉.

## 후속 (본 커밋 비범위)
- populate 배선(EF/데스크가 `buildVerifyCacheWrite` 로 verify_* UPDATE + `verified_at=now()`) = 후속 트랙.
- 소비부 전환(배지 렌더가 `resolveVerifyVerdict` 채택, 캐시 컬럼 select 추가) = populate 랜딩 후 트랙.
- AC-8 HIRA 명칭 인덱스 대량 적재 = 별도 dry-run+DA 게이트 유지(본 커밋 대량적재/무거운 인덱스 0).
