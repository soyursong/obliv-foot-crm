/**
 * T-20260801-foot-F4741-COSMETIC-0725-RECORD-REMOVE — 08-01 vs 08-04 모순 재대조 (READ-ONLY, write 0)
 *
 * 목적: 08-01 REGRAIN(3라인 실재 + Branch A) vs 08-04 ABORT 프로브(동일 check_in cosmetic=0) 정반대 판정 해소.
 * 산출: 전제 T/F (7/25 화장품 "중복" 존재 여부) 이분 판정 근거.
 * *** READ-ONLY. SELECT only. write/archive/DELETE 0. ***
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REF = 'rxlomoozakkjesdqjtvd';
function envVal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
      const m = l.match(new RegExp('^' + key + '=(.*)$'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}
const ACCESS_TOKEN = envVal('SUPABASE_ACCESS_TOKEN');
if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN 필요');
async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  return res.json();
}
const inList = (arr) => arr.map((x) => `'${x}'`).join(',');

const PARENT_CHECKIN = 'fdd5c165-8375-470e-9b9d-cad851de93a6';
const CIS_IDS = ['eeb760b3-6931-4b57-b05f-979f7cc1287e','08162a7a-aa4e-411f-9824-0f2044c9f8ff','a2dbbbfa-c890-4397-bbaf-4ddf205d383f'];
const TWIN_CIS = ['5104417a-4520-4e3b-8666-1e79f987e8e8','37e32d58-91bd-4762-81ab-a2484f2a3bfd','54d94955-7934-420b-bc02-6dd3904a3991'];
const GUARD_PAYMENT = 'b7ab6496-9efc-429c-9d5c-60a248eabc15';
const CUSTOMER_ID = '259abd32-d784-4c45-b59e-1ccae1b69492';

async function main() {
  const L = (s) => console.log(s);
  L('# F4741 08-01 vs 08-04 모순 재대조 — READ-ONLY');
  L(`- prod ${REF} | ${new Date().toISOString()}`);

  // Q1: 3 UUID 현재 실재?
  L('\n## Q1 — 3 UUID check_in_services 직접 조회 (실재?)');
  const q1 = await runSQL(
    `select id, check_in_id, service_name, service_id, price, original_price,
            is_package_session, package_session_id, seller_staff_id, created_at
     from public.check_in_services where id in (${inList(CIS_IDS)}) order by price desc;`);
  L(`   실재 rows = ${q1.length} / 3`);
  for (const r of q1) L(`   - ${r.id.slice(0,8)} | name="${r.service_name}" | price=${r.price} | check_in_id=${r.check_in_id?.slice(0,8)} | pkg=${r.is_package_session} | created=${r.created_at}`);
  const missing = CIS_IDS.filter((id) => !q1.find((r) => r.id === id));
  if (missing.length) L(`   MISSING: ${missing.map((m)=>m.slice(0,8)).join(', ')}`);

  // Q2: 정말 화장품 & 부모=7/25 fdd5c165?
  L('\n## Q2 — service 종류/명칭/카테고리 + 부모 check_in 날짜');
  const svcIds = q1.map((r) => r.service_id).filter(Boolean);
  if (svcIds.length) {
    const svc = await runSQL(
      `select id, name, category, service_type, price, is_active
       from public.services where id in (${inList(svcIds)});`).catch((e)=>({err:e.message}));
    if (svc.err) L(`   services 조회 오류: ${svc.err}`);
    else for (const s of svc) L(`   - svc ${s.id.slice(0,8)} name="${s.name}" category="${s.category}" type="${s.service_type}" price=${s.price} active=${s.is_active}`);
  }
  const parent = (await runSQL(
    `select id, customer_id, visit_type, status, deleted_at, created_at,
            (select count(*)::int from public.payments pm where pm.check_in_id=ci.id) as pay_n
     from public.check_ins ci where ci.id='${PARENT_CHECKIN}';`))?.[0];
  L(`   부모 check_in ${PARENT_CHECKIN.slice(0,8)}: visit=${parent?.visit_type} status=${parent?.status} deleted=${parent?.deleted_at} created=${parent?.created_at} customer=${parent?.customer_id?.slice(0,8)} pay_on_checkin=${parent?.pay_n}`);
  L(`   (기대: customer=${CUSTOMER_ID.slice(0,8)} F-4741, created 날짜=7/25)`);

  // Q3: 08-04 프로브 필터 재현 — 부모 check_in 의 전체 cis 라인 덤프 + 카테고리 태그 분포
  L('\n## Q3 — 부모 check_in 의 전체 check_in_services 라인 (08-04 프로브가 본 것 재현)');
  const allLines = await runSQL(
    `select cis.id, cis.service_name, cis.service_id, cis.price, cis.is_package_session,
            s.category as svc_category, s.service_type as svc_type
     from public.check_in_services cis
     left join public.services s on s.id = cis.service_id
     where cis.check_in_id='${PARENT_CHECKIN}' order by cis.price desc;`);
  L(`   부모 check_in 전체 cis 라인 = ${allLines.length}`);
  for (const r of allLines) {
    const isTarget = CIS_IDS.includes(r.id) ? ' <<TARGET' : '';
    L(`   - ${r.id.slice(0,8)} | "${r.service_name}" | price=${r.price} | svc_cat="${r.svc_category}" svc_type="${r.svc_type}"${isTarget}`);
  }
  // 카테고리 분포 (08-04 프로브가 cosmetic 필터에 무엇을 썼는지 추론)
  L('\n   카테고리/타입 분포:');
  const catDist = {};
  for (const r of allLines) { const k = `cat=${r.svc_category}/type=${r.svc_type}`; catDist[k] = (catDist[k]||0)+1; }
  for (const [k,v] of Object.entries(catDist)) L(`   - ${k}: ${v}`);
  // service_name 기반 화장품 키워드 필터 (풋샴푸/CTB/핸드크림) count
  const cosmeticByName = allLines.filter((r)=>/샴푸|band|ctb|크림|cream|toe band/i.test(r.service_name||''));
  L(`   서비스명 화장품 키워드 매칭 = ${cosmeticByName.length} (${cosmeticByName.map((r)=>r.service_name).join(', ')})`);

  // Q4: 8/1 twin & lump 관계
  L('\n## Q4 — 8/1 twin cis + b7ab6496 lump payment 재확인');
  const twin = await runSQL(
    `select id, check_in_id, service_name, price, created_at from public.check_in_services where id in (${inList(TWIN_CIS)}) order by price desc;`);
  L(`   twin cis 실재 = ${twin.length} / 3`);
  for (const r of twin) L(`   - ${r.id.slice(0,8)} | "${r.service_name}" | price=${r.price} | check_in=${r.check_in_id?.slice(0,8)} | created=${r.created_at}`);
  const guard = (await runSQL(`select id, check_in_id, amount, status, payment_method, created_at from public.payments where id='${GUARD_PAYMENT}';`))?.[0];
  L(`   lump payment b7ab6496: amount=${guard?.amount} status=${guard?.status} method=${guard?.payment_method} check_in=${guard?.check_in_id?.slice(0,8)} created=${guard?.created_at}`);
  // twin 의 부모 check_in 날짜 확인
  if (twin.length) {
    const twinParents = [...new Set(twin.map((r)=>r.check_in_id))];
    const tp = await runSQL(`select id, visit_type, status, created_at from public.check_ins where id in (${inList(twinParents)});`);
    for (const r of tp) L(`   twin 부모 check_in ${r.id.slice(0,8)}: visit=${r.visit_type} status=${r.status} created=${r.created_at}`);
  }
  // 고객 전체 화장품성 cis 라인 (전체 그림)
  L('\n   [참고] 고객 F-4741 전체 check_in_services (화장품 키워드) — 날짜별:');
  const custCosmetic = await runSQL(
    `select cis.id, cis.check_in_id, cis.service_name, cis.price, cis.created_at, ci.created_at as checkin_created
     from public.check_in_services cis
     join public.check_ins ci on ci.id = cis.check_in_id
     where ci.customer_id='${CUSTOMER_ID}'
       and (cis.service_name ~* '샴푸|band|ctb|크림|cream|toe band')
     order by cis.created_at;`).catch((e)=>({err:e.message}));
  if (custCosmetic.err) L(`   조회오류: ${custCosmetic.err}`);
  else for (const r of custCosmetic) L(`   - ${r.id.slice(0,8)} | "${r.service_name}" | ${r.price} | cis_created=${r.created_at} | checkin_created=${r.checkin_created} | check_in=${r.check_in_id?.slice(0,8)}`);

  L('\n=== 재대조 완료 (READ-ONLY, write 0) ===');
}
main().catch((e) => { console.error(e); process.exit(2); });
