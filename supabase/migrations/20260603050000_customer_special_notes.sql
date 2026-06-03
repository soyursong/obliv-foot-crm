-- T-20260603-foot-CHART-SPECIAL-NOTE: 좌측 타임라인 ⑤ 특이사항 공용 누적칸
--
-- 요건 (AC-1):
--   환자 단위 특이사항 항목을 "날짜별 분기 없이" 공용 누적 저장.
--   각 항목에 기록자(작성 의사 email + 표시명) + 작성일시(created_at) 보존.
--   기존 항목 변경 없이 누적(append) 보존이 본질. 단, 오기 정정을 위해
--   본인 작성분 한정 UPDATE/DELETE 만 RLS 로 허용(타인 항목 불변 보장).
--
-- 설계 근거:
--   환자 단위 누적 + 기록자/작성일시 패턴은 customer_treatment_memos
--   (20260520000100) 와 동일 구조 재사용. 차이점은 "특이사항" 전용 분리 테이블이라
--   날짜/방문 분기(medical_charts.visit_date)에 묶이지 않는 공용 누적칸이라는 점.
--   clinic_id uuid + current_user_clinic_id() RLS 격리도 ctm 과 동일(최신 표준).
--
-- 리스크: 신규 테이블만. 기존 데이터/스키마 변경 없음. 소량 write.
-- 롤백: 20260603050000_customer_special_notes.rollback.sql
-- supervisor 검증 후 dev-foot 직접 마이그레이션 (정책: dev-foot DB 마이그레이션 직접 실행)

BEGIN;

-- 환자 단위 특이사항 공용 누적 테이블 (날짜별 분기 없음)
CREATE TABLE IF NOT EXISTS customer_special_notes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  clinic_id       uuid        NOT NULL REFERENCES clinics(id)   ON DELETE CASCADE,
  content         text        NOT NULL,
  created_by      text,        -- 작성자 email (auth.jwt()->>'email')
  created_by_name text,        -- 기록자(작성 의사) 표시명
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 환자별 최신순 조회 인덱스 (공용 누적칸 렌더)
CREATE INDEX IF NOT EXISTS idx_csn_customer_id ON customer_special_notes(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csn_clinic_id   ON customer_special_notes(clinic_id);

-- RLS: clinic_id 기준 격리 (customer_treatment_memos 와 동일 표준)
ALTER TABLE customer_special_notes ENABLE ROW LEVEL SECURITY;

-- SELECT: 동일 클리닉 인증 사용자 (전 항목 열람 — 공용 누적칸)
CREATE POLICY "clinic_isolation_csn_select" ON customer_special_notes
  FOR SELECT TO authenticated
  USING (clinic_id = current_user_clinic_id());

-- INSERT: 동일 클리닉 인증 사용자 (누적 추가)
CREATE POLICY "clinic_isolation_csn_insert" ON customer_special_notes
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = current_user_clinic_id());

-- UPDATE: 본인 작성분 한정 (오기 정정 — 타인 항목 불변 보장)
CREATE POLICY "own_update_csn" ON customer_special_notes
  FOR UPDATE TO authenticated
  USING   (created_by = auth.jwt()->>'email')
  WITH CHECK (created_by = auth.jwt()->>'email');

-- DELETE: 본인 작성분 한정
CREATE POLICY "own_delete_csn" ON customer_special_notes
  FOR DELETE TO authenticated
  USING (created_by = auth.jwt()->>'email');

COMMENT ON TABLE customer_special_notes IS
  '환자 단위 특이사항 공용 누적칸 (T-20260603-foot-CHART-SPECIAL-NOTE). 날짜 분기 없이 누적(append), 항목별 기록자/작성일시 보존.';

-- 검증
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'customer_special_notes'
  ) THEN
    RAISE EXCEPTION 'customer_special_notes 테이블 생성 실패';
  END IF;
END $$;

COMMIT;
