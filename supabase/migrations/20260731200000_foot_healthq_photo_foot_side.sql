-- T-20260731-foot-FOOTQST-PHOTO-2SLOT-LR-BOTTOM — 발건강질문지 첨부사진 오른발/왼발 2슬롯 구분(laterality)
--
-- ★정본 근거: data-architect CONSULT-REPLY MSG-20260731-154603-u7l6 (Path B GO + ADDITIVE).
--   dev-foot 회신본 MSG-20260731-153248-lz5d. SSOT=da_consult_reply_foot_footqst_photo_upload_20260731.md ADDENDUM(2026-07-31).
--   판정: Path B(명시 laterality 컬럼) GO / Path A(sort_order 오버로드) REJECT(semantic overload — 정렬축 ≠ 좌/우축).
--   parent 정본: T-20260731-foot-FOOTQST-PHOTO-UPLOAD (health_q_photos, 20260731150000, deploy-ready d0412c42).
--
-- DA 확정 스키마:
--   ① foot_side TEXT NULL CHECK (foot_side IS NULL OR foot_side IN ('L','R')).
--      매핑 pin: 오른발=Right='R' / 왼발=Left='L' (FE 슬롯라벨→값 상수 고정, swap 금지).
--      NULL 허용 필수: 기존/generic 무-side 업로드 = NULL → ADDITIVE·회귀0. 2-slot 경로만 L/R set.
--      표기 대문자 L/R (cross-CRM laterality canonical). 소문자/한글/left·right 금지.
--   ② (RECOMMENDED-OPTIONAL, 채택) 슬롯당 1장 DB 강제: partial UNIQUE INDEX (result_id, foot_side) WHERE foot_side IS NOT NULL.
--      NULL(generic/legacy) 다건 무영향(partial) + 기존행 default NULL → 무충돌·ADDITIVE-safe. RPC 는 ON CONFLICT DO NOTHING 로 방어.
--   ③ RPC fn_health_q_submit(4-arg): p_photos[].foot_side 를 읽어 INSERT. 유효값(L/R) 외는 NULL 로 강등(제출 무중단).
--
-- PHI/cross-CRM: foot_side = 비-PHI laterality 라벨. 질문지 응답값/산식/매출/큐카드 downstream 무접점.
--   §2-23 PHI-image 우산·버킷(foot-health-q-photos)/RLS/CASCADE 계약 무변. foot-로컬 additive 저촉0.
--
-- 게이트: GO+ADDITIVE → supervisor DDL-diff만(대표 게이트 EXEMPT, autonomy §3.1).
-- ★재실행 안전: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS + CREATE OR REPLACE. 데이터 mutation 0.
-- ★기존행 백필 불요: 기존 health_q_photos 행은 foot_side default NULL → 회귀0.
-- 롤백: 20260731200000_foot_healthq_photo_foot_side.rollback.sql

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1) foot_side 컬럼 (nullable + CHECK L/R). 기존행 default NULL(백필 불요·회귀0).
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.health_q_photos
  ADD COLUMN IF NOT EXISTS foot_side TEXT NULL
  CHECK (foot_side IS NULL OR foot_side IN ('L','R'));

COMMENT ON COLUMN public.health_q_photos.foot_side IS
  'T-20260731-foot-FOOTQST-PHOTO-2SLOT: 발 좌/우 laterality (오른발=R, 왼발=L). NULL=무구분(generic/legacy). 비-PHI 라벨. cross-CRM canonical 대문자 L/R.';

-- ────────────────────────────────────────────────────────────────
-- 2) (OPT, DA RECOMMENDED) 슬롯당 1장 DB 강제 — partial unique(foot_side NOT NULL 만).
--    NULL(generic/legacy) 다건 무영향 + 기존행 default NULL → 무충돌·ADDITIVE-safe(supervisor DDL-diff ③).
-- ────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_health_q_photos_result_side
  ON public.health_q_photos (result_id, foot_side)
  WHERE foot_side IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 3) fn_health_q_submit(4-arg) — p_photos[].foot_side 읽어 INSERT(laterality 연결).
