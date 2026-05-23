-- ============================================================
-- T-20260522-foot-CLINIC-JONGNO-ORIGIN: 종로 오리진점 풋센터 DB 등록 확인
-- ============================================================
-- 배경: 5/22 commit 9f4ea6c 작업 중 종로 오리진점 slug가 롱레 DB에
--       잘못 등록됨. 풋 Supabase(rxlomoozakkjesdqjtvd)에 올바르게
--       등록되어 있는지 확인하고, 미등록 시 INSERT.
-- 안전: INSERT ON CONFLICT DO NOTHING — 이미 존재하면 no-op
-- 롤백: 20260523020000_verify_jongno_foot_clinic.down.sql
-- ============================================================

BEGIN;

-- AC-1: 풋 Supabase clinics 테이블에 jongno-foot 등록 (idempotent)
INSERT INTO clinics (
  slug,
  name,
  address,
  open_time,
  close_time,
  weekend_close_time,
  slot_interval,
  consultation_rooms,
  treatment_rooms,
  laser_rooms,
  exam_rooms
)
VALUES (
  'jongno-foot',
  '오블리브의원 서울 오리진점',
  '서울 종구 청계천로 93 5층',
  '10:00',
  '22:00',
  '19:00',
  30,
  5,
  10,
  12,
  1
)
ON CONFLICT (slug) DO NOTHING;

-- 검증: jongno-foot 존재 확인
DO $$
DECLARE
  v_id   UUID;
  v_name TEXT;
BEGIN
  SELECT id, name
    INTO v_id, v_name
    FROM clinics
   WHERE slug = 'jongno-foot';

  IF v_id IS NULL THEN
    RAISE EXCEPTION '[FAIL] clinics 레코드(slug=jongno-foot) 존재하지 않음 — 마이그레이션 실패';
  END IF;

  RAISE NOTICE '[OK] jongno-foot 확인 완료: id=%, name=%', v_id, v_name;
END $$;

COMMIT;
