-- T-20260620-foot-STAFFPHRASE-EDIT-UNLOCK AC-3 — 상용구(펜차트/고객차트) 직원 write 개방 (RLS 확대)
--
-- 현장(김주연 총괄, U0ATDB587PV): "상용구(펜차트)·상용구(고객차트) 직원이 메인으로 쓰는데 편집 막힘".
--   FE 게이트(PhrasesTab canEdit)는 AC-2 로 직원 개방했으나, phrase_templates RLS write 가 {admin,manager} 만
--   허용(admin_write_phrase_templates) → 직원이 저장 시도하면 RLS 거부(lock-out-in-disguise). 본 마이그가 해소.
--
-- DA CONSULT-REPLY (MSG-20260620-114351-dnok / 08in, GO · ADDITIVE-safe, 대표 게이트 불요·supervisor DDL-diff만):
--   2-policy permissive ADDITIVE. 기존 admin_write_phrase_templates 는 ★무변경(ALTER/DROP 금지)★ —
--   신규 permissive 정책 staff_write_staffarea_phrases 만 ADD. permissive 정책은 OR 결합이므로
--   effective write = (admin/manager 모든 type) OR (5직원 role, pen/customer 만) = FE union 과 동일.
--
-- 신규 staff 정책 role set = {consultant, coordinator, therapist, part_lead, staff}
--   (admin/manager 는 기존 정책 旣커버 → 신규 중복 불요. director 미포함=의사영역 미터치. tm/technician 제외.)
--   ★role 실측(2026-06-20, user_profiles active): consultant4·coordinator7·therapist10·staff2 사용중,
--     part_lead0(enum 유효·future-proof, CHECK constraint 포함). enum 밖 직원 role 0 → lock-out 없음.
--   권한소스 = user_profiles EXISTS 룩업(기존 정책과 동일 메커니즘. JWT role claim 미사용 — foot JWT role 미보장).
--
-- §A 의무조건(supervisor DDL-diff GO 게이트):
--   A-1: 신규정책 USING·WITH CHECK ★둘 다★ phrase_type IN ('pen_chart','customer_chart') 가드.
--        (WITH CHECK 에서 빼면 staff 가 pen→medical_chart 로 phrase_type 변조 가능 = 의사영역 침범 hole. 절대 제거 금지.)
--   A-2: 기존 admin_write_phrase_templates 무변경(아래 DROP/CREATE 없음 — 본 파일은 ADD only).
--   A-3: 침투테스트 3종 PASS (staff 토큰):
--        ① medical_chart INSERT → deny (WITH CHECK: phrase_type 가드 fail + role 미일치)
--        ② pen_chart UPDATE 로 phrase_type→medical_chart 변조 → WITH CHECK deny (신규 row phrase_type 가드 fail)
--        ③ medical_chart UPDATE/DELETE → USING deny (기존 row phrase_type 가드 fail)
--
-- cross-CRM 영향 0: phrase_templates 는 cross_crm_data_contract·schema_registry 미등재 foot-로컬.
-- 데이터 mutation 0 (CREATE POLICY DDL 만, backfill 없음). 롤백 = DROP POLICY (.rollback.sql).
-- 재실행 안전: DROP POLICY IF EXISTS + CREATE.

DROP POLICY IF EXISTS "staff_write_staffarea_phrases" ON public.phrase_templates;

CREATE POLICY "staff_write_staffarea_phrases"
  ON public.phrase_templates FOR ALL
  TO authenticated
  USING (
    phrase_type IN ('pen_chart', 'customer_chart')
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('consultant', 'coordinator', 'therapist', 'part_lead', 'staff')
        AND user_profiles.active = true
    )
  )
  WITH CHECK (
    phrase_type IN ('pen_chart', 'customer_chart')
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('consultant', 'coordinator', 'therapist', 'part_lead', 'staff')
        AND user_profiles.active = true
    )
  );

COMMENT ON POLICY "staff_write_staffarea_phrases" ON public.phrase_templates IS
  'T-20260620-foot-STAFFPHRASE-EDIT-UNLOCK AC-3: 상용구관리(pen_chart/customer_chart) 직원 write 개방. permissive ADDITIVE — admin_write_phrase_templates({admin,manager}) 와 OR. phrase_type 가드(USING+WITH CHECK 양쪽)로 medical_chart(의사영역) 차단. role={consultant,coordinator,therapist,part_lead,staff}.';
