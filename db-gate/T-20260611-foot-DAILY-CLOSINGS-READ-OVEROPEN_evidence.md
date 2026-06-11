# T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN — DB-gate 제출 (dev-foot)

- prod: rxlomoozakkjesdqjtvd
- 작성: dev-foot, 2026-06-11
- 출처: planner MSG-20260611-135000-b4sj #2 — D-7 daily_closings/closing_manual = EXCL 확정 + LOCK(회수) **우선**(역방향 누수=보안, Phase2-A 보다 우선)
- 우산: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY WS-2 집행 child
- 마이그: `supabase/migrations/20260611180000_closing_revenue_read_lock.sql`
- 롤백:  `supabase/migrations/20260611180000_closing_revenue_read_lock.rollback.sql`
- dry-run: `scripts/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN_dryrun.mjs`
- FE: `src/App.tsx`(closing RoleGuard) + `src/lib/permissions.ts`(PERM_MATRIX.closing) — coordinator/therapist 회수
- ★ daily_closings + closing_manual_payments 2 테이블만. SELECT readers 축소(잠금)만. 쓰기 미접촉 ★

## 정책 판정
매출집계(일마감 settlement) = **EXCL(파리티 제외, 민감)**. "권한 풀린 메뉴=데이터도 parity"의 **역** —
매출은 mgmt/finance/desk 한정이어야 하는데 현재 over-open(USING true) + coordinator + therapist 까지 read 가능 = **역방향 과다노출(누수, 보안)**.

## BEFORE (Phase 1 dump / dry-run BEFORE 일치)
```
daily_closings SELECT:
  daily_closings_finance_read   (is_consultant_or_above() OR is_coordinator_or_above())
  daily_closings_read           true                       ← ★over-open 누수
  daily_closings_staff_read     is_floor_staff()
  daily_closings_therapist_read is_therapist_or_technician()
closing_manual_payments SELECT:
  closing_manual_read           true                       ← ★over-open 누수
```

## 수정 (SELECT readers 축소 = 잠금/회수)
```
daily_closings:
  DROP daily_closings_read              (over-open 삭제)
  DROP daily_closings_therapist_read    (시술자 매출열람 회수)
  finance_read → is_consultant_or_above()  (coordinator 회수)
  daily_closings_staff_read(is_floor_staff) 유지  ← 데스크=일마감 수행 주체
closing_manual_payments:
  closing_manual_read → (is_consultant_or_above() OR is_floor_staff())  (true 회수, daily_closings reader set 동일)
```
회수 후 최종 reader set(두 테이블 동일): admin/manager/director ∪ consultant ∪ staff/part_lead/tm.
제거됨: **coordinator, therapist, technician, 미승인 authenticated(over-open).**

## dry-run 결과 (트랜잭션 적용→검증→ROLLBACK, prod 영속 변경 없음)
```
회귀가드 자동 점검:
  daily_closings over-open(USING true) 제거              : ✅
  daily_closings therapist_read 회수                     : ✅
  daily_closings finance_read coordinator 회수           : ✅
  daily_closings staff_read(is_floor_staff) 유지         : ✅
  closing_manual over-open 회수→consultant∪floor 게이트  : ✅
  AC-4 daily_closings 쓰기(ALL×2) 불변                   : ✅
  AC-4 closing_manual 쓰기(insert/update/delete) 불변    : ✅
→ DRY-RUN PASS
```

## AC 매핑
| AC | 충족 방식 |
|----|-----------|
| 누수 회수 | over-open(true)·coordinator·therapist read 제거 |
| AC-4 쓰기 불변 | daily_closings ALL×2, closing_manual insert/update/delete 미접촉(dry-run 검증) |
| AC-5 clinic 스코프 | daily_closings admin_all/write, closing_manual 쓰기정책이 clinic 경계 담당(미접촉) |
| AC-6 blanket-open 제거 | over-open(true) 삭제 = 누수 해소. 신규 blanket-open 미발생 |

## FE 정렬 (closing route 회수)
- `src/App.tsx` closing RoleGuard: `['admin','manager','consultant','coordinator','therapist']` → `['admin','manager','consultant']`
- `src/lib/permissions.ts` PERM_MATRIX.closing: coordinator/therapist 제거 → `['admin','manager','director','consultant','part_lead']`
- RLS reader(consultant_or_above ∪ floor_staff)와 메뉴 게이트 정렬. 단, T-20260520-foot-RBAC-MENU-EXPAND AC-1(coordinator/therapist 일마감 view)을 **의도적으로 일부 reverse**(김주연 총괄 escalation: 매출=제한). build OK(vite 4.00s).

## E2E
`tests/e2e/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN.spec.ts` (4 tests: DC-1 daily_closings 회수 / DC-2 closing_manual 잠금 / AC-4 쓰기 불변 / DC-FE PERM_MATRIX)

## 적용 절차 (supervisor)
1. `supabase/migrations/20260611180000_closing_revenue_read_lock.sql` 적용
2. 사후 검증: daily_closings SELECT 에 qual='true' 0건 / therapist_read 부재 / finance_read=is_consultant_or_above() / closing_manual_read 잠금
3. 회귀 시 rollback SQL (단, 적용 시 매출 over-exposure 누수 재발 — 보안 회귀)

## db_gate_status = (supervisor 판정 대기)
- RLS SELECT 정책 축소(2 테이블). 데이터 무손실. 백필 없음. 쓰기 불변. 신규 컬럼/테이블/enum 없음(data-architect CONSULT 불요).
