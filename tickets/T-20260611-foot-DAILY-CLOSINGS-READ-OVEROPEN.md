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
revised: 2026-06-11
policy_correction: jnz7 (김주연 총괄 직접 — 일마감 ≠ 매출집계, §13.1.A reporter-authorized)
parent: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY
parent_ref: WS-2
supersedes: planner MSG-20260611-135000-b4sj #2 (D-7 EXCL+LOCK) — reporter 정정으로 SUPERSEDE
db_gate_status: submitted-awaiting-supervisor (revise 본)
withdrawn_migration: 20260611180000_closing_revenue_read_lock (.sql.WITHDRAWN — 적용 금지)
active_migration: 20260611200000_closing_workflow_read_canonical
data_architect_consult: not-required (RLS only, no new column/table/enum)
deploy_ready_marked_by: agent-fdd-dev-foot
deploy_ready_at: 2026-06-11
build_status: pass
dry_run_status: PASS
spec_added: tests/e2e/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN.spec.ts
db_migration_pending: true
---

# T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN — 일마감 workflow read 보안 하드닝 (REVISE: LOCK→OPEN 정정)

## ★ 정책 정정 (김주연 총괄 직접, MSG-...185107-jnz7 / §13.1.A reporter-authorized) ★
> **일마감(daily closing workflow — 직원이 일일 마감 수행) = staff OPEN.** 직원이 일마감 메뉴 클릭 → 정상 진입해야 함(대시보드 튕김=버그).
> **매출집계(실장별·치료사별 성과 집계) = staff EXCL 유지.** 관리자 영역. (별도 /admin/sales — 본 티켓 무관.)

이전 본(planner b4sj #2: D-7 EXCL+LOCK)은 **'일마감'을 '매출집계'로 오분류** → 일마감 수행 직원을 막아 NAV-BOUNCE 악화. 본 티켓이 그 revise.

## 분류 실측 (FE 라우트·쿼리·스키마)
- `daily_closings` / `closing_manual_payments` = **일마감 workflow** (`/admin/closing`, `Closing.tsx`, 제목 "일마감"; daily_closings 직접 insert/update). 매출집계 '뷰' 아님.
- **매출집계(실장별·치료사별 성과)** = 별도 `/admin/sales`(`Sales.tsx`) → `payments`/`package_payments`/`package_sessions` 직접 쿼리(daily_closings 미사용). route+nav admin/manager EXCL — 이미 직원 숨김. 본 티켓 미접촉.

## 일마감 수행 role
전직원 **8역할(tm 제외)** = `ALL_STAFF_ROLES`. 근거: 총괄 "일마감=직원 업무" + 기존 `daily_closings_staff_read=is_floor_staff()`(T-20260520-STAFF-DAILY-READ) + finance(consultant/coordinator). tm=최소권한(STAFF-ROLE-TM-ADD) 메뉴 제외.

## 수정
**DB (over-open 제거 = 보안 하드닝만, 일마감 role 잠금 0):**
- daily_closings: `daily_closings_read` `true` → `is_approved_user() AND clinic_id = current_user_clinic_id()` (canonical clinic-scoped). finance_read(coordinator 포함)·staff_read·therapist_read = **유지(삭제·축소 안 함)**.
- closing_manual_payments: `closing_manual_read` `true` → canonical clinic-scoped.
- ★이전 LOCK 의 therapist_read DROP / coordinator 회수 = 취소.★

**FE (3-gate 파리티 — 전직원 8역할, tm 제외):**
- AdminLayout nav + PERM_MATRIX.closing + App.tsx route 세 게이트 동일 집합 정렬(메뉴=route → NAV-BOUNCE 차단).
- 매출집계(/admin/sales) admin/manager 유지(미접촉).

## 산출
- 마이그: `supabase/migrations/20260611200000_closing_workflow_read_canonical.sql` (+ rollback)  ★기존 180000=.WITHDRAWN★
- dry-run: `scripts/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN_dryrun.mjs` → **PASS**(트랜잭션 적용→검증→ROLLBACK, prod 무변경)
- E2E: `tests/e2e/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN.spec.ts` (4 tests)
- 증빙: `db-gate/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN_evidence.md`
- FE: AdminLayout.tsx / permissions.ts / App.tsx closing 3-gate OPEN, build OK(3.69s)

## AC
- AC-3(정정): 일마감 수행 role OPEN — read 미축소 + FE 3-gate 전직원 파리티. NAV-BOUNCE 해소.
- AC-5: clinic_id 스코프(보안) — over-open(true)→clinic 고정, 타 clinic 누수 차단.
- AC-4: 쓰기 정책(daily_closings ALL×2, closing_manual insert/update/delete) 미접촉(dry-run 검증).
- AC-6: blanket-open(true) 제거 = 미승인 authenticated 차단.
- 매출집계 EXCL 불변(별도 /sales 미접촉).

> db_change=true → **supervisor DB 게이트 적용 전까지 운영 미반영.** 기존 180000 적용 금지, 200000(revise 본)으로 교체. 마이그·롤백·dry-run(PASS)·증빙 제출 완료.
