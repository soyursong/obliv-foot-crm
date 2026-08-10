/**
 * T-20260810-foot-COORD-STAFF-DUP-INSERT-GUARD — AC-1 census (READ-ONLY, WRITE 0/DDL 0/DML 0)
 *
 * 목적: forward-guard mechanism/술어 확정을 위한 prod 실측.
 *   1) staff 테이블 identity 축 컬럼 실재(phone 有 / legal_name 無 확인).
 *   2) 부모 dedup 대상(강다연·이진석) staff 레코드의 phone 채움 여부 → phone-축 가드 효력 판정.
 *   3) 활성 coordinator 를 clinic_id × phone × name 으로 그룹핑 → within-clinic 진성 dup vs 8쌍 2지점 seed carve 대조.
 *   4) 정당 INSERT 무회귀 대상(재입사 비활성·2지점 동명) 데이터 실재 확인.
 *
 * 실행: SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_URL (.env.local) 필요. READ-ONLY (select only).
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function envFrom(file) {
  const out = {};
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = { ...envFrom('.env'), ...envFrom('.env.local'), ...process.env };
const URL = env.VITE_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('❌ VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 없음'); process.exit(2); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
console.log(`✅ ${URL}  READ-ONLY census  ${new Date().toISOString()}\n`);

// ── 1. staff 컬럼 실재 (phone/legal_name) — 한 행 뽑아 key 검사 ──
const { data: sample } = await sb.from('staff').select('*').limit(1);
const cols = sample && sample[0] ? Object.keys(sample[0]) : [];
console.log('── (1) staff 컬럼 ──');
console.log('   all:', cols.join(', '));
console.log('   phone 존재      :', cols.includes('phone'));
console.log('   legal_name 존재 :', cols.includes('legal_name'));
console.log('   clinic_id 존재  :', cols.includes('clinic_id'));

// ── 2. 부모 dedup 대상 4 레코드 phone 채움 ──
const DUP_IDS = ['4bcf55a2', '0ff81a68', '9a429fb7', '884b4571'];
const { data: allStaff } = await sb.from('staff')
  .select('id, clinic_id, name, role, active, phone, created_at, user_id');
console.log('\n── (2) 부모 dedup 대상(강다연·이진석) 레코드 phone 채움 ──');
for (const s of (allStaff || []).filter(s => DUP_IDS.some(p => s.id.startsWith(p)))) {
  console.log(`   ${s.id.slice(0,8)}  ${s.name}  role=${s.role} active=${s.active}  phone=${JSON.stringify(s.phone)}  clinic=${(s.clinic_id||'').slice(0,8)}  ${s.created_at}`);
}

// ── 3. 활성 coordinator within-clinic 그룹핑 (phone-axis / name-axis) ──
const coords = (allStaff || []).filter(s => s.role === 'coordinator' && s.active === true);
console.log(`\n── (3) 활성 coordinator 총 ${coords.length}명 ──`);
const norm = p => (p || '').replace(/[^0-9]/g, '');
// clinic × phone collision (강한 축)
const byClinicPhone = {};
for (const s of coords) { const ph = norm(s.phone); if (!ph) continue; const k = `${s.clinic_id}|${ph}`; (byClinicPhone[k] ||= []).push(s); }
console.log('   [within-clinic + phone] 진성 dup 후보 (같은 clinic·같은 phone 활성 coordinator ≥2):');
let phoneDup = 0;
for (const [k, arr] of Object.entries(byClinicPhone)) if (arr.length > 1) { phoneDup++; console.log(`     phone=${k.split('|')[1]} → ${arr.map(s=>`${s.name}(${s.id.slice(0,8)})`).join(', ')}`); }
if (!phoneDup) console.log('     (없음)');
// clinic × name collision (약한 축 — 참고: 이 중 phone 다르면 정당 동명이인)
const byClinicName = {};
for (const s of coords) { const k = `${s.clinic_id}|${s.name}`; (byClinicName[k] ||= []).push(s); }
console.log('   [within-clinic + name-string] 그룹 (≥2) — phone 대조로 진성/동명이인 구분:');
let nameDup = 0;
for (const [k, arr] of Object.entries(byClinicName)) if (arr.length > 1) { nameDup++;
  const phones = arr.map(s=>norm(s.phone));
  const samePhone = phones.every(p=>p && p===phones[0]);
  console.log(`     name=${k.split('|')[1]} clinic=${k.split('|')[0].slice(0,8)} → ${arr.map(s=>`${s.name}(${s.id.slice(0,8)},ph=${JSON.stringify(s.phone)})`).join(', ')}  ⇒ ${samePhone?'★진성dup(phone동일)':'동명이인가능(phone상이/누락)'}`);
}
if (!nameDup) console.log('     (없음)');

// cross-clinic 동명 (8쌍 carve 대조 — 가드가 차단하면 안 됨)
console.log('   [cross-clinic 동명] (다른 clinic·같은 name 활성 coordinator) — 8쌍 carve 대상:');
const byName = {};
for (const s of coords) (byName[s.name] ||= []).push(s);
let crossClinic = 0;
for (const [n, arr] of Object.entries(byName)) { const clinics = new Set(arr.map(s=>s.clinic_id)); if (clinics.size > 1) { crossClinic++; console.log(`     ${n} → ${arr.map(s=>`clinic=${(s.clinic_id||'').slice(0,8)}(${s.id.slice(0,8)})`).join(', ')}`); } }
if (!crossClinic) console.log('     (없음)');

// ── 4. 비활성 coordinator (재입사 무회귀 대상) ──
const inactive = (allStaff || []).filter(s => s.role === 'coordinator' && s.active !== true);
console.log(`\n── (4) 비활성 coordinator ${inactive.length}명 (재입사=비활성→재활성 무회귀 대상) ──`);
for (const s of inactive) console.log(`   ${s.id.slice(0,8)}  ${s.name}  active=${s.active}  phone=${JSON.stringify(s.phone)}  clinic=${(s.clinic_id||'').slice(0,8)}`);

// ── 5. clinic 목록 (종로 74967aea / 송도 b4dc0de5 대조) ──
const { data: clinics } = await sb.from('clinics').select('id, name, slug');
console.log('\n── (5) clinics ──');
for (const c of (clinics||[])) console.log(`   ${c.id.slice(0,8)}  ${c.name}  ${c.slug||''}`);

console.log('\n✅ census 완료 (WRITE 0 · DDL 0 · DML 0)');
process.exit(0);