--    ★signature 불변(4-arg) → CREATE OR REPLACE(DROP 불요, ambiguity 무).
--    본문 = parent 정본(20260731150000) 보존 + foot_side 파싱/검증/INSERT + partial-uq ON CONFLICT 방어.
--    유효 prefix 검증(health-q/{clinic_id}/{token}/) 및 receiving→consult_waiting 전이 로직 무변.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_health_q_submit(
  p_token        TEXT,
  p_form_data    JSONB,
  p_storage_path TEXT  DEFAULT NULL,
  p_photos       JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok       health_q_tokens%ROWTYPE;
  v_result_id UUID;
  v_prefix    TEXT;
  v_photo     JSONB;
  v_path      TEXT;
  v_ct        TEXT;
  v_size      INTEGER;
  v_side      TEXT;
  v_idx       INTEGER := 0;
  v_inserted  INTEGER := 0;
BEGIN
  -- FOR UPDATE: 동시 제출 race condition 방지
  SELECT * INTO v_tok
  FROM   health_q_tokens
  WHERE  token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_not_found');
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_submitted');
  END IF;

  IF v_tok.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_expired');
  END IF;

  INSERT INTO health_q_results (
    token_id, customer_id, clinic_id, check_in_id,
    form_type, form_data, storage_path, submitted_at
  )
  VALUES (
    v_tok.id, v_tok.customer_id, v_tok.clinic_id, v_tok.check_in_id,
    v_tok.form_type, p_form_data, p_storage_path, now()
  )
  RETURNING id INTO v_result_id;

  UPDATE health_q_tokens
  SET    used_at = now()
  WHERE  id = v_tok.id;

  -- ── 첨부사진 result 연관 (path prefix 재검증 + foot_side laterality) ──────────
  --   유효 prefix = health-q/{clinic_id}/{token}/  (edge fn 이 발급한 경로만 통과).
  --   foot_side = 대문자 L/R 만 유효, 그 외/누락은 NULL(generic)로 강등(제출 무중단).
  --   partial unique(result_id, foot_side) 충돌 시 ON CONFLICT DO NOTHING(방어). 최대 10장.
  v_prefix := 'health-q/' || v_tok.clinic_id::text || '/' || p_token || '/';

  IF p_photos IS NOT NULL AND jsonb_typeof(p_photos) = 'array' THEN
    FOR v_photo IN SELECT * FROM jsonb_array_elements(p_photos)
    LOOP
      EXIT WHEN v_inserted >= 10;
      v_path := v_photo ->> 'path';
      v_ct   := v_photo ->> 'content_type';
      v_size := NULLIF(v_photo ->> 'byte_size', '')::INTEGER;
      v_side := upper(NULLIF(trim(v_photo ->> 'foot_side'), ''));
      IF v_side IS NOT NULL AND v_side NOT IN ('L', 'R') THEN
        v_side := NULL;  -- 비정상값 → generic(NULL) 강등
      END IF;

      IF v_path IS NOT NULL AND left(v_path, length(v_prefix)) = v_prefix THEN
        INSERT INTO health_q_photos (
          result_id, clinic_id, storage_path, content_type, byte_size, sort_order, foot_side
        )
        VALUES (
          v_result_id, v_tok.clinic_id, v_path, v_ct, v_size, v_idx, v_side
        )
        ON CONFLICT (result_id, foot_side) WHERE foot_side IS NOT NULL DO NOTHING;
        v_inserted := v_inserted + 1;
      END IF;
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- T-20260602-foot-CHECKIN-RECEIVING-SLOT AC-2: receiving → consult_waiting 전이
  IF v_tok.check_in_id IS NOT NULL THEN
    UPDATE check_ins
    SET    status = 'consult_waiting'
    WHERE  id = v_tok.check_in_id
      AND  status = 'receiving';

    -- 실제 전이가 발생한 경우만 감사 로그
    IF FOUND THEN
      INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status)
      VALUES (v_tok.check_in_id, v_tok.clinic_id, 'receiving', 'consult_waiting');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success',      true,
    'result_id',    v_result_id,
    'photos_saved', v_inserted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_submit(TEXT, JSONB, TEXT, JSONB) TO anon, authenticated;

COMMIT;
