-- T-20260625-foot-CLINICMGMT-3TAB-DIRECTOR-RBAC part2 — super_phrases director write RLS (ADDITIVE superset)
--
-- 현장(문지은 대표원장, director): 진료관리 3탭(슈퍼상용구/진료차트상용구/서류템플릿) 편집 불가.
--   RC: director 역할이 write RLS({admin,manager}) 미포함 → .update()/.insert() RLS 0행 필터.
--   BUNDLERX-ICON-NOAPPLY(a75cf28f) 형제 — 동일 클래스 RC. a75cf28f 가 doc/phrase/prescription 3정책을
--   admin,manager,director 로 확대했으나 super_phrases(슈퍼상용구)는 그 묶음에 미포함 → 본 part2 가 보충.
--
-- DA CONSULT-REPLY: az67(BUNDLERX) precedent ADDITIVE GO 라인. ★super_phrases 전용 GO 수신 후 적용★.
--   순수 role superset 추가만 — 기존 role(admin,manager) DROP/narrow 0. WITH CHECK 신설 0.
--   admin_write_super_phrases = FOR ALL + USING-only 패턴(20260603060000_super_phrases.sql:50-60)
--   → USING 에 'director' 추가 1곳으로 read+write 모두 커버
--   (FOR ALL 에서 WITH CHECK 생략 시 USING 식이 write check 로도 적용됨).
--
-- supervisor DDL-diff 조건 3 (superset / WITH CHECK 1:1(둘 다 없음) / 술어 무변경(role 배열에 director 1개 ADD)).
-- 대상 1정책: admin_write_super_phrases (super_phrases).
--
-- ★ Convergence carry: a75cf28f 와 동일 stopgap. has_ops_authority 적재 시 director 하드코딩 동시 수렴.
--
-- cross-CRM 영향 0: super_phrases = cross_crm_data_contract·schema_registry 미등재 foot-로컬.
-- 데이터 mutation 0 (DROP/CREATE POLICY DDL 만). 롤백 = .rollback.sql.
-- 재실행 안전: DROP POLICY IF EXISTS + CREATE.

BEGIN;

DROP POLICY IF EXISTS "admin_write_super_phrases" ON public.super_phrases;
CREATE POLICY "admin_write_super_phrases"
  ON public.super_phrases FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('admin', 'manager', 'director')
        AND user_profiles.active = true
    )
  );

COMMENT ON POLICY "admin_write_super_phrases" ON public.super_phrases IS
  'T-20260625-CLINICMGMT-3TAB-DIRECTOR-RBAC part2: write role admin,manager,director. director 추가는 has_ops_authority 적재 전 stopgap → 수렴 시 동시 정리.';

COMMIT;
