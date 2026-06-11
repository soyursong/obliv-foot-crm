> ## ⛔ WITHDRAWN — 적용 금지 (2026-06-11, planner MSG-20260611-144018-eih9)
> planner 직접 교차검증 후 **G1 = NO-OP 종결 확정**. DECISION-REQUEST 판정 수용:
> - `room_logs_clinic_rw [ALL]` = user_profiles 기반(= `current_user_clinic_id()` 동등) → **read 이미 전 role parity 충족**(G2 와 신원소스 다름). read-parity surface 로는 fix 불요.
> - 별도 SELECT 정책 추가 = OR-merge **no-op**, [ALL] write 동반수정 = 우산 **AC-5(write 불변) 위반**.
> - 조치: check_in_room_logs **Phase2-A 에서 제외 + 매트릭스 'already-parity(무변경)' 재분류. 추가 작업 0.**
> - write 하드닝(approved+active 게이트 부재)은 user_profiles 스코프 → PHI 누수 없음 = 경미 over-permission → **write-track P2 후보로만 기록(지금 강제변경 금지)**.
> - 마이그 파일 `20260611170000_*.sql` → `.WITHDRAWN` 으로 회수(supabase db push 미적용). **supervisor: 본 G1 적용하지 말 것.**
>
> ---

# T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY — Phase 2-A / G1 (check_in_room_logs) DB-gate 제출 (dev-foot) — ⛔WITHDRAWN

- prod: rxlomoozakkjesdqjtvd
- 작성: dev-foot, 2026-06-11
- 출처: planner 재게이트 MSG-20260611-135000-b4sj #1 — C그룹(clinic_events + check_in_room_logs) = GO Phase2-A
- 마이그: `supabase/migrations/20260611170000_check_in_room_logs_select_rls_canonical.sql`
- 롤백:  `supabase/migrations/20260611170000_check_in_room_logs_select_rls_canonical.rollback.sql`
- dry-run: `scripts/T-20260611-foot-RLS-PARITY-G1-check_in_room_logs_dryrun.mjs` (트랜잭션 적용→검증→ROLLBACK)
- ★ 본 제출은 G1(check_in_room_logs) 단일 테이블만. blanket ALTER 아님. 테이블별 단계 적용 ★

## ⚠ planner 께 — 전제 정정 + 구현 분기 (확인 요망)
이 작업은 dev-foot DECISION-REQUEST(MSG-20260611-143552-2sqv)의 해소다. **G1 은 G2 와 RC 가 다르다**:
- G2 clinic_events: SELECT 가 `staff.id=auth.uid()` → 전원 deny = **진짜 parity gap**.
- **G1 check_in_room_logs: SELECT 신원 소스가 이미 user_profiles 기반**(`clinic_id IN (SELECT user_profiles.clinic_id WHERE id=auth.uid())`) = `current_user_clinic_id()` 와 기능적 동일 → **read parity 는 이미 충족**(manager=staff 동일 read, 전원 deny 아님).
- ∴ 본 변경은 "parity gap 수정"이 아니라 **canonical 신원 정렬 + approved/active 게이트 하드닝**.

planner 가 matrix v2(commit 422d1af) 검토 후에도 C그룹 canonical GO 재확정 → 그에 따라 구현.
단일 `[ALL]` 정책이라 SELECT 만 canonical 화하려면 정책 분리가 불가피(아래). **supervisor 적용 전 planner 가 "하드닝 의도 맞음" 최종 확인 권고.**

## 확정 RC / BEFORE (Phase 1 raw dump, dry-run BEFORE 일치)
```
room_logs_clinic_rw [ALL] roles="{public}"
  USING : (clinic_id IN (SELECT user_profiles.clinic_id FROM user_profiles WHERE user_profiles.id = auth.uid()))
  CHECK : (동일)
```

## 수정 방식 (단일 [ALL] → SELECT canonical + 쓰기 보존 분리)
1. DROP `room_logs_clinic_rw [ALL]`
2. SELECT 신설 = `is_approved_user() AND clinic_id = current_user_clinic_id()` (canonical)
3. INSERT/UPDATE/DELETE 신설 = **원 [ALL] user_profiles 술어 그대로** (쓰기 byte-identical, AC-4)

## dry-run 결과 (트랜잭션 적용→검증→ROLLBACK, prod 영속 변경 없음)
```
AFTER:
  room_logs_clinic_select [SELECT]  USING: (is_approved_user() AND (clinic_id = current_user_clinic_id()))
  room_logs_clinic_insert [INSERT]  CHECK: (clinic_id IN (SELECT user_profiles.clinic_id ... id = auth.uid()))
  room_logs_clinic_update [UPDATE]  USING/CHECK: (clinic_id IN (SELECT user_profiles.clinic_id ... id = auth.uid()))
  room_logs_clinic_delete [DELETE]  USING: (clinic_id IN (SELECT user_profiles.clinic_id ... id = auth.uid()))

회귀가드 자동 점검:
  단일 [ALL] 해체(ALL 정책 0건)                          : ✅
  SELECT canonical(is_approved_user()+clinic) 단일 신설  : ✅
  AC-4 쓰기 3정책 = 원 user_profiles 술어 보존(의미 불변): ✅
→ DRY-RUN PASS
```

## AC 매핑
| AC | 충족 방식 |
|----|-----------|
| (parity/하드닝) 직원 SELECT 정상 | is_approved_user()+clinic 스코프 → user_profiles approved 전원 read |
| AC-4 READ-only | 쓰기 3정책 술어 원본과 동일(구조만 [ALL]→3분리, 의미 불변; dry-run 검증) |
| AC-5 clinic 스코프 | SELECT = clinic_id = current_user_clinic_id() — 타 clinic 차단 |
| AC-6 blanket-open 미발생 | SELECT 는 approved + clinic 게이트(기존 [ALL] read 보다 오히려 엄격) |

## E2E
`tests/e2e/T-20260611-foot-RLS-PARITY-G1-check-in-room-logs.spec.ts` (3 tests)
- G1-1: [ALL] 해체 + SELECT canonical 단일
- AC-4: 쓰기 3정책 user_profiles 술어 보존(approved 게이트는 SELECT 전용)
- G1-3: 헬퍼 SECURITY DEFINER

## 적용 절차 (supervisor)
1. `supabase/migrations/20260611170000_check_in_room_logs_select_rls_canonical.sql` 적용
2. 사후 검증: `pg_policies` 에서 check_in_room_logs ALL=0, SELECT=canonical, 쓰기 3정책 user_profiles 술어
3. 회귀 시 rollback SQL 적용 (단일 [ALL] 복원)

## db_gate_status = (supervisor 판정 대기)
- RLS 정책 구조 변경([ALL]→4분리, SELECT canonical). 데이터 무손실. 백필 없음. 쓰기 의미 불변. 신규 컬럼/테이블/enum 없음(data-architect CONSULT 불요).
