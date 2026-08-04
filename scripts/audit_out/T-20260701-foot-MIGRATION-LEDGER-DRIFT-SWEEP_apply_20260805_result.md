# T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP — apply 실행 결과 (2026-08-05)

**owner**: dev-foot
**gate**: supervisor DB-GATE-REPLY GO (MSG-20260805-073844-qy4f, supersedes 073824-og8c) — 배치 apply 승인
**분업**: DB 적용=dev / supervisor=사전승인(GO)+사후검증
**결론**: **배치 전건 이미 반영됨(verified no-op). 원장 정합 이미 복구 완료. force-reapply 미실행(표준 준수). 잔여 anomaly 1건(B2#3 version collision) → planner 에스컬레이션.**

## GO 필수 4단계 이행 결과

### #1 무영속 DRYRUN (Migration Dry-Run No-Persistence Protocol)
- `batch_dryrun.mjs` 실행. StageA #1/#2 top-level `BEGIN;/COMMIT;` txn-control strip 확인(INV-5), plpgsql exception-handler 실행.
- A#1/A#2/A#6/B1#1/B1#2 → pre==post ALL EQUAL(무영속 실측) PASS.
- **B1#4 rx_audit_log → 비-sentinel error**: `policy "rx_audit_log_insert" ... already exists`. probe pre==post EQUAL.
  - 함의: rx_audit_log 테이블+정책이 **이미 PROD 존재**(=이미 APPLIED). 그리고 해당 마이그는 bare `CREATE POLICY`(no IF NOT EXISTS/DROP IF EXISTS) = **비멱등** → 재apply 시 error. GO의 "전건 idempotent" 가정과 배치되는 실측.
- B2#3 → 1회 transient HTTP 502(Cloudflare Bad Gateway); 재조회로 해소(실패 아님).

### #2 track1 read-only sweep 재실행 → track1.json 갱신
- `track1_sweep.mjs` 재실행(READ-ONLY, Management API) → track1.json 최신화.
- **7 batch target 현재 상태(2026-08-05 실측)**:

| stage | version | verdict | in_ledger | PROD |
|---|---|---|---|---|
| A#1 staff_attendance | 20260618200000 | APPLIED | true | 객체 존재 |
| A#2 waiting_board | 20260628200000 | APPLIED | true | 객체 존재 |
| A#6 customers.language | 20260625140000 | APPLIED | true | 컬럼 존재 |
| B1#4 rx_audit_log | 20260611210000 | APPLIED | true | 테이블+RLS+2정책 |
| B1#1 phi_anon_revoke | 20260616010000 | UNKNOWN(revoke-only) | true | revoke 실효 |
| B1#2 anon_pii_leak | 20260629140000 | UNKNOWN(revoke-only) | true | revoke 실효 |
| B2#3 daily_room_status | 20260630200000 | APPLIED | true* | 정책 존재 |

  → 7건 전건 이미 PROD 반영 + 원장 기록됨(07-01 이후 타 티켓 경유 apply).

### #3 helper 경유 --apply
- **track3 원장백필 `--apply`**: 후보=APPLIED∧in_ledger=false = **0건**. 신규기록 0행. 원장 361행→361행(변동 0, exit 0). = verified no-op(전 APPLIED 마이그 이미 원장 기록).
- **StageA/B1/B2 `--apply`: 미실행(의도적)**. 근거: 7 target 전건 이미 APPLIED+in_ledger → 재apply 편익 0. rx_audit_log 등 비멱등 마이그 재apply = error(dry-run 실증). Migration Ledger Reconciliation 표준(정본=PROD 실재 수렴, force-reapply/종이 db-repair 금지) 준수.

### #4 3-way 원장 대조 (schema_migrations ↔ PROD 실재 ↔ 파일선언)
- `postapply_reconcile.mjs` (READ-ONLY) → **전건 PASS (exit 0)**:
  - ① 7 target 전건 원장 기록 ✅
  - ② casualty 실물 해소: rx_audit_log(table+RLS+insert/select 정책), daily_room_status_staff_unlock_6menu 정책 + 기존3정책(admin_manager_write/approved_read/staff_own_write) 무접촉 보존, staff_attendance, waiting_board, customers.language 전건 존재 ✅
  - ③ revoke-only 실효: anon SELECT on insurance_claims/claim_items/insurance_claim_diagnoses/edi_submissions = false, staff/user_profiles SELECT=false, customers/check_ins DELETE=false, reservations INSERT=false. 셀프체크인 보존 verb(customers/check_ins/reservations SELECT·UPDATE) 후속 lockdown 소관 무변경 ✅
  - ④ 원장 6/09 정지(118행/20260609234500) 해소: **361행 / max 20260804200000** 전진 ✅

## 잔여 anomaly (배치 밖, 에스컬레이션 필요)
**B2#3 version collision**: forward 마이그 2건이 동일 prefix `20260630200000` 공유:
- `20260630200000_daily_room_status_staff_unlock_6menu_rls_additive.sql` (B2#3 target)
- `20260630200000_notif_tmpl_write_staff_roles_align.sql`

schema_migrations PK=version(단일 14자리) → 20260630200000 슬롯을 notif_tmpl(created_by=dev-foot:NOTIF-TMPL-RLS-CODY-UNLOCK)이 점유. daily_room_status DDL은 PROD 적용됨(정책 실재, ②에서 확인)이나 원장에서 자기 file명으로 distinct 추적 불가. helper 재기록 시도해도 ON CONFLICT DO NOTHING = notif_tmpl 유지.
- class: version-collision-renumber (precedent T-20260714-COPAYMENT-LEDGER-RECONCILE, T-20260802-DAYCLOSE-VERSION-COLLISION-RENUMBER).
- 조치: 파일 renumber + 원장 정합 = 별도 티켓(파일선언 변경 → DA/supervisor 게이트). 본 배치 GO 범위 밖. planner FOLLOWUP 발행.

## 범위 밖 (GO 명시 후속 배치)
StageC(#5/#7/#8★/#9/#10/#11) 미착수. #8 doc_serial_harden 별도 배치 실행확인 필수.
