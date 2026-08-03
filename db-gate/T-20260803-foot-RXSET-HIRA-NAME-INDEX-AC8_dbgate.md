# DB-GATE evidence — T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8

- **change-class**: ADDITIVE (신규 테이블 + 인덱스 2 + RLS SELECT 정책 + greenfield INSERT). 파괴 0.
- **DA CONSULT**: DA-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8 (MSG-20260803-202232-0a3w, GO / Option A).
- **게이트**: supervisor MIG-GATE (CEO 게이트 면제 = §3.1 ADDITIVE + DA GO). comp-gate N/A. backfill SOP N/A(greenfield).

## 마이그 파일
| 파일 | 역할 |
|------|------|
| `supabase/migrations/20260804020000_foot_hira_drug_name_index_ac8.sql` | up (CREATE TABLE + pg_trgm + GIN idx + RLS + 멱등 seed + assert) |
| `..._ac8.dryrun.sql` | Migration Dry-Run No-Persistence (BEGIN..ROLLBACK, COMMIT 0) |
| `..._ac8.rollback.sql` | DROP TABLE (greenfield clean, FK 무 → orphan 무) |

## 신규 스키마 (ADDITIVE)
- `public.hira_drug_name_index` (id·item_std_code UNIQUE·name_ko·name_normalized·ingredient_code·ingredient_name·source_ref·loaded_at)
- 인덱스: `hira_drug_name_index_item_std_code_key` (UNIQUE) + `hira_drug_name_index_name_norm_trgm` (GIN gin_trgm_ops)
- 확장: `pg_trgm` (CREATE EXTENSION IF NOT EXISTS)
- RLS: `hira_drug_name_index_approved_read` (SELECT TO authenticated USING is_approved_user()). WRITE 정책 무.

## HARD verify-gate (VG-1~4) 해소
- **VG-1 query-path topology**: 서빙 = FE bounded trigram SELECT(RLS authenticated). ★SECDEF lookup RPC 미착지(의도) — pin/re-CONSULT 트리거 회피. 본 마이그 read-path 변경 0.
- **VG-2 코드축**: item_std_code = 품목기준코드9(HIRA 상품표준 namespace, claim_code 'HIRA-' strip). EDI 혼용 금지(bare EDI 제외).
- **VG-3 FK 무**: prescription_codes→index FK 신설 0. reference-lookup only.
- **VG-4 verdict 이중거버넌스 회피**: 코퍼스 적재만. verify recompute/backfill 0(AC-3 소관).

## AC 매핑
- **AC-8-1** 단일 소스: seed = prescription_codes HIRA-official(T-20260617/data.go.kr 15067462 lineage). ON CONFLICT DO NOTHING(중복적재 금지). 더 넓은 source-A CSV = 동일 멱등 loader 후속 추가(코드변경 아님, 완전성 로그 명시).
- **AC-8-2** dry-run+DA: DA GO 완료 + dryrun 무영속(txn-control strip + BEGIN..ROLLBACK + post-probe) + 멱등 가드 + rows-affected assert(부분적재 abort) + DROP 롤백.
- **AC-8-3** MIG-GATE: 본 evidence + 5필드(frontmatter). schema_migrations↔파일↔prod 3자 대조 = supervisor apply 시.
- **AC-8-4** canon: name_normalized = trim+공백축약+소문자 fold, ★용량표기 보존(퍼지/용량 자동연결 금지) — drugVerification.ts normalize 정합.

## supervisor MIG-GATE 체크리스트
1. DDL-diff: 신규 테이블/인덱스/정책만 (기존 객체 mutate 0).
2. Dry-Run No-Persistence: `..._ac8.dryrun.sql` 실행 → 'DRYRUN OK' + ROLLBACK → post-probe `to_regclass IS NULL`=true.
3. Ledger Reconciliation: apply 후 schema_migrations(20260804020000)↔파일↔prod 실재 3자 일치.
4. 멱등/rows-affected: 재실행 no-op(ON CONFLICT), assert loaded>=eligible.
5. `applied_at` = supervisor apply 후 기록.
