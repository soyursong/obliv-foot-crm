/**
 * T-20260525-foot-FEE-SET-TEMPLATE AC-3
 * fee_set_templates 기본 시드 3건 (초진/무좀 · 초진/내성 · 재진/내성)
 * Supabase Management API 방식
 *
 * 실행: node scripts/apply_20260525020000_fee_set_templates_seed.mjs
 * 필요: SUPABASE_ACCESS_TOKEN 환경변수
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

async function runSQL(sql, label) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!resp.ok) {
    throw new Error(`${label} failed (${resp.status}): ${JSON.stringify(body)}`);
  }
  console.log(`✅ ${label}`);
  return body;
}

console.log('🚀 fee_set_templates 시드 삽입 (T-20260525-foot-FEE-SET-TEMPLATE AC-3)');

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// Step 1: 서비스 ID 조회
const svcRes = await runSQL(`
  SELECT service_code, id, name
  FROM services
  WHERE clinic_id = '${CLINIC_ID}'
    AND service_code IN ('AA154', 'PC', 'SZ035-35', 'D620300HZ', '원인제거', 'BC1300MB08', 'AA254', 'M0111')
    AND active = true
  ORDER BY service_code;
`, 'services 조회');

const svcMap = {};
for (const row of (svcRes ?? [])) {
  svcMap[row.service_code] = { id: row.id, name: row.name };
}
console.log('📦 조회된 서비스:', Object.entries(svcMap).map(([k, v]) => `${k}=${v.name}`).join(', '));

// Step 2: 기존 시드 확인
const existsRes = await runSQL(`
  SELECT set_name FROM fee_set_templates
  WHERE clinic_id = '${CLINIC_ID}'
    AND set_name IN ('초진/무좀', '초진/내성', '재진/내성')
    AND is_active = true;
`, '기존 시드 확인');

const existing = new Set((existsRes ?? []).map((r) => r.set_name));
if (existing.size > 0) {
  console.log(`ℹ️  이미 존재하는 세트: ${[...existing].join(', ')}`);
}

// Step 3: 시드 삽입 (없는 것만)

async function insertSeed(setName, services, sortOrder) {
  if (existing.has(setName)) {
    console.log(`ℹ️  ${setName} — 이미 존재, 스킵`);
    return;
  }
  const missing = services.filter((code) => !svcMap[code]);
  if (missing.length > 0) {
    console.warn(`⚠️  ${setName} — 서비스 미존재: ${missing.join(', ')} — 스킵`);
    return;
  }
  const items = JSON.stringify(
    services.map((code, idx) => ({ service_id: svcMap[code].id, sort_order: idx + 1 }))
  ).replace(/'/g, "''");

  await runSQL(`
    INSERT INTO fee_set_templates (clinic_id, set_name, items, is_active, sort_order)
    VALUES (
      '${CLINIC_ID}',
      '${setName}',
      '${items}'::jsonb,
      true,
      ${sortOrder}
    );
  `, `${setName} 삽입`);
}

await insertSeed('초진/무좀', ['AA154', 'PC', 'SZ035-35', 'D620300HZ'], 1);
await insertSeed('초진/내성', ['AA154', '원인제거', 'BC1300MB08'], 2);
await insertSeed('재진/내성', ['AA254', 'M0111', '원인제거', 'BC1300MB08'], 3);

// Step 4: 최종 확인
const finalRes = await runSQL(`
  SELECT set_name, jsonb_array_length(items) AS item_count, sort_order
  FROM fee_set_templates
  WHERE clinic_id = '${CLINIC_ID}'
  ORDER BY sort_order;
`, '최종 상태 확인');

console.log('\n📋 fee_set_templates 최종 상태:');
for (const row of (finalRes ?? [])) {
  console.log(`  ✔ ${row.set_name} (항목 ${row.item_count}개, sort_order=${row.sort_order})`);
}
console.log('\n🎉 완료!');
