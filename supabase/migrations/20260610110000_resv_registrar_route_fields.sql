-- T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS
-- 예약경로 신규 + 예약등록자 편집형 마스터 + reservations 참조 컬럼
-- 작성: dev-foot / 2026-06-10
--
-- ⚠ 운영 적용은 supervisor DB-gate 이관 (운영 스키마 변경 권한). 롤백 SQL 동봉.
-- additive only — 기존 데이터 무손실(기존 컬럼/제약 미파괴).
--
-- 신규 DB 객체 (원 AC-4, AC-5):
--   1. reservations.visit_route          — 예약경로. customers.visit_route enum/CHECK 재사용(대분류 4값 SSOT). NULL 허용/기본 NULL.
--   2. reservation_registrars            — 예약등록자 편집형 마스터(원내/TM). clinic 스코프 + RLS + 초기 seed 원내4+TM4.
--   3. reservations.registrar_id (FK SET NULL) + reservations.registrar_name(스냅샷) — 고객박스 @등록자 표시 + 이력 안정성.
--
-- ⚠ 자매 티켓 STAFF-ROLE-TM-ADD(staff role 'TM')와 별개 모델:
--   reservation_registrars 는 staff 계정과 분리된 풋 내부 운영 명단. 동일 인명이 등장해도 staff FK 가 아님.
--
-- 롤백: 20260610110000_resv_registrar_route_fields.rollback.sql
-- 적용 방법 (supervisor DB-gate 실행):
--   supabase db push --file supabase/migrations/20260610110000_resv_registrar_route_fields.sql

BEGIN;

-- ============================================================
-- SECTION 1: reservations.visit_route (예약경로)
--   customers.visit_route 와 동일 enum/CHECK 재사용(대분류 4값). 신규 enum 신설 금지 — SSOT 준수.
-- ============================================================
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS visit_route TEXT
    CONSTRAINT reservations_visit_route_check
    CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개'));

COMMENT ON COLUMN public.reservations.visit_route IS
  'T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 예약경로(방문경로 대분류).'
  ' customers.visit_route enum/CHECK 재사용(SSOT, 신규 enum 미신설). NULL=미지정.';

-- ============================================================
-- SECTION 2: reservation_registrars (예약등록자 편집형 마스터)
--   관리자(admin/manager) 설정에서 CRUD. clinic 스코프 + RLS. 초기 seed 원내4+TM4.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reservation_registrars (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  group_name  TEXT        NOT NULL CHECK (group_name IN ('원내','TM')),
  name        TEXT        NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reservation_registrars_clinic_idx
  ON public.reservation_registrars(clinic_id, active, sort_order);

COMMENT ON TABLE public.reservation_registrars IS
  'T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 예약등록자 편집형 마스터(group_name 원내/TM).'
  ' 관리자 설정에서 추가/수정/비활성/정렬. ⚠ staff 계정과 분리된 운영 명단'
  ' — STAFF-ROLE-TM-ADD(staff role)와 별개 모델(동일 인명 등장해도 staff FK 아님).';

ALTER TABLE public.reservation_registrars ENABLE ROW LEVEL SECURITY;

-- 읽기: 같은 클리닉 활성/승인 계정 전체 (드롭다운 노출용)
CREATE POLICY "resv_registrars_select" ON public.reservation_registrars
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND clinic_id = reservation_registrars.clinic_id
        AND active = true
        AND approved = true
    )
  );

-- 쓰기(추가): admin/manager
CREATE POLICY "resv_registrars_insert" ON public.reservation_registrars
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND clinic_id = reservation_registrars.clinic_id
        AND active = true
        AND approved = true
        AND role IN ('admin', 'manager')
    )
  );

-- 수정(편집/비활성/정렬): admin/manager
CREATE POLICY "resv_registrars_update" ON public.reservation_registrars
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND clinic_id = reservation_registrars.clinic_id
        AND active = true
        AND approved = true
        AND role IN ('admin', 'manager')
    )
  );

-- 삭제: admin/manager (운영상 비활성 권장, 하드 삭제도 허용)
CREATE POLICY "resv_registrars_delete" ON public.reservation_registrars
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND clinic_id = reservation_registrars.clinic_id
        AND active = true
        AND approved = true
        AND role IN ('admin', 'manager')
    )
  );

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_reservation_registrars_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_registrars_updated_at ON public.reservation_registrars;
CREATE TRIGGER trg_reservation_registrars_updated_at
  BEFORE UPDATE ON public.reservation_registrars
  FOR EACH ROW EXECUTE FUNCTION update_reservation_registrars_updated_at();

-- 초기 seed: 모든 활성 clinic 에 원내4+TM4 (중복 방지 NOT EXISTS 가드)
INSERT INTO public.reservation_registrars (clinic_id, group_name, name, sort_order)
SELECT c.id, v.group_name, v.name, v.sort_order
FROM clinics c
CROSS JOIN (VALUES
  ('원내','김민경',1),
  ('원내','박민석',2),
  ('원내','장예지',3),
  ('원내','김지혜',4),
  ('TM','진운선',5),
  ('TM','이수빈',6),
  ('TM','김효신',7),
  ('TM','문해민',8)
) AS v(group_name, name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.reservation_registrars rr
  WHERE rr.clinic_id = c.id
    AND rr.group_name = v.group_name
    AND rr.name = v.name
);

-- ============================================================
-- SECTION 3: reservations.registrar_id + registrar_name
--   registrar_id  = 마스터 FK(ON DELETE SET NULL).
--   registrar_name = 저장 시점 스냅샷(마스터 리네임/삭제돼도 고객박스 표시 안정).
-- ============================================================
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS registrar_id   UUID REFERENCES public.reservation_registrars(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS registrar_name TEXT;

COMMENT ON COLUMN public.reservations.registrar_id IS
  'T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 예약등록자 마스터 FK(reservation_registrars). 마스터 삭제 시 SET NULL.';
COMMENT ON COLUMN public.reservations.registrar_name IS
  'T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 저장 시점 예약등록자 성함 스냅샷(고객박스 @표시·이력 안정).';

COMMIT;
