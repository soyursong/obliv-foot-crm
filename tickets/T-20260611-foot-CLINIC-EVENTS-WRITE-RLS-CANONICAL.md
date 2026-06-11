---
id: T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL
domain: foot
type: rls-write-fix
priority: P1
status: db-gate-submitted
db_change: true
gate: GO
owner: agent-fdd-dev-foot
created: 2026-06-11
parent: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY
spawned_by: planner MSG-20260611-144018-eih9
data_architect_consult: not-required (RLS only, no new column/table/enum)
db_gate_status: submitted-awaiting-supervisor
---

# T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL — clinic_events 쓰기 RLS canonical 정렬

## 배경 (planner MSG-20260611-144018-eih9)
부모 우산 T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY 의 G2(clinic_events SELECT) 작업 중 발견된
부수발견을 별도 write 트랙으로 분리·발번. planner 교차검증 확인:
> clinic_events insert/update/delete 3정책 전부 staff 기반 → write 전원 차단(파손). G2 read 와 동일 RC.
> 우산 AC-5(write 불변) 위반이라 우산 Phase2-A 에 fold 금지 → 별도 write 트랙으로 분리.

## RC
`clinic_events` 의 쓰기 3정책(insert/update/delete) 이 비정규 신원 소스 `staff.id = auth.uid()` 사용.
로그인 신원은 user_profiles 기준인데 staff.id 는 staff PK → auth.uid() 와 사실상 미매칭 →
직원·관리자 거의 전원 ClinicCalendar 일정 **생성/수정/삭제 0건(write 파손)**. G2 SELECT 와 동일 RC 패밀리.

raw dump (scripts/audit_out/T-20260611-RLS-PARITY_phase1_dump.txt) 근거.

## 수정
쓰기 3정책을 canonical 정규 술어로 전환 — 원래 의도(staff 의 본인 clinic 일정 write)를 신원 소스만 정규화해 복원.
- INSERT: WITH CHECK `(is_approved_user() AND clinic_id = current_user_clinic_id())`
- UPDATE: USING + WITH CHECK 양쪽 canonical (수정 후 타 clinic 이전 escape 차단 — 하드닝)
- DELETE: USING canonical
= G2 SELECT(20260611160000) / health_q(20260611150000) 와 동일 canonical 패턴.

## AC (회귀가드)
- **AC-1/2(write 복원)**: 3정책 canonical 술어 → approved+active 직원이 본인 clinic 일정 write.
- **AC-2(clinic 스코프)**: clinic_id = current_user_clinic_id() 단일 고정 → 타 clinic write 차단(PHI 비확장, 기존 IN(staff) 대비 ≤ 권한).
- **AC-3(escape 차단)**: UPDATE 에 WITH CHECK 신설 → 수정 후 타 clinic_id 이전 불가(원본 USING-only 대비 하드닝).
- **AC-4(read 불변)**: clinic_events_select(G2 canonical) 미접촉.
- **AC-5(blanket-open 금지)**: clinic 스코프 + approved 게이트 유지. true/authenticated 미사용.

## 산출물
- 마이그: `supabase/migrations/20260611190000_clinic_events_write_rls_canonical.sql` (+`.rollback.sql`)
- dry-run: `scripts/T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL_dryrun.mjs` → **PASS** (트랜잭션 적용→검증→ROLLBACK, prod 무변경)
- E2E: `tests/e2e/T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL.spec.ts` (W-1~W-4)
- 증빙: `db-gate/T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL_evidence.md`

## supervisor 검수 (write delta 분리)
- G2(20260611160000)=SELECT read / 본 티켓(20260611190000)=write 3정책. 같은 배치 적용 가능하나 read/write delta 분리 표기.
- §S2.4: RLS only, 신규 컬럼/테이블/enum 0 → data-architect CONSULT 불요. 신규 npm 0.

> db_change=true → **supervisor DB 게이트 적용 전까지 deploy-ready 마킹 금지.** signals 는 db-gate 제출만 기록.
