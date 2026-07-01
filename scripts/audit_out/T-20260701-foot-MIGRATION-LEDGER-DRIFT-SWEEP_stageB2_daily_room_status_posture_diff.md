# Stage B2 — daily_room_status RLS 포스처 diff (B2 HOLD 해소 증거)

- 티켓: T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP (Stage B2)
- 대상 마이그: `20260630200000_daily_room_status_staff_unlock_6menu_rls_additive`
- 요청: planner NEW-TASK MSG-20260701-110653-9wia — "현재 PROD RLS 포스처 vs 마이그 의도 diff 제출. 재apply가 포스처를 되돌리지/완화하지 않음을 입증 → DA 재판정 후 GO 전환."
- 방법: **read-only** `pg_policy`/`pg_class`/`role_table_grants` 실측 (2026-07-01, PROD rxlomoozakkjesdqjtvd). PROD write 0.

## 1. PROD 현재 포스처 (실측 3 정책)

| # | polname | cmd | permissive | roles | qual(USING) |
|---|---------|-----|-----------|-------|-------------|
| A | daily_room_status_admin_manager_write | ALL | PERMISSIVE | authenticated | `is_admin_or_manager()` |
| B | daily_room_status_approved_read | SELECT | PERMISSIVE | authenticated | `is_approved_user()` |
| C | daily_room_status_staff_own_write | ALL | PERMISSIVE | authenticated | `staff ∧ 본인배정방(room_assignments)` |

- RLS: `relrowsecurity=true` (ENABLE), force=false.
- **target 정책 `daily_room_status_staff_unlock_6menu` = PROD 부재** → Track1 casualty(MISSING) 확정.

## 2. 마이그 의도 (end-state)

기존 A/B/C 유지 + 신규 1 정책 추가:

| polname | cmd | permissive | roles | 술어 |
|---------|-----|-----------|-------|------|
| daily_room_status_staff_unlock_6menu | ALL | PERMISSIVE | authenticated | `role ∈ {consultant,coordinator,therapist} ∧ clinic_id = current_user_clinic_id()` (USING ≡ WITH CHECK) |

- SQL: `DROP POLICY IF EXISTS daily_room_status_staff_unlock_6menu` → `CREATE POLICY ... PERMISSIVE FOR ALL`. GRANT/REVOKE/ALTER DEFAULT PRIVILEGES **없음**.

## 3. Diff 판정 — 되돌림/완화 여부

| 검사 | 결과 |
|------|------|
| target 정책이 이미 PROD 존재? | **아니오**(부재) → DROP IF EXISTS = no-op, CREATE = 순수 추가 |
| 기존 A/B/C 정책을 DROP/변경/축소? | **아니오** — 마이그가 참조하는 정책명은 `staff_unlock_6menu` 단 1개. A/B/C 무접촉 |
| PERMISSIVE(OR 확장) vs RESTRICTIVE(AND 제약)? | **PERMISSIVE** → 기존 허용의 OR 확장. 누구의 기존 write 도 회수/축소 안 됨(lock-out 0) |
| USING ≡ WITH CHECK? | **일치**(DA GO 조건 A 충족) — read/write 술어 비대칭 우회 0 |
| GRANT/보상 grant/ALTER DEFAULT PRIVILEGES 혼입? | **없음** — grant 포스처 무변경 |
| clinic 격리? | 유지(`clinic_id = current_user_clinic_id()`) — cross-clinic write 확대 0 |

### ✅ 결론
**재apply는 포스처를 되돌리거나 완화하지 않는다.** 유일 효과 = consultant/coordinator/therapist 3역할에 **clinic 격리된** 방토글 write 를 **추가**(PERMISSIVE 확장) — 원 DA GO(MSG-20260630-212502-c6av)의 의도 그대로. = drift-reconciliation(원장 미기록으로 PROD 누락된 ADDITIVE 정책 복원), 포스처 regression 아님.

→ **B2 = GO 전환 권고**. planner 경유 DA 재판정 요청. GO 시 Stage B1 배치에 합류 또는 후속 배치로 supervisor DDL-diff → helper 경유 apply.

## 4. side-observation (B2 scope 밖·비차단 — 별건 플래그)

`daily_room_status` 에 **anon table-level GRANT 전권 잔존**(SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER). RLS ENABLE + 전 정책이 authenticated 대상이라 anon row=0(기능 leak 없음)이나, #1/#2 가 PHI 테이블에 적용한 §12-6 defense-in-depth 백스톱이 이 테이블엔 미적용. **단, daily_room_status = 비-PHI·비-금전(당일 방 on/off 운영상태)** → 우선순위 LOW. #3 마이그 DDL 과 무관(재apply 판정에 영향 0). 별도 anon-hardening 스윕 대상으로만 기록(본 배치 비포함).
