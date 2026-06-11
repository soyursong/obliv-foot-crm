---
id: T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN
domain: foot
type: security-hardening
priority: P1
status: deploy-ready
db_change: true
gate: GO
owner: agent-fdd-dev-foot
created: 2026-06-11
parent: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY
parent_ref: WS-2
db_gate_status: submitted-awaiting-supervisor
data_architect_consult: not-required (RLS only, no new column/table/enum)
deploy_ready_marked_by: agent-fdd-dev-foot
deploy_ready_at: 2026-06-11
build_status: pass
spec_added: tests/e2e/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN.spec.ts
db_migration_pending: true
---

# T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN — 매출집계 read over-exposure 회수 (LOCK)

## 정책 (planner MSG-20260611-135000-b4sj #2)
> D-7 daily_closings/closing_manual = **EXCL 확정 + LOCK(회수) 우선**.
> 역방향 누수=보안 → Phase2-A(C그룹)보다 우선. closing route coordinator/therapist 노출분도 회수.

매출집계(일마감 settlement)는 파리티 정책의 **역** — over-open(USING true) + coordinator + therapist 까지 read 가능 = 과다노출(누수).

## RC (Phase 1 raw dump)
- `daily_closings_read` USING `true` = 미승인 authenticated 포함 전원 read (over-open).
- `daily_closings_therapist_read` = is_therapist_or_technician() (시술자 매출열람).
- `daily_closings_finance_read` = consultant_or_above **OR coordinator_or_above** (coordinator 포함).
- `closing_manual_payments.closing_manual_read` USING `true` (over-open).

## 수정 (SELECT readers 축소)
- daily_closings: DROP over-open + therapist_read, finance_read → is_consultant_or_above() (coordinator 회수), staff_read(is_floor_staff) 유지(데스크=일마감 수행 주체).
- closing_manual_payments: read → (is_consultant_or_above() OR is_floor_staff()).
- FE closing route(App.tsx RoleGuard + permissions.ts PERM_MATRIX): coordinator/therapist 회수.
- 최종 reader set(두 테이블 동일): admin/manager/director ∪ consultant ∪ floor_staff(staff/part_lead/tm).

## 산출
- 마이그: `supabase/migrations/20260611180000_closing_revenue_read_lock.sql` (+ rollback)
- dry-run: `scripts/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN_dryrun.mjs` → **PASS**(트랜잭션 적용→검증→ROLLBACK, prod 무변경)
- E2E: `tests/e2e/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN.spec.ts` (4 tests)
- 증빙: `db-gate/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN_evidence.md`
- FE: App.tsx / permissions.ts closing 회수, build OK

## AC
- 누수 회수: over-open(true)·coordinator·therapist read 제거.
- AC-4: 쓰기 정책(daily_closings ALL×2, closing_manual insert/update/delete) 미접촉(dry-run 검증).
- AC-5: clinic 스코프 — 쓰기 정책이 담당(미접촉).
- AC-6: blanket-open(true) 제거 = 누수 해소.

> db_change=true → **supervisor DB 게이트 적용 전까지 운영 미반영.** 마이그·롤백·dry-run·증빙 제출 완료.
