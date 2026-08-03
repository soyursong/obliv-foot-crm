---
id: T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8
domain: foot
priority: P2
status: deploy-ready
qa_result: pending
deploy_commit:
author: dev-foot
created: 2026-08-03
db_change: true
change_class: ADDITIVE
da_consult: replied
da_decision: DA-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8
da_ssot: da_decision_foot_rxset_hira_name_index_ac8_20260803.md
gate: supervisor-mig-gate
mig_files: [supabase/migrations/20260803220000_hira_drug_name_index.sql]
mig_rollback: supabase/migrations/20260803220000_hira_drug_name_index.rollback.sql
mig_dryrun: supabase/migrations/20260803220000_hira_drug_name_index.dryrun.sql
import_script: scripts/import_hira_drug_name_index.ts
applied_at:
e2e_spec: tests/e2e/T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8.spec.ts
evidence: evidence/T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8_VG1_topology_and_sizing.md
medical_confirm_gate: not-applicable
risk_verdict: GO
risk_reason: "ADDITIVE — 신규 전용 참조테이블 hira_drug_name_index(외부 참조 유니버스, 비-PHI/금전/원장, v2.30 drug_reference 동형) + name_normalized 위 GIN trigram(pg_trgm) + RLS authenticated SELECT-only(anon 신규 surface 0). greenfield INSERT(기존행 mutation 0)·FK無(VG-3)·grain firewall(prescription_codes 카탈로그와 분리). §3.1 대표게이트 면제(DA §5)=YES, 게이트=supervisor MIG-GATE(DDL-diff+Dry-Run No-Persistence+Ledger Reconciliation+멱등/rows-affected assert). 멱등=ON CONFLICT(item_std_code) DO NOTHING·롤백=DROP TABLE(orphan無). VG-4=코퍼스만 적재·computeDrugVerifyVerdict 무변경(partial 활성화·verdict backfill 안함·AC-3 double-governance 없음). VG-1 topology=서버 SECDEF lookup(코퍼스 수만 행→FE-load 비현실)이나 그 조회 RPC=재-CONSULT 트리거(b)로 별도 후속 트랙(본 티켓 범위 밖). 신규 npm 0."
---

# T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8 — HIRA 명칭 인덱스 코퍼스 적재(AC-8)

## 출처
- DA CONSULT-REPLY **MSG-20260803-202232-0a3w** (data-architect → dev-foot): **GO / Option A(신규 전용 참조테이블) / ADDITIVE**.
- 부모: T-20260629-foot-RXSET-DRUG-VERIFY-PHASE2 (deployed/Green), AC-3(verify cache) 자매 carve #2.
- SSOT: `da_decision_foot_rxset_hira_name_index_ac8_20260803.md`.

## 판정 수용 (dev-foot 확정)
- **Q1 placement = Option A**: 신규 전용 테이블 `hira_drug_name_index`(외부 참조 유니버스 마스터).
  prescription_codes 위 보강 REJECT(grain collision·claim_code UNIQUE 오염·lifecycle stomp).
- **grain firewall**: 마스터(심평원 명칭 코퍼스·read-only·상류 refresh) ⊥ 카탈로그(병원 로컬 처방코드).
- **VG-2 코드축**: `item_std_code`=품목기준코드9(자연 unique). cross-ref = `'HIRA-'||item_std_code`
  = prescription_codes.claim_code · hira_match_basis `std9:` · AC-3 verify_matched_code 동일 namespace.
  EDI 청구코드축 혼용 금지.
- **VG-3 FK無**: prescription_codes→index FK 신설 금지(reference-lookup만). DROP-rollback orphan 회피.
- **VG-4 코퍼스만**: partial 활성화·verdict backfill 안 함. computeDrugVerifyVerdict 무변경(AC-3과 double-governance 없음).
- **VG-1 topology**: 코퍼스 수만 행 → FE-load 비현실 → 서버 SECDEF lookup. 단 조회 RPC=재-CONSULT (b) → **후속 트랙**(evidence 문서 §3~§4).

## 산출물
- 마이그레이션(ADDITIVE): `supabase/migrations/20260803220000_hira_drug_name_index.sql`
  (CREATE TABLE + GIN trigram + RLS authenticated SELECT + pg_trgm ext + 검증 DO block).
- dry-run(무영속): `..._hira_drug_name_index.dryrun.sql` (txn-strip 대신 exception-handler 무영속 실행검증 + post-probe).
- rollback: `..._hira_drug_name_index.rollback.sql` (DROP TABLE, greenfield 완전 가역).
- 멱등 import: `scripts/import_hira_drug_name_index.ts` (source A CSV → ON CONFLICT DO NOTHING + rows-affected assert, `--dry-run` 지원).
- 정규화 권위 util: `src/lib/hiraDrugNameIndex.ts` (normalizeHiraDrugName write/read 동형 + 코드축 cross-ref).
- E2E spec: `tests/e2e/T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8.spec.ts` (정규화/코드축/row/마이그 정적단언/VG-4).
- evidence: `evidence/..._VG1_topology_and_sizing.md`.

## 게이트 (supervisor MIG-GATE)
1. DDL-diff (신규 테이블 + 인덱스 + RLS, 기존 객체 mutate 0).
2. Migration Dry-Run No-Persistence (dryrun.sql 실행 → 무영속 PASS + post-probe).
3. Migration Ledger Reconciliation (schema_migrations 원장 정합).
4. 멱등/rows-affected assert (import `--dry-run` → 적격 카운트 확인 → upsert → 테이블 행수 >= 적격).
- ★prod 코퍼스 적재(수만 행)는 supervisor MIG-GATE 하에서만. source A CSV = 무키 다운로드(data.go.kr 15067462).

## §11 의료화면 컨펌 게이트
- **not-applicable(본 티켓)**: 코퍼스 적재는 진료대시보드/진료관리 UI 무변경(참조 데이터 테이블·배지 무변경).
- ★후속(partial 활성화 트랙)은 처방 화면 배지에 partial 노출 → **그 티켓에서 §11 컨펌 게이트 확인 필요**.

## 재-CONSULT 트리거 (DA §8)
- (a) 인덱스에 FK/제약이 계약축 포함 → 없음(FK無·CHECK無).
- (b) query-path가 신규 SECDEF RPC 착지 → **partial 활성화 후속 트랙에서 발생 예정**(본 티켓 범위 밖).
- (c) 코퍼스 cross-fork 공유 승격 → NOT-NOW(foot-local).
