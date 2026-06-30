-- T-20260630-foot-NOTIF-TMPL-RLS-CODY-UNLOCK: 메시지설정 write RLS 8역할 정렬 (DB ADDITIVE, NO-DDL)
--   대상 2테이블(messaging 모듈 동일 batch):
--     ① notification_templates.notif_tmpl_write   (③메시지 > 템플릿 저장)
--     ② notification_opt_outs.notif_optout_write   (③메시지 > 수신거부 저장)  ← 2026-07-01 합류
-- 요청: 김주연 총괄 (C0ATE5P6JTH, thread 1782816252.185759)
--   현상: 코디네이터(coordinator) 계정으로 통합설정 > 메시지 > 템플릿/수신거부 [저장] 클릭 시
--         "저장 실패: 저장 권한 없음 — 역할을 확인하세요" 오류.
-- rollback: see 20260630200000_notif_tmpl_write_staff_roles_align.rollback.sql
--
-- ── opt_outs 합류 근거 (T-20260630-foot-PHRASETMPL-CODY-WRITE-RLS FOLLOWUP, planner #2b) ──
--   CODY-WRITE-PERM-PARITY-SWEEP Phase1 매트릭스에서 notification_opt_outs.notif_optout_write 도
--   동일 GAP({admin,manager,director} only, FE messaging=ALL_STAFF_ROLES 와 drift) 으로 표기.
--   본 migration 이 prod apply 전이므로 2차 DDL-diff 사이클 없이 同 batch 로 합류(planner 지시).
--   ★opt_outs 역시 messaging 모듈(20260525030000) 동일 출처 — 0g0z batch(FE SSOT 1:1 정렬) 범위 내.
--    DA/supervisor DDL-diff 게이트에서 opt_outs 합류분 최종 확인 요망.★
--
-- ── FE/DB 정렬 추적성 (DA 권고 가드) ─────────────────────────────────────────
--   • T-20260611-foot-MSGSETTINGS-STAFF-ACCESS (FE 8역할 개방):
--       FE PERM_MATRIX.messaging = ALL_STAFF_ROLES(8역할, tm 제외) 로 페이지 접근을 개방했으나
--       명시적 'DB 무변경'(RLS 무접촉) → DB notif_tmpl_write 는 3역할(admin/manager/director)만 유지.
--       → FE/DB drift: coordinator 등은 화면 진입·렌더 OK 이나 .update()/.insert() 가 RLS 0행 → 저장실패.
--   • 본 티켓 (DB 동기화): notif_tmpl_write 를 FE SSOT(ALL_STAFF_ROLES) 와 1:1 정렬해 drift 클래스 소멸.
--
-- ── 근본 원인 ────────────────────────────────────────────────────────────────
--   RLS notif_tmpl_write(notification_templates) = get_user_role() IN ('admin','manager','director') 만 허용
--   → coordinator 미포함 → coordinator 의 update/insert 가 0행 반환 → FE 가 "저장 권한 없음" 표출.
--   (AdminSettings 템플릿 저장 핸들러는 별도 canEdit 게이트 없이 RLS 결과 0행만으로 에러 표출 = 순수 DB 차단.)
--
-- ── 수정 요지 (DA CONSULT-REPLY MSG-20260630-195608-0g0z, option (i) batch 채택) ──
--   coordinator 1역할만 고치면 consultant/therapist/part_lead/staff 가 동일 에러로 순차 재발(같은 게이트 4회)
--   → FE SSOT(ALL_STAFF_ROLES, tm 제외 8역할)에 DB 를 한 번에 정렬.
--   ★INVARIANT 의무★: clinic_id = get_user_clinic_id() AND get_user_role() IN (...) 형태 유지
--                     — USING + WITH CHECK 양쪽 모두. allowlist 에만 추가, clinic_id isolation 완화 절대 금지.
--   ★ADDITIVE only★: 기존 admin/manager/director 권한 미회수(회수 0).
--   ★NO-DDL★: 컬럼·테이블·enum 무변경. 정책 교체(DROP+CREATE)만.
-- ============================================================================

BEGIN;

-- notif_tmpl_write: FOR ALL (insert/update/delete) — clinic_id isolation INVARIANT 유지 + allowlist 8역할 확대.
DROP POLICY IF EXISTS notif_tmpl_write ON public.notification_templates;
CREATE POLICY notif_tmpl_write ON public.notification_templates
  FOR ALL
  TO authenticated
  USING (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN (
      'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'
    )
  )
  WITH CHECK (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN (
      'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'
    )
  );

-- notif_optout_write: FOR ALL — notif_tmpl_write 와 동일 패턴(clinic_id INVARIANT + allowlist 8역할).
--   기존: get_user_role() IN ('admin','manager','director')  →  ADDITIVE 8역할(tm 제외).
DROP POLICY IF EXISTS notif_optout_write ON public.notification_opt_outs;
CREATE POLICY notif_optout_write ON public.notification_opt_outs
  FOR ALL
  TO authenticated
  USING (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN (
      'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'
    )
  )
  WITH CHECK (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN (
      'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'
    )
  );

COMMIT;

-- ── DOWN (참고용 — 실제 롤백은 .rollback.sql 사용) ──────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS notif_tmpl_write ON public.notification_templates;
-- CREATE POLICY notif_tmpl_write ON public.notification_templates
--   FOR ALL TO authenticated
--   USING       (clinic_id = public.get_user_clinic_id() AND public.get_user_role() IN ('admin','manager','director'))
--   WITH CHECK  (clinic_id = public.get_user_clinic_id() AND public.get_user_role() IN ('admin','manager','director'));
-- COMMIT;
