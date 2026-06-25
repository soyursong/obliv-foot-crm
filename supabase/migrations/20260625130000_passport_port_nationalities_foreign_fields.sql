-- T-20260625-foot-PASSPORT-PORT — 피부과(derm) 여권/외국인 정보 풋CRM 이식
-- DA 게이트: CONSULT-REPLY MSG-20260625-120116-7wvx (GO 조건부 3정정 반영)
--   [정정1·HARD] customers.nationality_id = BIGINT (FK 타깃 nationalities.id=BIGSERIAL → 타입 정합)
--   [정정2] nationalities 에 default_language 컬럼 생성 금지 (언어 자동연결은 FE COUNTRY_DEFAULT_LANGUAGE 매핑)
--   [정정3·권고] foreigner_registration_number = RRN 동급 PHI → 저장보호 정합 권고(dev↔supervisor 판단; 본 이식은 plaintext + canEditSensitive 게이트, 암호화는 후속)
--
-- origin: obliv-derm-crm 20260424_batch1_up.sql(nationalities DDL) + 20260526_HARDCODE-REFDATA(code 컬럼)
--          + 20260615_NATIONALITY-EXPAND(13국 확장) → 현재 derm 23행 스냅샷 그대로 클론(독자설계 금지).
-- 안전: ADDITIVE only · IF NOT EXISTS · nullable · 백필 없음 · 멱등(ON CONFLICT name DO NOTHING)
-- 롤백: 20260625130000_passport_port_nationalities_foreign_fields.rollback.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] nationalities 마스터 (foot 부재 실측 → derm DDL 클론). id BIGSERIAL.
--     (정정2) default_language 컬럼 없음. 언어 자동연결은 FE 매핑으로만.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nationalities (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  code        TEXT,
  sort_order  INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.nationalities IS '국적 마스터 — derm 23행 스냅샷 클론. code=ISO 3166-1 alpha-2(국기 렌더). T-20260625-foot-PASSPORT-PORT';

-- [1-1] seed = derm 현재 23행 스냅샷(10 base + NATIONALITY-EXPAND 13국). 멱등.
--   (name,code) 튜플은 derm와 일치. id 는 로컬 발번(FK는 id 기준이므로 무관).
INSERT INTO public.nationalities (code, name, sort_order) VALUES
  ('KR', '대한민국',        0),
  ('CN', '중국',            1),
  ('JP', '일본',            2),
  ('TW', '대만',            3),
  ('HK', '홍콩',            4),
  ('MN', '몽골',            5),
  ('VN', '베트남',          6),
  ('TH', '태국',            7),
  ('ID', '인도네시아',      8),
  ('PH', '필리핀',          9),
  ('MY', '말레이시아',     10),
  ('SG', '싱가폴',         11),
  ('MM', '미얀마',         12),
  ('KH', '캄보디아',       13),
  ('RU', '러시아',         14),
  ('KZ', '카자흐스탄',     15),
  ('UZ', '우즈베키스탄',   16),
  ('US', '미국',           17),
  ('CA', '캐나다',         18),
  ('AU', '호주',           19),
  ('SA', '사우디아라비아', 20),
  ('GB', '영국',           21),
  ('DE', '독일',           22)
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] customers 신규 컬럼 (전부 nullable). passport_number(TEXT)·is_foreign(BOOL)는 기존 재사용.
--     (정정1) nationality_id = BIGINT REFERENCES nationalities(id) ON DELETE SET NULL.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS passport_first_name TEXT,
  ADD COLUMN IF NOT EXISTS passport_last_name  TEXT,
  ADD COLUMN IF NOT EXISTS nationality_id      BIGINT REFERENCES public.nationalities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS foreigner_registration_number TEXT,
  ADD COLUMN IF NOT EXISTS foreign_doc_expiry  DATE;

COMMENT ON COLUMN public.customers.passport_first_name IS '여권 영문 이름(Given names). T-20260625-foot-PASSPORT-PORT';
COMMENT ON COLUMN public.customers.passport_last_name  IS '여권 영문 성(Surname). T-20260625-foot-PASSPORT-PORT';
COMMENT ON COLUMN public.customers.nationality_id      IS '국적 FK → nationalities.id. T-20260625-foot-PASSPORT-PORT';
COMMENT ON COLUMN public.customers.foreigner_registration_number IS '외국인등록번호(RRN 동급 PHI — canEditSensitive 게이트). T-20260625-foot-PASSPORT-PORT';
COMMENT ON COLUMN public.customers.foreign_doc_expiry  IS '여권/체류 만료일(nullable·미래일 허용). T-20260625-foot-PASSPORT-PORT';

-- ─────────────────────────────────────────────────────────────────────────────
-- 검증
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='nationalities') THEN
    RAISE EXCEPTION 'nationalities 테이블 생성 실패';
  END IF;
  IF (SELECT COUNT(*) FROM public.nationalities) < 23 THEN
    RAISE EXCEPTION 'nationalities seed < 23행 (실제 %)', (SELECT COUNT(*) FROM public.nationalities);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='customers' AND column_name='nationality_id') THEN
    RAISE EXCEPTION 'customers.nationality_id 컬럼 추가 실패';
  END IF;
  -- nationality_id 타입 BIGINT 검증 (정정1 HARD)
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_name='customers' AND column_name='nationality_id') <> 'bigint' THEN
    RAISE EXCEPTION 'customers.nationality_id 타입이 bigint 아님 (FK 타입 불일치)';
  END IF;
END $$;

COMMIT;
