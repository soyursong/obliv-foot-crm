# #C can_assign_rooms — 8-role 권한 전후 회귀검증 plan (GO-conditional, #A 후순위)

- 마이그: `supabase/migrations/20260611220000_room_assignments_staff_write_scoped.sql`
- DRIFT: prod 에 구버전 `save_room_assignments`(is_admin_or_manager 가드) 잔존 / `can_assign_rooms()` + 신규 RLS 미적용.
- 적용 게이트: DA CONSULT + supervisor 검증. RLS 정책 교체 동반이므로 **권한 전후 회귀 필수**.
- 현 상태: prod 가 더 제한적(admin/manager만) → 보안 완화 아님. 기능 drift(비관리 직원 방배정 차단).

## 적용 객체 (idempotent, BEGIN/COMMIT)
- (A) `can_assign_rooms()` 헬퍼 신규 (approved + 8 role, tm 제외)
- (B) RPC `save_room_assignments` 가드: is_admin_or_manager → can_assign_rooms
- (C) `room_assignments_assign_insert` (신규 INSERT 정책, can_assign_rooms + clinic)
- (D) `room_assignments_assign_update` (신규 UPDATE 정책, consultant/coordinator/therapist 갭 충전)

## 8-role × 동작 기대 매트릭스 (적용 후)
| role | RPC 일간저장 | INSERT(주간/대시) | UPDATE | DELETE |
|------|:---:|:---:|:---:|:---:|
| admin / manager / director | ✅(기존) | ✅ | ✅ | ✅(admin_all 유지) |
| consultant / coordinator / therapist | ✅(신규 허용) | ✅(신규) | ✅(갭 충전) | ❌(미부여, AC-5) |
| part_lead / staff | ✅(신규 허용) | ✅(신규) | ✅(기존 is_floor_staff∪신규) | ❌ |
| **tm** | ❌(제외 유지) | ❌ | ❌ | ❌ |
| anon / 미승인 | ❌ | ❌ | ❌ | ❌ |

## 회귀 가드 (절대 검증)
- AC-5 DELETE 미부여: `pg_policies` 에서 room_assignments DELETE 직원 정책 **0건** (admin_all ALL 만).
- AC-7 admin 회귀 0: admin_all / approved_read / staff_update / RPC 본문 미변경.
- tm 제외: can_assign_rooms() 가 tm 에 false (tm=4메뉴 최소권한 보존).
- clinic 스코프: 신규 INSERT/UPDATE WITH CHECK + RPC 가드에 clinic_id = current_user_clinic_id().

## 검증 쿼리 (적용 후, supervisor 수동)
```sql
-- 1) 정책 4종 + DELETE 직원 0건
SELECT policyname, cmd, roles FROM pg_policies
 WHERE schemaname='public' AND tablename='room_assignments' ORDER BY cmd, policyname;
-- 2) RPC 가드 교체
SELECT prosrc FROM pg_proc WHERE proname='save_room_assignments';  -- can_assign_rooms 포함
-- 3) 헬퍼 GRANT (anon REVOKE)
SELECT has_function_privilege('anon','public.can_assign_rooms()','EXECUTE') AS anon_exec,        -- false 기대
       has_function_privilege('authenticated','public.can_assign_rooms()','EXECUTE') AS auth_exec; -- true
```
- E2E 회귀: `tests/e2e/T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE.spec.ts` (기존) 재실행 + 8-role 시나리오 보강.

## 순서
1. #A 배치 적용·검증 완료 후 착수.
2. DA CONSULT(RLS 권한확대) GO → supervisor 검증 → 적용 → 위 매트릭스 confirm.
3. 갤탭 현장: 비관리 직원 계정으로 공간배정 저장 성공 확인(현장 confirm 후 done).
