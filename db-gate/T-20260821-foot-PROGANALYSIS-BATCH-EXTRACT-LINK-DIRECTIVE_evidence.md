# DB-GATE Evidence — T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE (Phase-2 §4/§5)

**re**: supervisor DB-GATE-HOLD `MSG-20260822-013137-93h7` / DB-GATE-REPLY `MSG-20260822-013222-gagk` (PARTIAL-PASS + GO-TOKEN HELD)
**응답**: no-persistence dry-run 무영속 재현 evidence + MIG-GATE 4필드 (물리 GO-token 서명 前 유일 잔여 전제)
**정본 SSOT**: `agents/docs/da_replies/da_decision_foot_proganalysis_slip_schema_extract_link_20260822.md`
**branch**: `feat/T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE` (main 미머지 — PRE-MAIN 축 D, supervisor GO 後 착지)

---

## 대상 아티팩트

| 파일 | sha256 |
|------|--------|
| `supabase/migrations/20260822010000_foot_progress_analysis_slips_schema.sql` | `fde2affad650fddf3935736c2e63eee0eead6521f7b803b6e58cf5739a048ecb` |
| `supabase/migrations/20260822010000_foot_progress_analysis_slips_schema.rollback.sql` | `1f7274b19891c9bcc3eed7bc94129f5986249040d3688b32898bf7b7a2032496` |
| `supabase/migrations/20260822010000_foot_progress_analysis_slips_schema.dryrun.sql` (harness, GENERATED) | `1ee07f7cb7bdded6cb80b7dc30969ea7ffa34e48a3d8549c6288b5ff00bb3f4b` |
| 러너 | `scripts/T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE_dryrun.mjs` |

---

## 1. no-persistence dry-run (Migration Dry-Run No-Persistence Protocol)

러너 = `scripts/dryrun_lib.mjs` (foot canonical 무영속 러너, 표준 `agents/docs/migration_dryrun_no_persistence_standard.md` v1.0). 3요소 구조:
① `stripTxnControl` — top-level txn 제어문 제거 (**strip 됨: `["BEGIN;","COMMIT;"]`**, INV-5 비침묵 기록).
② plpgsql exception-handler(`DO … EXECUTE … EXCEPTION`) 안에서 sentinel RAISE 로 subtransaction 강제 롤백 → **진짜 무영속**. handler 는 sentinel 외 모든 예외 re-raise(broken 마이그 = PASS 오분류 불가, INV-2/4).
③ `assertAbsent` post-probe — dry-run 후 introspection 으로 신설 오브젝트 13종 **prod 부재 실측**(발견 시 `dryrun_persistence_leak` FAIL, INV-3).

**§5 무영속 불가 DDL 검출 = 0** (`CREATE INDEX CONCURRENTLY`/`ALTER TYPE ADD VALUE`/`VACUUM` 등 없음 → 전 DDL 트랜잭션 봉투 dry-run 가능. `is_deleted … GENERATED ALWAYS … STORED` ALTER 도 트랜잭션 가능).

### RUN A — forward only → **PASS**
- harness response `[]` = 실행 에러 0, sentinel(`DRYRUN_OK_ABORT`) 도달 → subtransaction 롤백.
- 마이그 말미 self-verify `DO $$…$$`(slips 생성/UNIQUE(reservation_id)/state 3-slug CHECK/RESTRICTIVE clinic-gate/audit append-only director-admin/images deleted_at·is_deleted GENERATED·slip_id/hard-DELETE 가드) **통과** = txn 내부에서 전 불변식 assert 성립.
- post-probe 13종 전부 `absent:true`:
  - relation `progress_analysis_slips`, `progress_analysis_slips_audit_log`
  - column `progress_result_images`.{`slip_id`,`deleted_at`,`deleted_by`,`delete_reason`,`is_deleted`}
  - policy `pas_clinic_gate`(slips), `pri_deleted_rows_admin_only`(images)
  - trigger `trg_progress_analysis_slips_audit`(slips), `trg_progress_result_images_harddelete_guard`(images)
  - proc `progress_analysis_slips_audit`, `progress_result_images_harddelete_guard`

### RUN B — forward + rollback round-trip → **PASS**
- forward 적용 후 rollback 을 동일 무영속 봉투에서 연결 실행 → harness response `[]`(에러 0) → **rollback 이 forward 를 clean 하게 역전**.
- post-probe 13종 전부 `absent:true` (round-trip 후 잔존 0).

**종합: RUN A PASS · RUN B PASS → 무영속 dry-run PASS.** prod 영속 0(sentinel-bypass 차단 구조 + 사후 부재 실측 이중).

---

## 2. Migration Ledger 정합 (net-new = clean)

prod `supabase_migrations.schema_migrations` 실측:
- `version = '20260822010000'` → **0 rows** (net-new, 원장 미등록 = 재적용/OOB 충돌 없음).
- 최신 5건 = `20260821170000` > … → 신규 버전 `20260822010000` **단조 증가**(gap/collision 0).
- 대상 오브젝트 prod 실재 = 전부 `present:false`(`progress_analysis_slips`/`_audit_log`/`progress_result_images.slip_id`) → **부분적용/드리프트 잔재 0**.

→ `mig_ledger_check: net-new=clean` (3자 divergence 없음).

---

## 3. change-class 재확인 (supervisor ① DDL-diff PASS 정합)

ADDITIVE — 신규 테이블 2 + `progress_result_images` additive 컬럼 5 + 정책/트리거/인덱스. **DROP·타입변경·소급변형 0.** DA 4대판정 1:1 정합(후보B / `slips.reservation_id` UNIQUE plain / soft-delete 위치=images(slip=state revert) / 삭제술어=reservation_id 등가 ONLY). soft-delete canonical = `deleted_at` 단일 authority + `is_deleted` GENERATED(form_submissions 선례 미러, mutable bool 아님) — 2차 DA jrwf 확정과 형태 일치(무변).

---

## 4. AC-0 준수 (apply 아님)

본 evidence 는 **dry-run 무영속 재현**일 뿐 apply 가 아니다. prod DDL/GRANT 선집행 0(sentinel 롤백). 실제 prod apply = **supervisor 물리 GO-token 서명 後** `db_apply_guard.sh <ticket> <sql>` prod lane 으로만. §6 노쇼 자동폐기 트리거 실배선 = 스키마 GO ∧ reporter confirm(hxdj) 後 별도 마이그(현 게이트 범위 밖).

---

## 재현 커맨드

```
node scripts/T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE_dryrun.mjs
# → RUN A PASS / RUN B PASS / ✅ no-persistence dry-run PASS
```
