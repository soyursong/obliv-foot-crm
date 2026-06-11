# T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY — Phase 2-A / G2 (clinic_events) DB-gate 제출 (dev-foot)

- prod: rxlomoozakkjesdqjtvd
- 작성: dev-foot, 2026-06-11
- 출처: planner 게이트 판정 MSG-20260611-134442-gsgf (P1, db_change=true) — G2 OPEN 확정
- 마이그: `supabase/migrations/20260611160000_clinic_events_select_rls_canonical.sql`
- 롤백:  `supabase/migrations/20260611160000_clinic_events_select_rls_canonical.rollback.sql`
- dry-run: `scripts/T-20260611-foot-RLS-PARITY-G2-clinic_events_dryrun.mjs` (트랜잭션 적용→검증→ROLLBACK)
- 감사 근거: `scripts/audit_out/T-20260611-RLS-PARITY_phase1_dump.txt` (Phase 1 raw, READ-only)
- ★ 본 제출은 G2(clinic_events) 단일 테이블만. blanket ALTER 아님. 테이블별 단계 적용 ★

## 대상 한정 (G1 분리)
- **G2 clinic_events = 본 제출**: SELECT 정책이 비정규 `staff.id=auth.uid()` → 정규 전환. 확정 GO.
- **G1 check_in_room_logs = 본 제출 제외(HOLD)**: Phase 1 raw dump 가 planner 판정의 전제
  (staff.id=auth.uid OUTLIER→전원 deny)와 **불일치**. 실제 정책은 `room_logs_clinic_rw [ALL]`
  USING `clinic_id IN (SELECT user_profiles.clinic_id FROM user_profiles WHERE id=auth.uid())`
  = `current_user_clinic_id()` 와 **기능적으로 동일** → read 는 이미 동작(전원 deny 아님).
  게다가 `[ALL]` 단일 정책이라 SELECT 만 정규화하려면 write 경로를 건드려야 함(AC-4 위반) 또는
  permissive OR 로 no-op. → planner 에 DECISION-REQUEST 발행, 답변 전 동결. (supervisor 적용 대상 아님)

## 확정 RC (Phase 1 전수감사 raw dump, READ-only)
```
clinic_events_select [SELECT] USING:
  (clinic_id IN (SELECT staff.clinic_id FROM staff WHERE staff.id = auth.uid()))
```
- 로그인 신원은 `user_profiles` 기준. `clinic_events_select` 만 `staff.id = auth.uid()`(staff PK = auth uid)
  비정규 패턴 → 사실상 미매칭 → 직원·관리자 거의 전원 clinic_events SELECT 0건.
- ClinicCalendar(대시보드 사이드바, 전 role 공유 메뉴)에서 일정 이벤트가 비어 보이는 망가진 정책.
- health_q_results/tokens outlier(20260611150000)와 동일 RC 패밀리.

## 수정 (정규 패턴 전환, SELECT 만)
```
USING ( is_approved_user() AND clinic_id = current_user_clinic_id() )
```
- `is_approved_user()`: user_profiles approved+active 전 role 커버.
- `clinic_id = current_user_clinic_id()`: 단일 clinic 스코프 명시 (기존 IN(staff subquery)보다 엄격, PHI 비확장).
- INSERT/UPDATE/DELETE 미접촉.

## dry-run 결과 (트랜잭션 적용→검증→ROLLBACK, prod 영속 변경 없음)
```
BEFORE clinic_events_select [SELECT]:
  (clinic_id IN ( SELECT staff.clinic_id FROM staff WHERE (staff.id = auth.uid())))
AFTER  clinic_events_select [SELECT]:
  (is_approved_user() AND (clinic_id = current_user_clinic_id()))
AFTER  clinic_events_insert/update/delete : 불변 (staff 기반 그대로)

회귀가드 자동 점검:
  SELECT 정규 신원(user_profiles)+clinic 스코프 적용 : ✅
  비정규 staff.id 패턴 제거 (SELECT)                  : ✅
  AC-4 쓰기 3정책(INSERT/UPDATE/DELETE) 불변          : ✅
→ DRY-RUN PASS
```

## AC 매핑
| AC | 충족 방식 |
|----|-----------|
| (parity) 직원 SELECT 정상 | is_approved_user()+clinic 스코프 → user_profiles approved 전원 일정 조회 |
| AC-4 READ-only | SELECT 정책만 변경, INSERT/UPDATE/DELETE 불변(dry-run 검증) |
| AC-5 clinic 스코프 | clinic_id = current_user_clinic_id() — 타 clinic row 차단 |
| AC-6 blanket-open 미발생 | clinic 스코프 + approved 게이트 유지 |

## ⚠ 부수 발견 (READ parity 범위 밖 — planner 보고, 본 마이그 미접촉)
- **clinic_events 쓰기 3정책(insert/update/delete)도 `staff.id=auth.uid()` 비정규** → 이벤트
  생성/수정/삭제가 직원·관리자에게 깨질 소지. WS-1(form_templates write OUTLIER)과 동류.
  READ parity 범위 밖이라 본 마이그에서 의도적 미접촉. planner FOLLOWUP 으로 별도 티켓 권고.

## E2E
`tests/e2e/T-20260611-foot-RLS-PARITY-G2-clinic-events.spec.ts` (3 tests)
- G2-1: SELECT 정책 정규 헬퍼 포함 + staff 패턴 부재
- AC-4: 쓰기 3정책 불변 가드(insert WITH CHECK / update·delete USING 에 staff 잔존 = 미접촉 증명)
- G2-3: 헬퍼 SECURITY DEFINER 존재

## 적용 절차 (supervisor)
1. `supabase/migrations/20260611160000_clinic_events_select_rls_canonical.sql` 적용 (Management API query 또는 db push)
2. 사후 검증: dry-run AFTER 술어와 동일한지 `pg_policies` 확인 (clinic_events SELECT = is_approved_user()+clinic)
3. 회귀 시 rollback SQL 적용 (단, 적용 시 G2 0건 버그 재발 — 긴급용)

## db_gate_status = (supervisor 판정 대기)
- RLS SELECT 정책 1개 교체. 데이터 무손실. 백필 없음. 쓰기 권한 불변. 신규 컬럼/테이블/enum 없음(data-architect CONSULT 불요).
