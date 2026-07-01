-- T-20260630-foot-PHRASETMPL-CODY-WRITE-RLS — 상용구(펜/고객차트) coordinator write 개방 (RLS ADDITIVE)
--
-- 현장(김주연 총괄, U0ATDB587PV / coordinator 계정 기준, #풋센터 C0ATE5P6JTH):
--   서비스항목 > 상용구관리 의 상용구(펜차트)·상용구(고객차트) 저장이 coordinator 계정에서 막힘.
--   FE 게이트(PhrasesTab canEdit = canEditStaffAreaPhrase)는 coordinator 포함(FE 열림)이나
--   phrase_templates RLS write 가 PROD 실측 {admin,manager,director} 한정 → coordinator INSERT/UPDATE/DELETE
--   가 RLS 0행 필터로 거부(lock-out-in-disguise). 본 마이그가 coordinator ADDITIVE 로 해소.
--
-- ★PROD 실측(2026-06-30, pg_policies) — 착수 전 dev-foot 직접 확인:
--     · admin_write_phrase_templates [ALL] roles={admin,manager,director}  (모든 phrase_type)
--         └ 20260624180000_bundlerx_director_write_rls 가 {admin,manager}→+director 로 확대(stopgap).
--     · staff_read_phrase_templates  [SELECT] USING(true)
--   ※ 20260620120000_phrase_templates_staff_write_staffarea (staff_write_staffarea_phrases, 직원 5역할
--     pen/customer write) 는 ★PROD 에 미존재★ — repo 커밋(92a95431)은 있으나 실 apply 안 됨(DRIFT).
--     본 티켓은 coordinator 만 ADDITIVE 추가(요청 scope). 나머지 직원 role(consultant/therapist/
--     part_lead/staff) FE-open/RLS-block 드리프트는 planner FOLLOWUP 으로 별도 보고.
--
-- 패턴 근거 = STAFFPHRASE-EDIT-UNLOCK AC-3 DA CONSULT (MSG-20260620-114351-dnok / 08in, GO_WARN):
--   2-policy permissive ADDITIVE. 기존 admin_write_phrase_templates 는 ★무변경(ALTER/DROP 금지)★ —
--   신규 permissive 정책 coordinator_write_staffarea_phrases 만 ADD. permissive 정책은 OR 결합이므로
--   effective write = (admin/manager/director 모든 type) OR (coordinator, pen/customer 만).
--   본 건은 동일 패턴에 role=coordinator 만 적용(단일 role). autonomy §3.1: ADDITIVE+DA GO → 대표 게이트 불요.
--
-- §A 의무조건 (supervisor DDL-diff GO 게이트 · §11.1 의사영역 격리):
--   A-1: 신규정책 USING·WITH CHECK ★둘 다★ phrase_type IN ('pen_chart','customer_chart') 가드.
--        (WITH CHECK 에서 빼면 coordinator 가 pen→medical_chart 로 phrase_type 변조 가능 = 의사영역 침범 hole.
--         절대 제거 금지. medical_chart = 소견서·진료차트 = OPINIONPHRASE-EDIT-DIRECTOR-ONLY 무회귀.)
--   A-2: 기존 admin_write_phrase_templates 무변경(본 파일에 DROP/ALTER/CREATE admin_write 없음 — ADD only).
--   A-3: 침투테스트 3종 PASS (coordinator 토큰):
--        ① medical_chart INSERT → deny (WITH CHECK: phrase_type 가드 fail)
--        ② pen_chart UPDATE 로 phrase_type→medical_chart 변조 → WITH CHECK deny (신규 row phrase_type 가드 fail)
--        ③ medical_chart UPDATE/DELETE → USING deny (기존 row phrase_type 가드 fail)
--
-- cross-CRM 영향 0: phrase_templates 는 cross_crm_data_contract·schema_registry 미등재 foot-로컬.
-- 데이터 mutation 0 (CREATE POLICY DDL 만, backfill 없음). 롤백 = DROP POLICY (.rollback.sql).
-- 재실행 안전: DROP POLICY IF EXISTS + CREATE.
--
-- ⚠ APPLY 게이트: consult_pending(DA CONSULT 1차) GO + supervisor DDL-diff 선행 후 DB 직접 apply.
--   (DA GO 전 PROD apply 금지. 본 파일은 concrete policy 로 DA/supervisor 검토 대상.)

DROP POLICY IF EXISTS "coordinator_write_staffarea_phrases" ON public.phrase_templates;

CREATE POLICY "coordinator_write_staffarea_phrases"
  ON public.phrase_templates FOR ALL
  TO authenticated
  USING (
    phrase_type IN ('pen_chart', 'customer_chart')
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'coordinator'
        AND user_profiles.active = true
    )
  )
  WITH CHECK (
    phrase_type IN ('pen_chart', 'customer_chart')
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'coordinator'
        AND user_profiles.active = true
    )
  );

COMMENT ON POLICY "coordinator_write_staffarea_phrases" ON public.phrase_templates IS
  'T-20260630-foot-PHRASETMPL-CODY-WRITE-RLS: 상용구관리(pen_chart/customer_chart) coordinator write 개방. permissive ADDITIVE — admin_write_phrase_templates({admin,manager,director}) 와 OR. phrase_type 가드(USING+WITH CHECK 양쪽)로 medical_chart(의사영역) 차단. role=coordinator(단일). CODY-WRITE-PERM-PARITY-SWEEP GAP#3.';
