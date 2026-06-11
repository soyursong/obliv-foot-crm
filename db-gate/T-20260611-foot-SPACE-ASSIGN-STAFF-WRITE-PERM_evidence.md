# DB 게이트 제출 — T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM

- **티켓**: T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM (P2, approved, GO_WARN)
- **reporter**: 김주연 총괄 (U0ATDB587PV / #project-doai-crm-풋확장)
- **요청**: 공간배정(상담실/치료실/레이저실)에서 직원(staff) 계정이 권한 막혀 저장 불가, 관리자만 가능 → 공간배정 WRITE 권한을 직원 운영 role 에 scoped 부여.
- **db_change**: true → ★supervisor DB 게이트 필수 (운영 미적용, dry-run ROLLBACK 검증만)
- **data-architect consult**: not-required (RLS + 기존 RPC 본문 술어 교체만. 신규 컬럼/테이블/enum 0). 부모 parity 티켓 선례(`data_architect_consult: not-required, RLS only`) 동일.
- **선행 의존**: T-20260611-foot-SPACE-RESET-RECUR5 Phase B(`93c336f`) **main 머지 확인 완료** — 본건은 그 carry-over/미터치방 보존 패턴 위에 권한만 확대.

---

## Phase 1 — 차단 원인 판별 (AC-1, read-only 진단)

차단은 **FE 메뉴/버튼 게이트가 아니라 백엔드 2지점**으로 확정:

| 경로 | 코드 | 차단 원인 |
|------|------|-----------|
| 일간 저장 (Staff.tsx `handleSave`) | `supabase.rpc('save_room_assignments')` | RPC 내부 가드 `IF NOT is_admin_or_manager()` → 직원 RAISE EXCEPTION (SECURITY DEFINER 라 RLS 무관, 가드가 게이트) |
| 주간 저장 (Staff.tsx `handleWeekAssign`) | 직접 `.insert()` / `.update()` | INSERT: `room_assignments_admin_all`(mgmt) 단독 → 직원 INSERT 차단. UPDATE: `room_assignments_staff_update`(is_floor_staff)는 consultant/coordinator/therapist 누락 |
| 대시보드 배정 (Dashboard.tsx `handleStaffAssign`) | 직접 `.insert()` / `.update()` | 동일 (INSERT 차단 / UPDATE role 갭) |

- FE 저장 버튼: role 게이트 **없음**(`disabled={saving}` 뿐) → **FE 변경 불요**. Staff 라우트 가드(admin/manager/consultant/coordinator/therapist)도 미변경(접근 가능 role 의 write 만 막혀 있었음).
- → **최소 변경 = 백엔드(RLS+RPC)만**. 불필요한 FE 변경 회피.

---

## 변경 요약 (room_assignments 단일 테이블 + 2 함수만)

마이그: `supabase/migrations/20260611220000_room_assignments_staff_write_scoped.sql`
롤백: `supabase/migrations/20260611220000_room_assignments_staff_write_scoped.rollback.sql`

| # | 변경 | 내용 |
|---|------|------|
| A | 헬퍼 `can_assign_rooms()` 신규 | `is_approved_user() AND role IN (운영 8 role)`. ★tm 제외★(STAFF-ROLE-TM-ADD 최소권한). FE `ALL_STAFF_ROLES` SSOT 동일 집합. SECURITY DEFINER. |
| B | RPC `save_room_assignments` 가드 교체 | `is_admin_or_manager()` → `can_assign_rooms()`. **원자 DELETE+INSERT 본문 / clinic 가드 / NULLIF unassign 처리 전부 동일**(RECUR5 보존). |
| C | `room_assignments_assign_insert` (신규 INSERT) | `can_assign_rooms() AND clinic_id = current_user_clinic_id()`. |
| D | `room_assignments_assign_update` (신규 UPDATE) | USING+WITH CHECK `can_assign_rooms() AND clinic_id = current_user_clinic_id()`. consultant/coordinator/therapist 갭 충전. |

**미접촉(회귀 0)**: `room_assignments_admin_all`(ALL, mgmt) · `room_assignments_approved_read`(SELECT) · `room_assignments_staff_update`(is_floor_staff UPDATE, **tm 포함 보존**).

---

## 범위 한정 / 회귀가드 (AC 매핑)

- **AC-2 (직원 write)**: 일간(RPC can_assign_rooms)·주간/대시보드(assign_insert/update) 모두 직원 반영. unassign = staff_id=NULL UPDATE/INSERT.
- **AC-3 (blanket 금지)**: `room_assignments` **단일 테이블 + 2 함수만** ALTER. 급여/정산/감사로그 등 민감 write 미개방. (dry-run: 신규 정책 타 테이블 0건)
- **AC-4 (clinic 스코프)**: 신규 INSERT/UPDATE WITH CHECK + RPC 가드 모두 `current_user_clinic_id()` 강제 → 타 clinic 방배정 write 불가.
- **AC-5 (DELETE 미부여)**: 직원 DELETE 정책 **추가 안 함** (DELETE 전용 정책 0건, 행 삭제는 admin_all 단독). RPC 내부 DELETE 는 SECURITY DEFINER 소유자 권한 — 직원에게 테이블 DELETE 권한 부여 아님(가드로만 게이트).
- **AC-6 (RECUR5 정합)**: RPC 원자 DELETE+INSERT + FE live-merge(미터치방·null-row 보존·room별 prior-latest carry-over) 로직 미변경. 권한만 확대 → blind-overwrite/reset(RECUR6) 유발 안 함.
- **AC-7 (admin 회귀)**: admin/floor staff 경로 정책·RPC 본문 미변경 → 회귀 0.

---

## dry-run 결과 (트랜잭션 적용 → 검증 → ROLLBACK, prod 무변경)

스크립트: `scripts/T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM_dryrun.mjs` → **PASS**

```
── AFTER room_assignments 정책 (미커밋) ──
  room_assignments_admin_all      [ALL]     ← 미변경
  room_assignments_approved_read  [SELECT]  is_approved_user()          ← 미변경
  room_assignments_assign_insert  [INSERT]  WITH CHECK: (can_assign_rooms() AND (clinic_id = current_user_clinic_id()))  ← 신규
  room_assignments_assign_update  [UPDATE]  USING/WITH CHECK: (can_assign_rooms() AND (clinic_id = current_user_clinic_id()))  ← 신규
  room_assignments_staff_update   [UPDATE]  is_floor_staff()            ← 미변경(tm 보존)

✅ 의존 헬퍼 존재
✅ (A) can_assign_rooms 생성 + tm 제외 + consultant 포함
✅ AC-2 RPC 가드 can_assign_rooms 로 교체(+clinic 보존, is_admin_or_manager 제거)
✅ AC-2/4 assign_insert = INSERT canonical(can_assign_rooms+clinic)
✅ AC-2/4 assign_update = UPDATE canonical USING+WITH CHECK(can_assign_rooms+clinic)
✅ AC-5 직원 DELETE 정책 미부여(DELETE 전용 0건)
✅ AC-7 admin_all/approved_read/staff_update 술어 미변경
✅ AC-5/7 staff_update 가 is_floor_staff 보존(tm UPDATE 회귀 0)
✅ AC-3 신규 정책 room_assignments 한정
↩️  ROLLBACK 완료 — prod 영속 변경 없음.
✅ DRY-RUN PASS
```

E2E: `tests/e2e/T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE.spec.ts` (6 tests, pg_policies/pg_proc 단정 — 시나리오 1~5 + AC-7).

---

## §13.1.A 정책 정합 (parity 충돌 해소)

- parity 티켓 `T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY` AC-4(write=manager-only)와 **표면 충돌**.
- 해소: parity 우산 = **PHI/공유메뉴 READ parity**. 본건 = **운영(non-PHI) feature(공간배정) WRITE scoped 예외**. 상호 배타 아님 — dev-foot 가 SELECT(parity 소관) vs INSERT/UPDATE(본건 소관) 분리 적용.
- §13.1.A 절차: reporter(김주연 총괄)가 곧 parity 정책 owner 이며 "직원도 공간배정 수정 가능해야" 명시 요청 → **reporter 예외로 approved**(blocked/DECISION-REQUEST 불요).
- 향후 "공간배정 직원 write" 단건 요청은 본 티켓으로 라우팅.

---

## supervisor 적용 가이드

1. 운영 적용 전 dry-run 재현 권장(`node scripts/T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM_dryrun.mjs`).
2. `supabase db push` 또는 마이그 직접 적용 → 검증 쿼리(마이그 하단 주석) 실행:
   - room_assignments write 정책 5종 + DELETE 전용 0건 확인.
   - `SELECT prosrc FROM pg_proc WHERE proname='save_room_assignments'` → `can_assign_rooms()` 포함.
3. 실패/이상 시 `..._room_assignments_staff_write_scoped.rollback.sql` 적용.
4. ★ blanket ALTER 금지 — room_assignments + can_assign_rooms/save_room_assignments 2 함수만 대상.
