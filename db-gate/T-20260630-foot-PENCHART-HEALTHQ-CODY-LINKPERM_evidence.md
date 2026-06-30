# T-20260630-foot-PENCHART-HEALTHQ-CODY-LINKPERM — RC 확정 + DB게이트 증거

상태: **CONSULT-PENDING** (data-architect ADDITIVE 권한확대 CONSULT + supervisor DDL-diff 게이트 전 — 미적용).
일시: 2026-06-30 (KST). 조사: dev-foot, PROD READ-ONLY 실측(Management API query).

## 1. 착수1 — 버튼 → RPC 특정
- 2번차트 > 펜차트 > 발건강 질문지 패널 = `src/components/HealthQResultsPanel.tsx`.
- '링크 생성' 버튼 → `handleCreateToken()` → `supabase.rpc('fn_health_q_create_token', {...})`.
- 일반=form_type 'general'+lang 'ko' / 외국인용=form_type 'general'+lang 'en'. **동일 RPC**.
- FE 역할게이트 없음 — `permissions.ts` 에 health-q/link 키 부재, 버튼은 무조건 노출/호출.

## 2. 착수2 — admin OK / coordinator NG 패턴 (실측으로 재현 대체)
- PROD `health_q_tokens` 실측: **2026-06-30 17:52 KST coordinator(김지혜) 토큰 2건 생성 성공**.
  → 함수는 coordinator 에게 정상 동작(어떤 coordinator는 됨). 즉 "coordinator 전면 차단" 아님.
- 그런데 현장 신고(18:01)는 coordinator 실패 → **coordinator 간 분기**가 존재.

## 3. 착수3 — RC 확정 (가설 반증 + 진짜 원인)
티켓 1차 가설 **모두 반증**:
- (a) FE 역할게이트? → 없음(§1).
- (b) admin 한정 RLS/EXECUTE? → 반증.
  - EXECUTE grants = `authenticated, anon, service_role, postgres, PUBLIC` (role 무관 전역).
  - `health_q_tokens` INSERT RLS = `clinic_id IN (staff WHERE user_id=auth.uid())` — **role 필터 없음**.
  - 함수 = SECURITY DEFINER, owner=`postgres`(**rolbypassrls=true**) → INSERT 시 RLS 우회.
  - → RPC EXECUTE·RLS 어느 것도 role 게이트 아님.

**진짜 RC = 비정규 신원 소스 outlier**:
- 함수 본문 유일 게이트: `SELECT id FROM staff WHERE user_id=auth.uid() AND clinic_id=p_clinic_id; IF NOT FOUND THEN unauthorized`.
- 로그인 신원은 **user_profiles** 기준인데 게이트는 **staff.user_id** 사용 → staff.user_id 희소.
- PROD 실측: `user_profiles` coordinator=**7명**, 그 중 `staff.user_id` 미연결=**5명**.
  → 미연결 5명은 로그인·차트열람 정상이나 이 RPC 만 'unauthorized' → '링크 생성 실패'.
  → 연결된 2명(김지혜 등)은 성공(§2와 정합).
- admin/manager/원장: staff.user_id 연결됨 → legacy 게이트 통과(무회귀).

★ 이 outlier 는 **T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE** 가 health_q SELECT 정책에서
  이미 진단·정규화(staff.user_id → is_approved_user()+current_user_clinic_id())한 것과 동일.
  그때 SELECT 만 고치고 create-token RPC(INSERT 경로)는 누락 → 본 티켓이 그 잔여 outlier.
- 형제 RPC 점검(실측): `fn_dashboard_reissue_health_q_token`/`fn_selfcheckin_create_health_q_token`
  /`fn_health_q_validate_token` 은 staff.user_id outlier **없음**. outlier 보유 = `fn_health_q_create_token` 단 1개.

## 4. 수정안 (착수4 — DDL 수반 → 게이트)
- `fn_health_q_create_token` 인가 게이트를 **ADDITIVE union** 으로 전환:
  `(is_approved_user() AND p_clinic_id = current_user_clinic_id()) OR <legacy staff.user_id 매칭>`.
  → 기존 통과자(admin/manager/원장/연결 coordinator) 전원 유지 + approved user_profiles 직원(미연결 coordinator) 추가.
- `created_by` = staff.id best-effort(미연결 시 NULL; FK `staff(id) ON DELETE SET NULL` 안전 — 기존 NULL row 존재).
- **토큰 발급 본체 = REGRESS4(20260629143000) byte-identical**: search_path=public,extensions /
  extensions.gen_random_bytes / translate(encode(...,'base64'),'+/=','-_'). (AC-4)
- **RLS 정책 미접촉** — 변경은 함수 인가 로직에 한정.
- 마이그: `supabase/migrations/20260630181500_health_q_create_token_canonical_identity.sql` (+ .rollback).

## 5. DRY-RUN (PROD, BEGIN...ROLLBACK — 미커밋)
- CREATE OR REPLACE 컴파일 성공(helper 해석 OK, 문법 유효). ROLLBACK 후 PROD 함수 = 여전히 legacy(미변경 확인).
- helper 실측: `is_approved_user()`=user_profiles approved+active / `current_user_clinic_id()`=user_profiles clinic.
- clinic 단일(74967aea) → p_clinic_id = current_user_clinic_id() 항상 성립(스코프 안전).

## 6. AC 매핑
- AC-1: 미연결 coordinator 포함 링크 생성 정상(일반 ko / 외국인 en 동일 경로). ✅(수정안)
- AC-2: admin/manager/원장 무회귀 — legacy union 보존. ✅
- AC-3: coordinator 한정 아님 = approved+active 전 직원(동일 clinic)으로 정규화(SELECT 정책 정합). ✅
- AC-4: 토큰 본체 REGRESS4 무변경 + RLS 미변경, 인가 게이트만 ADDITIVE. ✅

## 7. 게이트 (미해소 — deploy-ready 금지)
- [ ] data-architect CONSULT (ADDITIVE 권한확대, PHI 토큰 발급 인가 경계) GO
- [ ] supervisor DDL-diff
- 위 2개 GO 후에만 PROD 적용 + deploy-ready 마킹.
