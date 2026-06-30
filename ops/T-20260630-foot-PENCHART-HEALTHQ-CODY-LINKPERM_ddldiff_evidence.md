# DDL-diff 검증 증빙 — T-20260630-foot-PENCHART-HEALTHQ-CODY-LINKPERM

FIX-REQUEST MSG-20260630-203555-rmrt (supervisor, phase1 DDL-diff gate / insufficient_verification) 대응.
검증 방식: Supabase Management API `/v1/projects/rxlomoozakkjesdqjtvd/database/query` (read-only, prod). 2026-06-30 21:55 KST.
대상 마이그레이션 commit: a0f6b250 / `supabase/migrations/20260630181500_health_q_create_token_canonical_identity.sql` (**PROD 미적용 상태**).

---

## ⚠️ FIX-REQUEST 본문과 본 티켓 변경 대상 불일치 (supervisor 확인 요망)

FIX-REQUEST 본문 1)·2)는 `notification_templates` 테이블의 `notif_tmpl_write` 정책을 지목합니다.
그러나 **본 티켓(PENCHART-HEALTHQ-CODY-LINKPERM)의 마이그레이션은 `notification_templates`를 일절 건드리지 않습니다.**
변경 대상은 `fn_health_q_create_token` 함수의 인가 게이트 1곳뿐이며, RLS·다른 테이블 미접촉입니다.
→ FIX-REQUEST 본문이 다른 티켓 템플릿에서 잘못 붙여진 것으로 추정됩니다.
**아래에 (1) 요청하신 literal 증빙(notif_tmpl_write)과 (2) 본 티켓의 실제 변경 대상 DDL-diff 증빙을 모두 첨부합니다.**

---

## (1) [LITERAL 요청 대응] notification_templates / notif_tmpl_write — prod 현행 정책 정의

```sql
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname='public' and tablename='notification_templates';
```
결과:
| policyname | cmd | roles | qual (USING) | with_check |
|---|---|---|---|---|
| notif_tmpl_select | SELECT | {authenticated} | `(clinic_id = get_user_clinic_id()) OR (clinic_id IS NULL)` | — |
| **notif_tmpl_write** | **ALL** | **{authenticated}** | `(clinic_id = get_user_clinic_id()) AND (get_user_role() = ANY (ARRAY['admin','manager','director']))` | `(clinic_id = get_user_clinic_id()) AND (get_user_role() = ANY (ARRAY['admin','manager','director']))` |

→ **3역할(admin/manager/director) + clinic_id isolation(USING+WITH CHECK 양쪽) 유지 상태 확인.**
→ 본 티켓 마이그레이션은 이 정책을 **변경하지 않음**(무관·무회귀).

---

## (2) [본 티켓 실제 대상] fn_health_q_create_token — DDL-diff 근거

### 2-1. PROD 현행(BEFORE) — 함수 메타
```sql
select proname, owner, prosecdef, proconfig from pg_proc ... where proname='fn_health_q_create_token';
```
- owner=`postgres` (BYPASSRLS), SECURITY DEFINER=`true`, search_path=`public, extensions`
- EXECUTE grant: authenticated / anon / service_role / postgres / PUBLIC (역할 필터 EXECUTE단 없음 → 게이트는 함수 본문 내부)

### 2-2. PROD 현행(BEFORE) — 인가 게이트 (실측 본문 발췌)
```sql
  -- 직원 권한 확인
  SELECT id INTO v_staff_id
  FROM   staff
  WHERE  user_id    = auth.uid()
    AND  clinic_id  = p_clinic_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;
```
→ **유일 게이트 = `staff.user_id = auth.uid()` (비정규 신원).** 로그인 신원은 user_profiles 기준이라 staff.user_id 미연결 coordinator(7명 중 5명)는 'unauthorized'. ← 확정 RC 일치.

### 2-3. 마이그레이션 적용 후(AFTER) — 인가 게이트
```sql
  IF NOT (
       (is_approved_user()
        AND (current_user_clinic_id() IS NULL OR p_clinic_id = current_user_clinic_id()))
       OR v_staff_id IS NOT NULL          -- 레거시 staff 게이트 보존(무회귀)
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;
```
→ **ADDITIVE union**: 기존 통과자(admin/manager/director 등 staff 연결자) 전원 유지 + approved user_profiles 직원(미연결 coordinator 포함) 추가. 토큰 본체 byte-identical(REGRESS4 보존). **DROP·기존 정책 제거 0.**

### 2-4. health_q_tokens RLS — 마이그레이션 미접촉 확인
```sql
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname='public' and tablename='health_q_tokens';
```
| policyname | cmd | with_check / qual |
|---|---|---|
| hq_tokens_staff_insert | INSERT | WITH CHECK: `clinic_id IN (SELECT clinic_id FROM staff WHERE user_id=auth.uid())` |
| hq_tokens_staff_select | SELECT | USING: `is_approved_user() AND clinic_id = current_user_clinic_id()` |
→ 마이그레이션은 RLS 정책을 **변경하지 않음**. 함수=SECURITY DEFINER(BYPASSRLS owner)라 INSERT는 함수 내부 게이트가 인가를 결정.

---

## (3) 마이그레이션 dry-run (BEGIN..ROLLBACK, prod) — clean apply 증명
```
BEGIN; <migration body>;
  SELECT position('is_approved_user' in pg_get_functiondef(...))>0 AS gate_now_canonical;  → true
ROLLBACK;
```
- 트랜잭션 내 적용 후 게이트 정규화 확인: **`gate_now_canonical = true`** (DDL 오류 0, clean apply)
- ROLLBACK 후 prod 재확인: **`canonical_applied = false`** → **PROD 무변경 유지**(아키텍트 미적용 경계 준수)

---

## (4) repo_path 정정
- (오) frontmatter `repo_path: /Users/domas/Documents/GitHub/obliv-foot-crm` (구 macbook 경로)
- (정) 현행 macstudio(M3 Ultra) 실경로: **`/Users/domas/GitHub/obliv-foot-crm`** → frontmatter 정정 반영.

---

## 결론
- AC-2(무회귀): legacy staff 게이트 union 보존 + notif_tmpl_write 등 타 정책 무관 → **무회귀 확인**.
- AC-4(보안): RLS 미변경, 토큰 본체 byte-identical, ADDITIVE only → **준수**.
- 적용 게이트 = **supervisor** (DDL-diff 통과 후 supervisor가 prod 적용). dev-foot는 PROD 미적용 유지.
- deploy-ready = "검증 완료, supervisor 적용 대기" 의미로 재마킹.
