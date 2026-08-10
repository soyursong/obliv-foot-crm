import { q } from './dryrun_lib.mjs';
const run = async (sql) => { const r = await q(sql); return r.result || r; };
const NAMES = ['풋테스트3','총괄테스트중','서류테스트','서류테스트2','풋 서류 테스트 입니다','풋테스트1','송지현2','엄경은2'];
// KEEP (must NOT be in delete scope, but census presence for awareness)
const KEEP = ['김민경','박민석'];
const arr = (xs) => xs.map(n=>`normalize('${n.replace(/'/g,"''")}',NFC)`).join(',');

console.log('=== customers matching 8 delete-target names (NFC-normalized) ===');
const c = await run(`
  SELECT id, name, phone, chart_number, is_simulation, lead_source, visit_type,
         created_by, created_at, clinic_id, unified_customer_id, memo
  FROM customers
  WHERE normalize(name,NFC) IN (${arr(NAMES)})
  ORDER BY name, created_at;`);
console.log(JSON.stringify(c,null,2));

console.log('\n=== user_profiles matching 8 delete-target names (NFC) ===');
const u = await run(`
  SELECT id, email, name, role, clinic_id, active, approved, access_tier, created_at
  FROM user_profiles
  WHERE normalize(name,NFC) IN (${arr(NAMES)})
  ORDER BY name;`);
console.log(JSON.stringify(u,null,2));

console.log('\n=== auth.users matching by email of those user_profiles ===');
const au = await run(`
  SELECT au.id, au.email, au.created_at, au.last_sign_in_at, au.deleted_at, au.banned_until
  FROM auth.users au
  WHERE au.id IN (SELECT id FROM user_profiles WHERE normalize(name,NFC) IN (${arr(NAMES)}));`);
console.log(JSON.stringify(au,null,2));

console.log('\n=== KEEP names presence (김민경/박민석) — awareness only, NOT delete scope ===');
const k = await run(`
  SELECT 'customers' src, id::text, name, phone, chart_number FROM customers WHERE normalize(name,NFC) IN (${arr(KEEP)})
  UNION ALL
  SELECT 'user_profiles' src, id::text, name, email, NULL FROM user_profiles WHERE normalize(name,NFC) IN (${arr(KEEP)})
  ORDER BY 1,3;`);
console.log(JSON.stringify(k,null,2));
