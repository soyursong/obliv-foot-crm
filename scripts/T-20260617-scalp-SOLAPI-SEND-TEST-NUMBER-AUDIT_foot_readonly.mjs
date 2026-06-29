/**
 * T-20260617-scalp-SOLAPI-SEND-TEST-NUMBER-AUDIT (B-CROSS) — 풋 DB 실측 (READ-ONLY)
 * dev-scalp 취합 요청(MSG-20260617-104654-ey8e). 삭제/변경 금지, SELECT only.
 * 핵심: 종로 sender_number == 01088277791? 송도 == 01034573344? vault 키 식별.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 1. clinic_messaging_capability 전 row + clinics 조인
const { data: caps, error: capErr } = await sb
  .from('clinic_messaging_capability')
  .select('*');
if (capErr) {
  console.error('clinic_messaging_capability ERROR:', JSON.stringify(capErr));
  process.exit(1);
}

const { data: clinics, error: clErr } = await sb
  .from('clinics')
  .select('id, slug, name');
if (clErr) console.error('clinics ERROR:', JSON.stringify(clErr));

const clinicMap = {};
(clinics || []).forEach(c => { clinicMap[c.id] = c; });

console.log('=== clinic_messaging_capability 컬럼 (샘플) ===');
console.log(caps?.[0] ? Object.keys(caps[0]).join(', ') : 'NO ROWS');

console.log('\n=== 대조표 (slug | name | sender_number | enabled | solapi_validation_status | has_key | vault_name) ===');
const rows = (caps || []).map(cap => {
  const c = clinicMap[cap.clinic_id] || {};
  const vaultName = cap.solapi_api_key_vault_name ?? null;
  return {
    slug: c.slug ?? '(unknown)',
    name: c.name ?? '(unknown)',
    sender_number: cap.sender_number ?? null,
    enabled: cap.enabled ?? null,
    solapi_validation_status: cap.solapi_validation_status ?? null,
    has_key: vaultName != null,
    vault_name: vaultName,
  };
}).sort((a, b) => String(a.slug).localeCompare(String(b.slug)));

console.log(JSON.stringify(rows, null, 2));

console.log('\n=== 핵심 확인점 ===');
const jongno = rows.find(r => /jongno/.test(r.slug));
const songdo = rows.find(r => /songdo/.test(r.slug));
console.log('종로 sender_number =', jongno?.sender_number, '| 01088277791 일치?', jongno?.sender_number === '01088277791');
console.log('송도 sender_number =', songdo?.sender_number, '| 01034573344 일치?', songdo?.sender_number === '01034573344');
console.log('전체 vault_name 목록:', JSON.stringify(rows.map(r => ({ slug: r.slug, vault_name: r.vault_name }))));
