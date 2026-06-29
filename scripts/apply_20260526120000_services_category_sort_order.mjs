/**
 * T-20260526-foot-SVC-CATEGORY-SORT AC-2, AC-4, AC-5
 * services.sort_order — (clinic_id, category_label) 단위 재정규화 + 인덱스 추가
 * Supabase Management API 경유 실행
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const PROJ_REF     = 'rxlomoozakkjesdqjtvd';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// 1. 인덱스 생성 (sort_order 재정규화보다 먼저 인덱스를 생성하면 추후 조회 최적화)
const SQL_INDEX = `
CREATE INDEX IF NOT EXISTS idx_services_clinic_catlabel_sort
  ON services(clinic_id, category_label, sort_order);

COMMENT ON COLUMN services.sort_order IS
  'T-20260526-foot-SVC-CATEGORY-SORT: 서비스관리 탭 내 표시 순서. (clinic_id, category_label) 단위로 독립 관리. 드래그앤드롭/↑↓ 버튼으로 변경 후 DB 저장. 값: 0, 10, 20, 30... (10 단위)';
`;

// 2. sort_order 재정규화 (clinic_id, category_label) PARTITION
const SQL_NORMALIZE = `
WITH ranked AS (
  SELECT
    id,
    (ROW_NUMBER() OVER (
      PARTITION BY clinic_id, COALESCE(category_label, '')
      ORDER BY sort_order ASC, name ASC
    ) - 1) * 10 AS new_order
  FROM services
)
UPDATE services s
SET sort_order = r.new_order
FROM ranked r
WHERE s.id = r.id;
`;

console.log('🚀 T-20260526-foot-SVC-CATEGORY-SORT: services sort_order 재정규화 시작');

// Step 1: 인덱스 + COMMENT
console.log('📋 Step 1: 인덱스 생성 + COMMENT ...');
const resp1 = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
  },
  body: JSON.stringify({ query: SQL_INDEX }),
});

if (!resp1.ok) {
  const text = await resp1.text();
  console.log(`⚠️  Step 1 응답 ${resp1.status}: ${text}`);
} else {
  const body = await resp1.json();
  console.log('✅ Step 1 완료:', JSON.stringify(body).slice(0, 150));
}

// Step 2: sort_order 재정규화
console.log('📋 Step 2: sort_order (clinic_id, category_label) 단위 재정규화 ...');
const resp2 = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
  },
  body: JSON.stringify({ query: SQL_NORMALIZE }),
});

if (!resp2.ok) {
  const text = await resp2.text();
  console.log(`⚠️  Step 2 응답 ${resp2.status}: ${text}`);
} else {
  const body = await resp2.json();
  console.log('✅ Step 2 완료:', JSON.stringify(body).slice(0, 150));
}

// 검증: 기본 탭 sort_order 분포 확인
console.log('\n🔍 검증: 기본 탭 sort_order 확인 (상위 5개)...');
const { data: sample, error: sampleErr } = await supabase
  .from('services')
  .select('name, category_label, sort_order')
  .eq('category_label', '기본')
  .order('sort_order', { ascending: true })
  .limit(5);

if (sampleErr) {
  console.error('❌ 검증 쿼리 실패:', sampleErr.message);
} else {
  console.log('✅ 기본 탭 상위 5개:');
  sample?.forEach((s) => {
    console.log(`   sort_order=${s.sort_order} → ${s.name}`);
  });
}

console.log('\n✅ 마이그레이션 완료: 20260526120000_services_category_sort_order');
