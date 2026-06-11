# T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE — DB-gate 제출 패키지 (dev-foot)

- prod: rxlomoozakkjesdqjtvd
- 작성: dev-foot, 2026-06-11
- 출처: planner NEW-TASK MSG-20260611-112037-df45 (P1, db_change=true)
- 마이그: `supabase/migrations/20260611150000_health_q_rls_canonical_identity.sql`
- 롤백:  `supabase/migrations/20260611150000_health_q_rls_canonical_identity.rollback.sql`
- 진단:  `scripts/..._diag.mjs`, `scripts/..._diag2.mjs` (read-only)
- dry-run: `scripts/..._dryrun.mjs` (트랜잭션 적용→검증→ROLLBACK)

## ⚠ 확정 RC 정정 (티켓 1차 가설 반증됨)

티켓 본문/planner 메시지의 1차 RC = **"health_q_results RLS SELECT 정책이 admin role만 허용,
직원 role 미포함"** → **실제 prod 정책에 role 필터가 아예 없으므로 반증됨.**

read-only 진단(`pg_policies`) 실측 결과:

| 테이블 | SELECT 정책 USING | 신원 소스 |
|--------|-------------------|-----------|
| customers | `is_approved_user()` / `is_floor_staff()` | **정규 (user_profiles)** |
| check_ins | `is_approved_user()` / `true` | **정규 (user_profiles)** |
| **health_q_results** | `clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())` | **비정규 (staff.user_id) ← outlier** |
| **health_q_tokens** | 동일 | **비정규 (staff.user_id) ← outlier** |

- 로그인 신원은 `user_profiles` 기준. `staff.user_id` 는 희소(김상곤 clinic coordinator 12명 중 user_id 보유 3명, 9명 NULL).
- coordinator 는 user_profiles row 가 있어 customers/check_ins(차트)는 정상 → 화면은 뜨지만,
  health_q_results/tokens 만 staff.user_id 미매칭으로 **SELECT 0건** → "제출된 질문지가 없습니다".
- 관리자가 정상인 이유: 해당 admin 의 staff.user_id 가 채워져 있어 우연히 매칭. (정책 우회 아님)
- ★ **확정 RC = health_q_results / health_q_tokens SELECT RLS 가 비정규 신원 소스(staff.user_id) 를 쓰는 outlier.** ★
- 증상이 "설문지만 안 보임"인 것이 outlier 가설과 정확히 일치(나머지 테이블은 정규 패턴이라 정상).

## 수정 (정규 패턴 전환)

두 테이블 SELECT 정책을 정규 패턴으로 통일:
```
USING ( is_approved_user() AND clinic_id = current_user_clinic_id() )
```
- `is_approved_user()`: user_profiles approved+active 전 role(admin·manager·coordinator·therapist 등) 커버.
- `clinic_id = current_user_clinic_id()`: 단일 clinic 스코프 명시 유지 (기존 IN(subquery) 보다 엄격, PHI 비확장).
- INSERT/UPDATE/DELETE 미접촉. (results 제출은 fn_health_q_submit SECURITY DEFINER RPC 경유라 RLS 무관)

### tokens 동반 수정 사유
HealthQResultsPanel 이 `health_q_results`(제출목록, loadResults) + `health_q_tokens`(reopen QR, loadReopenToken)
**둘 다** 조회. 동일 RC·동일 패널 → results 만 고치면 coordinator reopen 토큰이 계속 깨짐 → 함께 정규화.

## dry-run 결과 (트랜잭션 적용→검증→ROLLBACK, prod 영속 변경 없음)
```
AFTER:
  health_q_results.hq_results_staff_select [SELECT]
     USING: (is_approved_user() AND (clinic_id = current_user_clinic_id()))
  health_q_tokens.hq_tokens_staff_insert [INSERT]   ← 불변
     WITH CHECK: (clinic_id IN (SELECT staff.clinic_id FROM staff WHERE (staff.user_id = auth.uid())))
  health_q_tokens.hq_tokens_staff_select [SELECT]
     USING: (is_approved_user() AND (clinic_id = current_user_clinic_id()))

회귀가드 자동 점검:
  AC-1/2 정규 신원+clinic 스코프 적용 : ✅
  비정규 staff.user_id 패턴 제거       : ✅
  AC-3 tokens INSERT 정책 불변         : ✅
  AC-3 results 쓰기 정책 신설 없음     : ✅
→ DRY-RUN PASS
```

## AC 매핑
| AC | 충족 방식 |
|----|-----------|
| AC-0 조사 | diag/diag2 read-only — 실제 정책 outlier 특정, 1차 RC 반증 |
| AC-1 직원 SELECT 정상 | is_approved_user()+clinic 스코프 → user_profiles 38명 전원 조회 가능 |
| AC-2 김상곤 표시 | RLS 차단 해소 → 제출내역(2026-06-10, 12항목) 표시 |
| AC-3 READ-only | SELECT 정책만 변경, tokens INSERT 불변, results 쓰기 정책 신설 없음 |
| AC-4 clinic 스코프 | clinic_id = current_user_clinic_id() — 타 clinic row 차단 |
| AC-5 회귀 없음 | customers/check_ins 등 미접촉, 동일 헬퍼 재사용 |

## E2E
`tests/e2e/T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE.spec.ts` (6 tests)
- AC-5a/5b: 정책 qual 검증(정규 헬퍼 포함 + staff 패턴 부재)
- AC-3: 쓰기 정책 불변 가드
- AC-5c: 헬퍼 SECURITY DEFINER 존재
- AC-2: coordinator 브라우저(creds/고객id 있을 때) "없습니다" 0건 가드

## 적용 절차 (supervisor)
1. `supabase db push --file supabase/migrations/20260611150000_health_q_rls_canonical_identity.sql` (또는 Management API query)
2. 사후 검증: 위 dry-run AFTER 술어와 동일한지 `pg_policies` 확인
3. 회귀 시 rollback SQL 적용 (단, 적용 시 coordinator 0건 버그 재발 — 긴급용)

## db_gate_status = (supervisor 판정 대기)
- RLS SELECT 정책 2개 교체. 데이터 무손실. 백필 없음. 쓰기 권한 불변.
