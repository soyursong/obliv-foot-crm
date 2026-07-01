-- T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE — 상용구(펜/고객차트) write RLS 단일 통합정책 (shape ii)
--
-- ★정본 = DA CONSULT-REPLY MSG-20260701-102953-2k2i (DA-20260701-PHRASETMPL-RLS-4ROLE, shape (ii)).
--   앞선 회신 f5k2(10:23:54, shape i=20260620120000 재적용)는 6분 뒤 2k2i(10:29:53)가 ★명시 반려★
--   ("(i) 반려" + "92a95431/staff_write 재apply 금지"). 정본=2k2i. shape(i) 아티팩트 deploy VOID.
--   → 본 마이그 = FE canEditStaffAreaPhrase(7역할)와 1:1 정합하는 단일 permissive 통합정책 신설.
--
-- 배경(드리프트, Phase A RC 확정): repo 92a95431(staff_write_staffarea_phrases, 20260620120000)가
--   PROD 미apply(순수 미apply — supabase_migrations 원장이 20260609234500서 정지). PROD 실측 write =
--   admin_write_phrase_templates {admin,manager,director}(FOR ALL, USING-only) + read=true 2개 뿐.
--   → FE는 7역할 열림 / 서버 RLS는 {admin,manager,director}만 write = consultant/coordinator/therapist/
--     part_lead/staff 5역할 저장막힘(lock-out-in-disguise). 본 마이그가 서버 RLS를 FE와 정합.
--
-- shape(ii) 스펙 (2k2i):
--   · 정책명 = staffarea_write_phrases (permissive, role-prefix 금지, 주석 'mirrors FE canEditStaffAreaPhrase').
--   · 대상 role = 7역할 verbatim {admin, manager, consultant, coordinator, therapist, part_lead, staff}
--       = FE PHRASE_STAFFAREA_EDIT_ROLES (ALL_STAFF_ROLES − director)와 1:1 (anti-drift 핵심).
--       admin/manager는 admin_write와 OR 중복이나 무해·자기문서화 → 7역할 전부 명시(FE와 verbatim 일치).
--   · 가드 = phrase_type IN ('pen_chart','customer_chart') USING + WITH CHECK ★양쪽★.
--       (WITH CHECK 누락 시 pen→medical_chart phrase_type 변조 = 의사영역 침범 hole. 절대 제거 금지.)
--   · command = FOR ALL (INSERT + UPDATE + DELETE + SELECT).
--       ★DELETE 정렬: PROD admin_write_phrase_templates = FOR ALL(USING-only, DELETE 포함) — dev-foot 실측.
--        스펙 "DELETE = admin_write 현행 scope와 맞춤" → admin_write가 FOR ALL(DELETE 有)이므로 본 정책도
--        FOR ALL로 DELETE 포함 정렬. SELECT는 기존 staff_read_phrase_templates(USING true)와 OR 중복·무해.
--   · admin_write_phrase_templates {admin,manager,director} ★무접촉★ (ADDITIVE — 본 파일에 admin_write
--     DROP/ALTER/CREATE 없음). director의 medical_chart write는 admin_write로 그대로 보존(OPINIONPHRASE 무회귀).
--
-- superseded 정리(양쪽 미apply·PROD 부재 → 멱등 방어용 DROP IF EXISTS, 데이터·기존권한 영향 0):
--   · staff_write_staffarea_phrases (20260620120000, shape i 5역할) = 재apply 불사용 → 흡수·폐기.
--   · coordinator_write_staffarea_phrases (20260701030000, sibling 단일) = 흡수·폐기.
--   두 정책은 admin_write가 아니며 PROD 미존재. DROP IF EXISTS는 leaked/drift 상태에서도 coordinator
--   이중정책(중복 permissive)을 원천 차단(AC-4). admin_write는 건드리지 않음(③ 무변경 유지).
--
-- cross-CRM 영향 0: phrase_templates는 cross_crm_data_contract·schema_registry 미등재 foot-로컬.
-- 데이터 mutation 0 (CREATE POLICY DDL만, backfill 없음). 롤백 = DROP POLICY staffarea_write_phrases.
-- 재실행 안전: DROP POLICY IF EXISTS + CREATE.
--
-- ⚠ APPLY 게이트: ADDITIVE + DA GO → 대표 게이트 면제(autonomy §3.1). supervisor DDL-diff 5-check
--   선행 후에만 PROD apply. 5-check: ①role=7 정확 ②USING+WITH CHECK 양쪽 phrase_type 가드
--   ③admin_write 무변경 ④sibling 20260701030000 미포함 ⑤staff역할 medical_chart 쓰기 불가 재현.

-- 흡수·폐기된 superseded 정책 방어적 제거 (PROD 미존재 시 no-op, admin_write 무접촉)
DROP POLICY IF EXISTS "staff_write_staffarea_phrases" ON public.phrase_templates;
DROP POLICY IF EXISTS "coordinator_write_staffarea_phrases" ON public.phrase_templates;

-- 단일 통합정책 (7역할, FE canEditStaffAreaPhrase 1:1)
DROP POLICY IF EXISTS "staffarea_write_phrases" ON public.phrase_templates;

CREATE POLICY "staffarea_write_phrases"
  ON public.phrase_templates FOR ALL
  TO authenticated
  USING (
    phrase_type IN ('pen_chart', 'customer_chart')
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN (
          'admin', 'manager', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'
        )
        AND user_profiles.active = true
    )
  )
  WITH CHECK (
    phrase_type IN ('pen_chart', 'customer_chart')
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN (
          'admin', 'manager', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'
        )
        AND user_profiles.active = true
    )
  );

COMMENT ON POLICY "staffarea_write_phrases" ON public.phrase_templates IS
  'mirrors FE canEditStaffAreaPhrase — T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE shape(ii) DA MSG-20260701-102953-2k2i. 상용구관리(pen_chart/customer_chart) write 단일 통합정책. role=7 {admin,manager,consultant,coordinator,therapist,part_lead,staff} = PHRASE_STAFFAREA_EDIT_ROLES(ALL_STAFF_ROLES−director). permissive ADDITIVE — admin_write_phrase_templates({admin,manager,director}, 모든 type) 와 OR·무접촉. phrase_type 가드(USING+WITH CHECK 양쪽)로 medical_chart(의사영역 OPINIONPHRASE director-only) 차단. shape(i) 20260620120000 재apply 불사용 + sibling 20260701030000 흡수·폐기.';
