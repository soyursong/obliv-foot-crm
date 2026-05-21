/**
 * T-20260521-foot-CLINIC-INFO-SYNC
 * 오블리브의원 서울 오리진점 병원정보 CRM DB 등록
 * name / phone / fax / business_no UPDATE
 *
 * 실행: SUPABASE_ACCESS_TOKEN=... node scripts/apply_20260521100000_seed_clinic_info.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

async function query(sql) {
  const res = await fetch(
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
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function run() {
  // ── Step 1: dry-run — 현재 값 확인 ──
  console.log('🔍 [dry-run] 현재 clinic 데이터 확인...');
  const before = await query(
    `SELECT id, name, phone, fax, business_no FROM clinics WHERE slug = 'jongno-foot';`,
  );
  console.log('Before:', JSON.stringify(before, null, 2));

  if (!before || (Array.isArray(before) && before.length === 0)) {
    console.error('❌ clinics 레코드(slug=jongno-foot) 없음 — 마이그레이션 중단');
    process.exit(1);
  }

  // ── Step 2: UPDATE ──
  console.log('\n⚙️  병원정보 UPDATE 중...');
  await query(`
    UPDATE clinics
    SET
      name        = '오블리브의원 서울 오리진점',
      phone       = '02-6956-3438',
      fax         = '02-6956-3439',
      business_no = '511-60-00988'
    WHERE slug = 'jongno-foot';
  `);

  // ── Step 3: 검증 ──
  console.log('\n🔍 [verify] 적용 후 데이터 확인...');
  const after = await query(
    `SELECT id, name, phone, fax, business_no FROM clinics WHERE slug = 'jongno-foot';`,
  );
  console.log('After:', JSON.stringify(after, null, 2));

  const row = Array.isArray(after) ? after[0] : after;
  const ok =
    row?.name        === '오블리브의원 서울 오리진점' &&
    row?.phone       === '02-6956-3438' &&
    row?.fax         === '02-6956-3439' &&
    row?.business_no === '511-60-00988';

  if (!ok) {
    console.error('❌ 검증 실패 — 데이터가 예상과 다름');
    process.exit(1);
  }

  console.log('\n✅ 병원정보 등록 완료');
  console.log('  name        :', row.name);
  console.log('  phone       :', row.phone);
  console.log('  fax         :', row.fax);
  console.log('  business_no :', row.business_no);
}

run().catch((e) => { console.error('❌', e.message); process.exit(1); });
