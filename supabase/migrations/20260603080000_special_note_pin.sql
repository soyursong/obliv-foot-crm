-- T-20260603-foot-RX-CHART-FOLLOWUP2 #10 (문지은 대표원장): 특이사항 핀 고정(맨위로)
--
-- 요건 (AC-10):
--   특이사항 항목을 개별 "핀(맨위로 고정)" → 고정 항목이 항상 목록 최상단.
--   고정 상태 영속 (is_pinned). 화면 재진입/새로고침 후에도 유지.
--
-- 설계 근거:
--   핀은 "임상 중요도" 표식이라 클리닉 공용(누가 봐도 맨 위) 이어야 한다.
--   그러나 기존 customer_special_notes 의 own_update_csn RLS 는 본인 작성분만 UPDATE 허용.
--   → 타인 작성 항목도 핀할 수 있어야 하므로, 컬럼 단위(is_pinned 만) 변경을 보장하는
--     SECURITY DEFINER RPC set_special_note_pin() 로 처리(content 등 본문은 불변 보장).
--     RPC 내부에서 clinic_id = current_user_clinic_id() 격리 검증.
--
-- 리스크: additive 컬럼 2개 + 신규 RPC. 기존 데이터/스키마/RLS 변경 없음.
-- 롤백: 20260603080000_special_note_pin.rollback.sql
-- supervisor 검증 후 dev-foot 직접 마이그레이션 (정책: dev-foot DB 마이그 직접 실행)

BEGIN;

-- 핀 고정 상태 (additive · 레거시 무영향 · 기본 false)
ALTER TABLE customer_special_notes
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

ALTER TABLE customer_special_notes
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

COMMENT ON COLUMN customer_special_notes.is_pinned IS
  'AC-10 특이사항 핀 고정(맨위로). true=상단 고정. 클리닉 공용 표식.';
COMMENT ON COLUMN customer_special_notes.pinned_at IS
  'AC-10 핀 고정 시각 (정렬 보조). NULL=미고정.';

-- 핀 우선 정렬 인덱스 (고정 먼저, 같은 그룹 내 최신순)
CREATE INDEX IF NOT EXISTS idx_csn_pin_order
  ON customer_special_notes(customer_id, is_pinned DESC, created_at DESC);

-- 핀 토글 RPC (컬럼 단위 변경 보장 + 클리닉 격리 검증)
--   타인 작성 항목도 핀 가능(공용 표식). 단 본문(content)은 불가침.
CREATE OR REPLACE FUNCTION set_special_note_pin(p_note_id uuid, p_pinned boolean)
RETURNS customer_special_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row customer_special_notes;
BEGIN
  UPDATE customer_special_notes
     SET is_pinned = p_pinned,
         pinned_at = CASE WHEN p_pinned THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_note_id
     AND clinic_id = current_user_clinic_id()  -- 동일 클리닉만
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION '특이사항 항목을 찾을 수 없거나 권한이 없습니다 (id=%)', p_note_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION set_special_note_pin(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION set_special_note_pin(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION set_special_note_pin(uuid, boolean) IS
  'AC-10 특이사항 핀 토글. 클리닉 격리 검증 후 is_pinned/pinned_at 만 변경(본문 불가침).';

-- 검증
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'customer_special_notes' AND column_name = 'is_pinned'
  ) THEN
    RAISE EXCEPTION 'is_pinned 컬럼 생성 실패';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_special_note_pin'
  ) THEN
    RAISE EXCEPTION 'set_special_note_pin RPC 생성 실패';
  END IF;
END $$;

COMMIT;
