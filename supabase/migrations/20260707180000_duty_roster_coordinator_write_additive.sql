-- T-20260707-foot-DUTYROSTER-COORDINATOR-WRITE-RLS
-- 근무스케줄표(DutyRosterTab) coordinator 기입 불가 해소 — ADDITIVE RLS
--
-- DA CONSULT-REPLY(MSG-20260707-204413-049e) 가설 A 확정: 비충돌·직교·ADDITIVE.
--   duty_roster write = 운영/HR 스케줄링 표면. §12-3 EXCL-3·진료관리 EDIT(director)과 직교.
--   현 admin/manager-only = 과소provisioning(버그). 편집모델=중앙관리형(a) → write set {admin,manager,coordinator}.
--
-- diagnose-first 실측(20260707180000_diag):
--   (A) prod pg_policies: INSERT/UPDATE/DELETE 3정책 모두 role IN ('admin','manager') → coordinator 배제 실재. db_change:true.
--   (B) clinic_id 컬럼 존재 + clinics 2건(다지점) → clinic 스코프 술어 유지(role-only 아님).
--   ❌ self-match(staff.id=auth.uid()) 미사용(§12-4 준수) — 기존 술어는 user_profiles.id=auth.uid() 앱신원 매핑.
--
-- ADDITIVE 형태: 기존 admin/manager 정책 3건 불변 + coordinator용 별도 permissive 정책 3건 추가(RLS OR 결합).
--   롤백 = 신규 coordinator 정책 3건 DROP(기존 정책 복원 불요·불변). enum·컬럼·데이터 불변 → 권한 확대(축소 아님) → lock-out 리스크 0.
--   술어는 기존 admin/manager 정책과 동일 구조(clinic 스코프+승인게이트) 유지, role만 'coordinator'.

-- coordinator: INSERT
CREATE POLICY "duty_roster_insert_coordinator" ON duty_roster
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = duty_roster.clinic_id
        AND active    = true
        AND approved  = true
        AND role      = 'coordinator'
    )
  );

-- coordinator: UPDATE
CREATE POLICY "duty_roster_update_coordinator" ON duty_roster
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = duty_roster.clinic_id
        AND active    = true
        AND approved  = true
        AND role      = 'coordinator'
    )
  );

-- coordinator: DELETE
CREATE POLICY "duty_roster_delete_coordinator" ON duty_roster
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = duty_roster.clinic_id
        AND active    = true
        AND approved  = true
        AND role      = 'coordinator'
    )
  );

-- 원장 기록
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260707180000', 'duty_roster_coordinator_write_additive')
ON CONFLICT (version) DO NOTHING;
