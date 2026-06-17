/**
 * T-20260617-foot-KOHNAIL-SINGLE-REVERT-TESTPUB — AC-3 더미 발행대상 시드 / 정리
 *
 * mode=seed   : 발행 동선 실증용 더미 1건 INSERT
 *   - customers(1) + check_ins(1) + check_in_services(1, KOH/어제/koh_requested=true/nail_sites=[{Lt,1}])
 *   - created_at = 2026-06-16(KST) → isKohExamEligible(어제) true + 6월 ym → KOH 탭 노출 + canPublish=true
 * mode=cleanup: 본 더미 흔적 전수 삭제(form_submissions 발행분 포함). 잔존 0 보장.
 *
 * 격리/롤백 키: created_by='TEST-KOHPUB-20260617', phone '+82108619%', memo 마커.
 * GO_WARN(prod 쓰기): 본 마커 행만 대상. 운영 데이터 UPDATE/DELETE 절대 금지.
 *
 * 실행: node scripts/..._seed.mjs seed   |   node scripts/..._seed.mjs cleanup
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV = {};
for (const l of readFileSync(join(__dirname, '../.env'), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) ENV[m[1]] = m[2].trim();
}
const SUPABASE_URL = ENV.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EXPECT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const CREATED_BY = 'TEST-KOHPUB-20260617';
const PHONE = '+821086190001';
const MARKER = '[TEST-DUMMY KOHPUB 20260617]';
const NAME = '균발행더미환자';
const KOH_SERVICE_NAME = '일반진균검사-KOH도말-조갑조직';
const EXAM_CREATED_AT = '2026-06-16T11:00:00+09:00'; // 어제(KST) → +1일 경과 노출, 6월 ym
const NAIL_SITES = [{ side: 'Lt', toe: 1 }];          // 단일선택 1건

const mode = process.argv[2];

async function resolveClinic() {
  const { data, error } = await sb.from('clinics').select('id, slug, name').eq('slug', 'jongno-foot');
  if (error) throw new Error('clinic resolve: ' + error.message);
  const id = data?.[0]?.id;
  if (id !== EXPECT_CLINIC_ID) throw new Error(`ABORT: clinic_id(${id}) != 기대(${EXPECT_CLINIC_ID})`);
  return id;
}

async function findDummies(clinicId) {
  const { data: custs } = await sb.from('customers').select('id, name, phone')
    .eq('clinic_id', clinicId).eq('created_by', CREATED_BY);
  return custs ?? [];
}

async function cleanup(clinicId) {
  const custs = await findDummies(clinicId);
  if (!custs.length) { console.log('cleanup: 더미 없음(잔존 0).'); return; }
  const custIds = custs.map((c) => c.id);
  // 1) check_ins (해당 고객) → check_in_services → form_submissions(발행분) 역순 삭제
  const { data: cis } = await sb.from('check_ins').select('id').in('customer_id', custIds);
  const ciIds = (cis ?? []).map((c) => c.id);
  let svcIds = [];
  if (ciIds.length) {
    const { data: svcs } = await sb.from('check_in_services').select('id').in('check_in_id', ciIds);
    svcIds = (svcs ?? []).map((s) => s.id);
  }
  // form_submissions: field_data.koh_service_id ∈ svcIds (발행 결과지)
  if (svcIds.length) {
    for (const sid of svcIds) {
      const { data: subs } = await sb.from('form_submissions').select('id').contains('field_data', { koh_service_id: sid });
      for (const s of (subs ?? [])) await sb.from('form_submissions').delete().eq('id', s.id);
    }
    await sb.from('check_in_services').delete().in('id', svcIds);
  }
  if (ciIds.length) await sb.from('check_ins').delete().in('id', ciIds);
  await sb.from('customers').delete().in('id', custIds);
  // 검증
  const left = await findDummies(clinicId);
  console.log(`cleanup 완료 — customers 삭제 ${custIds.length}, check_ins ${ciIds.length}, services ${svcIds.length}. 잔존=${left.length}`);
  if (left.length) { console.error('WARN: 잔존 발견'); process.exit(1); }
}

async function seed(clinicId) {
  // 재실행 가드
  const existing = await findDummies(clinicId);
  if (existing.length) { console.error(`ABORT: 이미 더미 ${existing.length}건 존재. cleanup 후 재실행.`); process.exit(1); }

  const { data: cust, error: ce } = await sb.from('customers').insert({
    clinic_id: clinicId, name: NAME, phone: PHONE, visit_type: 'returning',
    is_simulation: true, created_by: CREATED_BY, memo: MARKER,
  }).select('id, name, chart_number').single();
  if (ce) { console.error('CUSTOMER INSERT FAIL:', ce); process.exit(1); }

  const { data: ci, error: cie } = await sb.from('check_ins').insert({
    clinic_id: clinicId, customer_id: cust.id, customer_name: NAME, visit_type: 'returning', status: 'done',
  }).select('id').single();
  if (cie) { console.error('CHECK_IN INSERT FAIL:', cie); await sb.from('customers').delete().eq('id', cust.id); process.exit(1); }

  const { data: svc, error: se } = await sb.from('check_in_services').insert({
    check_in_id: ci.id, service_name: KOH_SERVICE_NAME, price: 0,
    koh_requested: true, koh_nail_sites: NAIL_SITES, created_at: EXAM_CREATED_AT,
  }).select('id, service_name, created_at, koh_requested, koh_nail_sites').single();
  if (se) {
    console.error('CIS INSERT FAIL:', se);
    await sb.from('check_ins').delete().eq('id', ci.id);
    await sb.from('customers').delete().eq('id', cust.id);
    process.exit(1);
  }
  console.log('SEED OK');
  console.log(JSON.stringify({ clinic_id: clinicId, customer_id: cust.id, customer_name: cust.name,
    chart_number: cust.chart_number, check_in_id: ci.id, koh_service_id: svc.id,
    service_name: svc.service_name, created_at: svc.created_at, koh_requested: svc.koh_requested,
    koh_nail_sites: svc.koh_nail_sites }, null, 2));
}

(async () => {
  const clinicId = await resolveClinic();
  if (mode === 'seed') await seed(clinicId);
  else if (mode === 'cleanup') await cleanup(clinicId);
  else { console.error('usage: node ..._seed.mjs seed|cleanup'); process.exit(1); }
})();
