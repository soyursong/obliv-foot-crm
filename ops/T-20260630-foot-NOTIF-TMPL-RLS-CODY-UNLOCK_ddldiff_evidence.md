# DDL-diff 검증 증빙 — T-20260630-foot-NOTIF-TMPL-RLS-CODY-UNLOCK

FIX-REQUEST MSG-20260630-213111-g4zf (supervisor, phase1 DDL-diff gate) 대응.
검증 방식: Supabase Management API `POST /v1/projects/rxlomoozakkjesdqjtvd/database/query` (read-only / in-txn dry-run, **prod**). 2026-06-30 KST.
대상 마이그레이션: commit `3cca3d21` / `supabase/migrations/20260630200000_notif_tmpl_write_staff_roles_align.sql` (**PROD 미적용 상태** — supervisor DDL-diff GO 후 적용).

> ⚠️ 본 FIX-REQUEST의 `/tmp/fix_request_body.md` 본문은 `health_q`/`fn_health_q_create_token`/`canCreateLink`(= T-20260630-foot-PENCHART-HEALTHQ-CODY-LINKPERM)에 관한 내용으로, **본 티켓(notif_tmpl_write / notification_templates)과 대상이 다릅니다.** 공유 `/tmp` 파일 cross-contamination(타 티켓 본문 오기)으로 판단 — HEALTHQ 티켓 `ddldiff_evidence` 필드에도 동일 오기 사실이 명시되어 있습니다. 본 티켓의 실제 QA NO-GO 사유(티켓 §Supervisor QA: "prod 현행 notif_tmpl_write 정책과의 DDL-diff 증거(prod=3역할 일치) 로그 부재")에 대응하여 아래 증빙을 첨부합니다.

---

## (1) PROD 현행(BEFORE) — notification_templates 정책 정의 [live 실측]

```sql
select policyname, cmd, roles::text, qual, with_check
from pg_policies where schemaname='public' and tablename='notification_templates' order by policyname;
```
결과:
| policyname | cmd | roles | qual (USING) | with_check |
|---|---|---|---|---|
| notif_tmpl_select | SELECT | {authenticated} | `(clinic_id = get_user_clinic_id()) OR (clinic_id IS NULL)` | — |
| **notif_tmpl_write** | **ALL** | **{authenticated}** | `(clinic_id = get_user_clinic_id()) AND (get_user_role() = ANY (ARRAY['admin','manager','director']))` | `(clinic_id = get_user_clinic_id()) AND (get_user_role() = ANY (ARRAY['admin','manager','director']))` |

→ **prod 현행 notif_tmpl_write = 3역할(admin/manager/director) + clinic_id isolation(USING+WITH CHECK 양쪽) 확인.**
→ 마이그레이션의 `down`(롤백 SQL) 기준선과 **byte 일치** = drift 없음. coordinator 미포함 → coordinator의 .update()/.insert() 0행 → FE "저장 권한 없음" 표출 = 확정 RC 일치.

---

## (2) 마이그레이션 적용 후(AFTER) — in-txn dry-run [BEGIN..ROLLBACK, prod]

```sql
BEGIN;
DROP POLICY IF EXISTS notif_tmpl_write ON public.notification_templates;
CREATE POLICY notif_tmpl_write ON public.notification_templates
  FOR ALL TO authenticated
  USING (clinic_id = public.get_user_clinic_id() AND public.get_user_role() IN
         ('admin','manager','director','consultant','coordinator','therapist','part_lead','staff'))
  WITH CHECK (clinic_id = public.get_user_clinic_id() AND public.get_user_role() IN
         ('admin','manager','director','consultant','coordinator','therapist','part_lead','staff'));
SELECT policyname, cmd, roles::text, qual, with_check FROM pg_policies
  WHERE schemaname='public' AND tablename='notification_templates' AND policyname='notif_tmpl_write';
ROLLBACK;
```
적용 후 정책 정의(실측):
- `cmd=ALL  roles={authenticated}`
- `USING      = (clinic_id = get_user_clinic_id()) AND (get_user_role() = ANY (ARRAY['admin','manager','director','consultant','coordinator','therapist','part_lead','staff']))`
- `WITH CHECK = (clinic_id = get_user_clinic_id()) AND (get_user_role() = ANY (ARRAY['admin','manager','director','consultant','coordinator','therapist','part_lead','staff']))`

→ **8역할 정렬(FE SSOT `PERM_MATRIX.messaging = ALL_STAFF_ROLES`, tm 제외)**. DDL 오류 0 = clean apply.
→ **★INVARIANT 유지★**: `clinic_id = get_user_clinic_id()` 가 USING+WITH CHECK 양쪽 보존(isolation 완화 0).
→ **★ADDITIVE only★**: 기존 admin/manager/director 전원 유지(회수 0), consultant/coordinator/therapist/part_lead/staff 추가.
→ **★NO-DDL★**: 컬럼·테이블·enum 무변경. 정책 DROP+CREATE(replace)만.

---

## (3) ROLLBACK 후 PROD 무변경 재확인 [live 실측]

```sql
select policyname, qual from pg_policies
where schemaname='public' and tablename='notification_templates' and policyname='notif_tmpl_write';
```
결과: `notif_tmpl_write` USING = `(clinic_id = get_user_clinic_id()) AND (get_user_role() = ANY (ARRAY['admin','manager','director']))`

→ **dry-run 트랜잭션 ROLLBACK 후 prod 여전히 3역할** = 본 증빙 수집으로 PROD 무변경(아키텍트 미적용 경계 준수). 실제 적용은 supervisor DDL-diff GO 후.

---

## (4) FE dual_layer 점검 — '템플릿 저장 canEdit' 게이트 (DoD)

- `src/pages/AdminSettings.tsx` 페이지 접근 게이트 = `isStaffUnlockRole(role)` → `STAFF_UNLOCK_ROLES = [admin,manager,director,consultant,coordinator,therapist]` (6역할, coordinator 포함) → **coordinator 화면 진입·렌더 OK**.
- 템플릿 저장 핸들러(`AdminSettings.tsx` L1084–1110): `.update()/.insert(...).select('id')` 후 `if (!data || length===0) throw '저장 권한 없음 — 역할을 확인하세요'`. **별도 role 분기(canEdit admin||manager) 없음** = 순수 RLS 0행 의존.
- → **FE 코드 변경 불요**(별 surface canEdit 게이트 부재 확인). 저장 차단은 100% DB RLS. 본 마이그 적용만으로 해소.
- Solapi 자격증명(⓪연결설정) adminOnly 게이트 무접촉.
- 참고: RLS는 8역할(FE SSOT 정렬), FE 페이지 접근은 6역할 → part_lead/staff는 페이지 진입 자체가 차단(navigate away)되므로 RLS 8역할은 SSOT 정합 headroom일 뿐 무회귀.

---

## 결론
- **prod=3역할 일치 DDL-diff 근거 확보**(§1 live + §3 rollback 재확인) → QA NO-GO 사유 해소.
- AFTER=8역할 + clinic_id INVARIANT(USING+WITH CHECK) + ADDITIVE(회수 0) + NO-DDL + clean apply(§2) 실측.
- 롤백 SQL 동봉(`20260630200000_notif_tmpl_write_staff_roles_align.rollback.sql`, 3역할 복원).
- 적용 게이트 = **supervisor**(DDL-diff GO 후 prod 적용). dev-foot는 PROD 미적용 유지.
- 현장 confirm(코디 저장 성공) = supervisor 적용 후 김주연 총괄 검증.
