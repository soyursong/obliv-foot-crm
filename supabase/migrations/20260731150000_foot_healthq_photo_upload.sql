-- T-20260731-foot-FOOTQST-PHOTO-UPLOAD — 발건강질문지 고객 사진 첨부
-- 고객이 모바일 자가작성(/health-q/:token) 중 발/발톱 사진을 첨부 → 직원 차트에서 조회.
--
-- ★정본 근거: data-architect CONSULT-REPLY MSG-20260731-135832-y3x7 (GO + ADDITIVE 조건부).
--   SSOT=da_consult_reply_foot_footqst_photo_upload_20260731.md. 대표 게이트 EXEMPT(§3.1, 파괴적 DDL 무·계약 무저촉).
--
-- DA 판정 반영 (supervisor DDL-diff 강제 5항):
--   ① 신규 전용 private 버킷 foot-health-q-photos (public=false 강제). documents 재사용 REJECT.
--   ② anon 에 Storage 버킷 INSERT 직접 GRANT 금지 → anon storage.objects 정책 부재.
--      업로드=Pattern B(edge fn health-q-photo-sign 이 service_role 로 token-경로 한정 signed upload URL 발급).
--   ③ anon-write 경로 = token 경로(health-q/{clinic_id}/{token}/…) 한정.
--      경로 강제 지점 = (a) edge fn 이 검증토큰으로 경로 구성 (b) fn_health_q_submit 이 path prefix 재검증.
--   ④ 직원 SELECT = clinic 스코프 (테이블 RLS + storage.objects SELECT 정책 = path[2]=clinic_id 미러).
--      서빙=signed download URL only (버킷 private).
--   ⑤ 보관: health_q_photos.result_id → health_q_results ON DELETE CASCADE + clinic_id denorm.
--      ※ 행 CASCADE ≠ Storage 바이너리 삭제 → Storage object DELETE 정책 미부여(archive-first, hard-DELETE 금지).
--        draft 미제출 orphan(Storage token경로만·행 미생성) 정리 = health_q_tokens.expires_at 기준 별건 TTL sweep(follow-up).
--
-- 신규 테이블 1개: health_q_photos (1:N, jsonb photo_paths REJECT — per-photo 메타/RLS/CASCADE 위해 전용 테이블).
-- 변경 RPC 1개: fn_health_q_submit — p_photos 파라미터 추가(제출 시 사진 result 연관, path prefix 검증).
--
-- ★재실행 안전: IF NOT EXISTS / DROP POLICY IF EXISTS + CREATE / ON CONFLICT. 데이터 mutation 0 (DDL only).
-- ★cross-CRM 영향 0: health_q_photos = foot-도메인 로컬 신설(clinic_id 캐리=격리 불변식 충족). 계약 무저촉.
-- 롤백: 20260731150000_foot_healthq_photo_upload.rollback.sql

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1) 신규 전용 private 버킷 (public=false). 이미 존재해도 강제 private(재실행 안전).
-- ────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('foot-health-q-photos', 'foot-health-q-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ────────────────────────────────────────────────────────────────
-- 2) health_q_photos — 발건강질문지 첨부사진 (1:N, result_id FK CASCADE)
--    경로 컨벤션: health-q/{clinic_id}/{token}/{uuid}.{ext}
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.health_q_photos (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  result_id    UUID        NOT NULL REFERENCES public.health_q_results(id) ON DELETE CASCADE,
  clinic_id    UUID        NOT NULL REFERENCES public.clinics(id),   -- denorm: 직원 SELECT RLS 무조인 스코프
  storage_path TEXT        NOT NULL,                                  -- foot-health-q-photos 버킷 object path
  content_type TEXT,
  byte_size    INTEGER,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.health_q_photos IS
  'T-20260731-foot-FOOTQST-PHOTO-UPLOAD: 발건강질문지 고객 첨부사진 (1:N → health_q_results).
   PHI-image tier=restricted. 버킷 foot-health-q-photos(private). 경로 health-q/{clinic_id}/{token}/{uuid}.{ext}.
   행 CASCADE ≠ Storage 바이너리 삭제(archive-first, hard-DELETE 금지).';

CREATE INDEX IF NOT EXISTS idx_health_q_photos_result
  ON public.health_q_photos (result_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_health_q_photos_clinic
  ON public.health_q_photos (clinic_id, uploaded_at DESC);

-- ────────────────────────────────────────────────────────────────
-- 3) 테이블 RLS
--    SELECT: 직원 동일 clinic 만(clinic_id denorm 스코프). anon/patient 무정책.
--    INSERT/UPDATE/DELETE 정책 미부여 → 쓰기는 fn_health_q_submit(SECURITY DEFINER)만(RLS bypass).
--      = anon 이 health_q_photos 를 직접 write 하는 경로 부재(임의 path 주입 차단).
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.health_q_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "health_q_photos_select_clinic" ON public.health_q_photos;
CREATE POLICY "health_q_photos_select_clinic"
  ON public.health_q_photos FOR SELECT TO authenticated
  USING (clinic_id = public.current_user_clinic_id());

-- ────────────────────────────────────────────────────────────────
-- 4) storage.objects 정책 — 직원 SELECT clinic 스코프(테이블 RLS 미러).
--    경로 health-q/{clinic_id}/… → foldername[1]='health-q', [2]=clinic_id.
--    ★anon INSERT 정책 미부여 → 업로드는 service_role signed upload URL(edge fn)만(RLS bypass).
--    ★DELETE 정책 미부여 → Storage object 영구삭제 차단(archive-first 보존).
-- ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "health_q_photos_obj_read" ON storage.objects;
CREATE POLICY "health_q_photos_obj_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'foot-health-q-photos'
    AND (storage.foldername(name))[1] = 'health-q'
    AND (storage.foldername(name))[2] = public.current_user_clinic_id()::text
  );

-- ────────────────────────────────────────────────────────────────
-- 5) fn_health_q_submit — p_photos 파라미터 추가(제출 시 사진 result 연관).
--    기존 3-arg 은 DROP(named-arg 오버로드 ambiguity 방지) → 4-arg 단일화, p_photos DEFAULT '[]'.
--    본문 = 20260602240020(receiving 전이) 정본 보존 + 사진 INSERT 루프 추가.
--    각 사진 path 는 이 토큰/clinic 경로 prefix(health-q/{clinic_id}/{token}/) 재검증(임의 path 주입 차단).
-- ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS fn_health_q_submit(TEXT, JSONB, TEXT);

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

  -- ── 첨부사진 result 연관 (path prefix 재검증) ──────────────────────────────
  --   유효 prefix = health-q/{clinic_id}/{token}/  (edge fn 이 발급한 경로만 통과).
  --   불일치 path 는 무시(임의 path 주입 차단). 최대 10장.
  v_prefix := 'health-q/' || v_tok.clinic_id::text || '/' || p_token || '/';

  IF p_photos IS NOT NULL AND jsonb_typeof(p_photos) = 'array' THEN
    FOR v_photo IN SELECT * FROM jsonb_array_elements(p_photos)
    LOOP
      EXIT WHEN v_inserted >= 10;
      v_path := v_photo ->> 'path';
      v_ct   := v_photo ->> 'content_type';
      v_size := NULLIF(v_photo ->> 'byte_size', '')::INTEGER;

      IF v_path IS NOT NULL AND left(v_path, length(v_prefix)) = v_prefix THEN
        INSERT INTO health_q_photos (
          result_id, clinic_id, storage_path, content_type, byte_size, sort_order
        )
        VALUES (
          v_result_id, v_tok.clinic_id, v_path, v_ct, v_size, v_idx
        );
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
