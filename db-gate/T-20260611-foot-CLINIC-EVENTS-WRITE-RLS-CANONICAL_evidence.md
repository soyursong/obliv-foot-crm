# T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL — DB-gate 제출 (dev-foot)

- prod: rxlomoozakkjesdqjtvd
- 작성: dev-foot, 2026-06-11
- 출처: planner MSG-20260611-144018-eih9 — 부모 우산 부수발견을 **별도 write 트랙**으로 분리·발번(P1, approved)
- 부모: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY (G2 read fix 와 동일 RC, 다른 cmd)
- 마이그: `supabase/migrations/20260611190000_clinic_events_write_rls_canonical.sql`
- 롤백:  `supabase/migrations/20260611190000_clinic_events_write_rls_canonical.rollback.sql`
- dry-run: `scripts/T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL_dryrun.mjs` (트랜잭션 적용→pg_policies 검증→ROLLBACK)
- E2E: `tests/e2e/T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL.spec.ts` (4 tests: W-1~W-4)
- ★ 본 제출은 clinic_events 단일 테이블, **write 3정책(insert/update/delete)만**. blanket ALTER 아님.

## ⚠ supervisor 검수 — write delta 명확 분리 (planner 지시)
- G2(20260611160000) = **SELECT 1정책** read canonical.
- 본 티켓(20260611190000) = **INSERT/UPDATE/DELETE 3정책** write canonical.
- 같은 배치 적용 가능하나 **read/write delta 를 분리·표기**해 검수. 우산 AC-5(write 불변)는 본 별도 트랙으로 분리했으므로 위반 아님.
- 적용 순서: 20260611160000(G2 read) → 20260611190000(write). 독립이라 순서 무관하나 권장.

## 확정 RC / BEFORE (Phase 1 raw dump = dry-run BEFORE 일치)
```
clinic_events_insert [INSERT] CHECK: (clinic_id IN (SELECT staff.clinic_id FROM staff WHERE staff.id=auth.uid()))
clinic_events_update [UPDATE] USING: (clinic_id IN (SELECT staff.clinic_id FROM staff WHERE staff.id=auth.uid()))  WITH CHECK: (없음)
clinic_events_delete [DELETE] USING: (clinic_id IN (SELECT staff.clinic_id FROM staff WHERE staff.id=auth.uid()))
```
staff.id 는 staff PK → auth.uid()(user_profiles 신원)와 사실상 미매칭 → 직원·관리자 거의 전원 일정 생성/수정/삭제 0건(ClinicCalendar write 파손). G2 SELECT 와 동일 RC.

## AFTER (dry-run, 트랜잭션 내)
```
clinic_events_insert [INSERT] WITH CHECK: (is_approved_user() AND (clinic_id = current_user_clinic_id()))
clinic_events_update [UPDATE] USING:      (is_approved_user() AND (clinic_id = current_user_clinic_id()))
                              WITH CHECK: (is_approved_user() AND (clinic_id = current_user_clinic_id()))
clinic_events_delete [DELETE] USING:      (is_approved_user() AND (clinic_id = current_user_clinic_id()))
clinic_events_select [SELECT] (불변 — 본 마이그 미접촉)
```

## dry-run 결과: ✅ PASS
- 헬퍼 존재(is_approved_user, current_user_clinic_id) ✅
- AC-1/2 INSERT canonical + no staff ✅
- AC-1/2/3 UPDATE canonical USING+WITH CHECK + no staff ✅
- AC-1/2 DELETE canonical + no staff ✅
- AC-4 SELECT 정책 불변 ✅
- AC-5 blanket-open(true) 미발생 ✅
- ROLLBACK 완료 — prod 영속 변경 0.

## 회귀가드 (AC)
- **AC-1/2(write 복원)**: 3정책 canonical 술어 → approved+active 직원이 본인 clinic 일정 write.
- **AC-3(escape 차단)**: UPDATE 에 USING+WITH CHECK 양쪽 canonical → 수정 후 타 clinic_id 이전 불가(원본은 USING 만 → 하드닝).
- **AC-4(read 불변)**: clinic_events_select(G2) 미접촉.
- **AC-5(blanket 금지)**: clinic 스코프 + approved 게이트 유지. true/authenticated 미사용.

## §S2.4 data-architect CONSULT
- RLS 정책 술어 교체만. 신규 컬럼/테이블/enum **0** → CONSULT 불요.

## 데이터 영향
- 데이터 무손실·백필 0. RLS 정책 3개 교체(멱등 DROP IF EXISTS→CREATE).

## 운영 적용 (supervisor)
```
supabase db push --file supabase/migrations/20260611190000_clinic_events_write_rls_canonical.sql
# 사후 검증:
SELECT policyname, cmd, qual, with_check FROM pg_policies
  WHERE schemaname='public' AND tablename='clinic_events' AND cmd<>'SELECT' ORDER BY cmd;
```
롤백 필요 시: `..._write_rls_canonical.rollback.sql`.
