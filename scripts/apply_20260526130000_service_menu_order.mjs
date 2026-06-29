/**
 * T-20260526-foot-PMW-SIDE-MENU-FEAT AC-6
 * service_menu_order 테이블 신규 생성
 * Supabase client + service_role 경유 (RPC 방식)
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  db: { schema: 'public' },
  auth: { persistSession: false },
});

console.log('🔍 service_menu_order 테이블 존재 여부 확인...');

// 테이블 존재 확인 (SELECT 시도)
const { error: checkErr } = await supabase
  .from('service_menu_order')
  .select('id')
  .limit(1);

if (!checkErr) {
  console.log('✅ service_menu_order 테이블이 이미 존재합니다. 마이그레이션 스킵.');
  process.exit(0);
}

console.log('📋 테이블 없음 — Supabase Dashboard에서 수동 SQL 실행이 필요합니다.');
console.log('');
console.log('=== SQL to run in Supabase SQL Editor ===');
console.log(`
CREATE TABLE IF NOT EXISTS service_menu_order (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     text         NOT NULL,
  foot_cat      text         NOT NULL,
  service_id    uuid         NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  display_order integer      NOT NULL DEFAULT 0,
  created_at    timestamptz  DEFAULT now(),
  updated_at    timestamptz  DEFAULT now(),
  UNIQUE (clinic_id, foot_cat, service_id)
);

CREATE INDEX IF NOT EXISTS idx_smo_clinic_cat_order
  ON service_menu_order (clinic_id, foot_cat, display_order);

ALTER TABLE service_menu_order ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic members can manage service_menu_order"
  ON service_menu_order
  FOR ALL
  USING  (true)
  WITH CHECK (true);
`);
console.log('=========================================');

// エラー詳細表示
console.log('\n체크 에러 상세:', checkErr?.message);
