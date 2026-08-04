# T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP — 배치 apply 증적

**apply 일시**: 2026-08-05 KST (macstudio, obliv-foot-crm prod rxlomoozakkjesdqjtvd)
**게이트**: supervisor DDL-diff GO (MSG-20260805-073824-og8c, verdict GO 전건 PASS)
**분업**: DB 적용=dev-foot / supervisor=사전 GO(본) + 사후검증(to_regclass·pg_policies 실재 + 원장 전진 → deployed 마킹)

## apply 전 필수 4단계 (supervisor GO 지정) — 전건 이행

### ① 무영속 DRYRUN 선행 (Migration Dry-Run No-Persistence Protocol v1.0)
러너: `dryrun_lib.mjs` (txn-control strip + plpgsql exception-handler + post-probe) 위에
배치 드라이버 `..._batch_dryrun.mjs`(pre==post 등가 판정). **전건 PASS**.

| stage | 파일 | stripped txn-control | probe | pre==post |
|---|---|---|---|---|
| A#1 | staff_attendance_ssot | `["BEGIN;","COMMIT;"]` | 6 | ALL EQUAL ✓ |
| A#2 | waiting_board_projection | `["BEGIN;","COMMIT;"]` | 8 | ALL EQUAL ✓ |
| A#6 | foreign_lang_customers_language | `["BEGIN;","COMMIT;"]` | 1 | ALL EQUAL ✓ |
| B1#4 | rx_audit_log | (none) | 7 | ALL EQUAL ✓ |
| B1#1 | phi_anon_grant_revoke_hardening | `["BEGIN;","COMMIT;"]` | 28 | ALL EQUAL ✓ |
| B1#2 | anon_pii_leak_revoke_phase1 | `["BEGIN;","COMMIT;"]` | 35 | ALL EQUAL ✓ |
| B2#3 | daily_room_status_staff_unlock_6menu | `["BEGIN;","COMMIT;"]` | 4 | ALL EQUAL ✓ |

★ supervisor 경고(StageA #1/#2 파일 내장 `BEGIN;…COMMIT;` = sentinel-bypass hazard) 대응 실증:
top-level `BEGIN;`/`COMMIT;` 를 strip 후 plpgsql `DO … EXCEPTION` 격리 실행 → sentinel RAISE 롤백.
89개 probe 전건 pre==post = **prod 상태 1비트 무변경(무영속)** 실측.

### ② track1 read-only sweep 재실행 → track1.json 갱신 (07-01 이후 ~1개월 상태 변동 반영)
`..._track1_sweep.mjs` 재실행. PROD write 0. 결과(신규): APPLIED 248 / MISSING 12 / DRIFT 9 / UNKNOWN 73.
07-01 대비 변동: StageA 3건 = MISSING→APPLIED(타 티켓 경유 apply). 백필 후보 79→**109**(최신 실측 기준).

### ③ helper 경유 `--apply` (schema_migrations 원장 자동기록) — 전건 idempotent
| 배치 | 결과 | 원장 |
|---|---|---|
| track3 원장백필 | 109 기록 / 0 실패 | 260 → 358행 (net +98, dup-timestamp 11건 ON CONFLICT no-op) |
| StageA (#1/#2/#6) | 3 적용 / 0 실패 | 기적용분 idempotent no-op + ON CONFLICT no-op |
| StageB1 (#4 rx_audit_log·#1 phi·#2 pii) | 3 적용 / 0 실패 | 358 → 361행 |
| StageB2 (#3 daily_room_status) | 1 적용 / 0 실패 | ON CONFLICT no-op |

### ④ 3-way 원장 대조 (schema_migrations 원장 ↔ PROD 실재 ↔ 파일선언) — `..._postapply_reconcile.mjs`
**종합: ✅ 전건 PASS**
- **원장 정합**: 7 target version 전건 schema_migrations 존재.
- **casualty 실물 해소**: `rx_audit_log` 테이블+RLS+2정책 존재(MISSING→해소), `daily_room_status_staff_unlock_6menu` 정책 존재(MISSING→해소), staff_attendance/waiting_board/customers.language 실재.
- **기존3정책 무접촉 불변식**: daily_room_status 기존 3정책(admin_manager_write/approved_read/staff_own_write) 보존.
- **revoke 실효(tighten-only)**: phi 4테이블(insurance_claims/claim_items/insurance_claim_diagnoses/edi_submissions) anon SELECT=false, staff/user_profiles anon SELECT=false, customers/check_ins anon DELETE=false, reservations anon INSERT=false.
- **원장 6/09 정지 해소**: 총 361행, max=20260804200000 (구 정지점 20260609234500 → 전진).

## 안전성 노트 — anon SELECT posture
`anon_pii_leak_revoke_phase1` SQL 은 customers/check_ins/reservations 의 **SELECT/UPDATE 를 REVOKE 하지 않음**
(회수 대상 = DELETE/TRUNCATE/REFERENCES/TRIGGER + reservations INSERT 뿐). 현재 anon SELECT=false 는
**후속 lockdown 티켓**(20260720232000_customers_anon_select_lockdown, 20260703160000_anon_reservation_read_scopedown,
kiosk Gate-C 컷오버) 소관이지 본 배치 무관. dry-run pre==post(35 pii probe 전건 등가)가
**본 배치의 anon posture 변경 0**을 실측 — revoke-only 전건은 방향상 tighten(fail-closed)만 가능, GRANT 문 0.

## 범위 밖 (본 배치 미포함)
StageC(#5/#7/#8★/#9/#10/#11) = 후속 배치. **#8 doc_serial_harden = apply스크립트 존재하나 미실행 이력 → 별도 배치 실행 확인 필수**.

## 운영 하드닝(비-semantic)
- `foot_migration_ledger.mjs query()`: Management API 429 지수 백오프 재시도 내장(전 apply SQL idempotent → 재시도 안전).
- `track3_ledger_backfill.mjs`: 109행 순차 백필 throttle 회피 350ms 간격.
