-- 풋센터 수가표 시드: 정찰가 / 패키지1 / 패키지2 / 블레라벨 / 1month / NoPain
-- 녹취록 + 내부 자료 기반 가격 반영
-- category = 'package_tier' 로 패키지 가격표 구분

-- 기존 서비스에 discount_price 컬럼이 없다면 추가
ALTER TABLE services ADD COLUMN IF NOT EXISTS discount_price integer;

-- 패키지 가격표 (package_tiers 테이블) 신설
CREATE TABLE IF NOT EXISTS package_tiers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  tier_name text NOT NULL,           -- '정찰가', '패키지1', '패키지2', '블레라벨', '1month', 'NoPain'
  sessions integer NOT NULL,
  heated_sessions integer NOT NULL DEFAULT 0,
  unheated_sessions integer NOT NULL DEFAULT 0,
  iv_sessions integer NOT NULL DEFAULT 0,
  preconditioning_sessions integer NOT NULL DEFAULT 0,
  total_price integer NOT NULL,      -- 총 패키지 가격
  per_session_price integer NOT NULL, -- 회당 환산가
  includes_shot_upgrade boolean DEFAULT false,
  includes_af_upgrade boolean DEFAULT false,
  description text,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE package_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_full_package_tiers" ON package_tiers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_package_tiers" ON package_tiers FOR SELECT TO anon USING (true);

-- 수가표 시드 데이터
-- 기준: 가열레이저 정찰가 34만, 콤보 42만
-- 패키지1(12회) / 패키지2(24회) / 블레라벨(36회) / 1month(4회) / NoPain(48회)

INSERT INTO package_tiers (clinic_id, tier_name, sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_price, per_session_price, includes_shot_upgrade, includes_af_upgrade, description, sort_order)
SELECT c.id, t.tier, t.sess, t.heated, t.unheated, t.iv, t.precon, t.total, t.per_sess, t.shot, t.af, t.descr, t.sorder
FROM clinics c, (VALUES
  -- 정찰가 (단건)
  ('정찰가',   1,  1, 0, 0, 0,  340000, 340000, false, false, '가열 레이저 단건 정찰가', 1),

  -- 패키지1 (12회) - 가열12
  ('패키지1',  12, 12, 0, 0, 0, 3600000, 300000, false, false, '가열 레이저 12회 기본 패키지', 10),

  -- 패키지2 (24회) - 가열12 + 비가열12
  ('패키지2',  24, 12, 12, 0, 0, 6000000, 250000, false, false, '가열12 + 비가열12 콤보 패키지', 20),

  -- 블레라벨 (36회) - 가열12 + 비가열12 + 수액12 + 프리컨12
  ('블레라벨', 36, 12, 12, 12, 12, 8400000, 233333, true, false, '가열12+비가열12+수액12+프리컨12 프리미엄', 30),

  -- 1month (4회) - 가열4, 1개월 집중 프로그램
  ('1month',   4,  4, 0, 0, 0, 1200000, 300000, false, false, '1개월 집중 가열 레이저 4회', 40),

  -- NoPain (48회) - 가열12 + 비가열12 + 수액12 + 프리컨12 + AF 업그레이드
  ('NoPain',   48, 12, 12, 12, 12, 10800000, 225000, true, true, '가열12+비가열12+수액12+프리컨12+AF업그레이드 최상위', 50)
) AS t(tier, sess, heated, unheated, iv, precon, total, per_sess, shot, af, descr, sorder)
WHERE c.slug = 'jongno-foot'
ON CONFLICT DO NOTHING;
