-- ============================================================
-- T-20260521-foot-CLINIC-INFO-SYNC: 오블리브의원 서울 오리진점 병원정보 등록
-- ============================================================
-- 배경: 병원명·팩스·대표번호·사업자등록번호가 CRM DB에 미등록
--       → 서류 출력 시 해당 필드 공백으로 출력됨
-- 안전: 단일 클리닉 레코드 UPDATE (slug='jongno-foot') — 스키마 변경 없음
-- 롤백: 20260521100000_seed_jongno_foot_clinic_info.down.sql
-- ============================================================

BEGIN;

-- dry-run: 현재 값 확인 (변경 전)
DO $$
DECLARE
  v_id     UUID;
  v_name   TEXT;
  v_phone  TEXT;
  v_fax    TEXT;
  v_bno    TEXT;
BEGIN
  SELECT id, name, phone, fax, business_no
    INTO v_id, v_name, v_phone, v_fax, v_bno
    FROM clinics
   WHERE slug = 'jongno-foot';

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'clinics 레코드(slug=jongno-foot) 없음 — 마이그레이션 중단';
  END IF;

  RAISE NOTICE '[DRY-RUN BEFORE] id=%, name=%, phone=%, fax=%, business_no=%',
    v_id, v_name, v_phone, v_fax, v_bno;
END $$;

-- 병원정보 등록
UPDATE clinics
SET
  name         = '오블리브의원 서울 오리진점',
  phone        = '02-6956-3438',
  fax          = '02-6956-3439',
  business_no  = '511-60-00988'
WHERE slug = 'jongno-foot';

-- 적용 확인
DO $$
DECLARE
  v_id     UUID;
  v_name   TEXT;
  v_phone  TEXT;
  v_fax    TEXT;
  v_bno    TEXT;
BEGIN
  SELECT id, name, phone, fax, business_no
    INTO v_id, v_name, v_phone, v_fax, v_bno
    FROM clinics
   WHERE slug = 'jongno-foot';

  IF v_name != '오블리브의원 서울 오리진점' THEN
    RAISE EXCEPTION '병원명 업데이트 실패: %', v_name;
  END IF;
  IF v_phone != '02-6956-3438' THEN
    RAISE EXCEPTION '전화번호 업데이트 실패: %', v_phone;
  END IF;
  IF v_fax != '02-6956-3439' THEN
    RAISE EXCEPTION '팩스 업데이트 실패: %', v_fax;
  END IF;
  IF v_bno != '511-60-00988' THEN
    RAISE EXCEPTION '사업자등록번호 업데이트 실패: %', v_bno;
  END IF;

  RAISE NOTICE '[VERIFY OK] id=%, name=%, phone=%, fax=%, business_no=%',
    v_id, v_name, v_phone, v_fax, v_bno;
END $$;

COMMIT;
