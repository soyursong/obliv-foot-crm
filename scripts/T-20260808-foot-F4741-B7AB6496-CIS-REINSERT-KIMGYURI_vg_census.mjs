/**
 * T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI — VG1~VG5 READ-ONLY census probe
 *
 * *** READ-ONLY. prod write 0. SELECT-only. DA GO 후 gate order: VG census(본 스크립트) → freeze-set →
 *     supervisor DB-GATE dry-run → apply. 본 스크립트는 어떤 write 도 하지 않는다. ***
 *
 * 확인 항목:
 *  VG3  payment b7ab6496.amount == 73,000 (active, 부모 check_in dec7e6c4)
 *  VG5  현재 부모 check_in dec7e6c4 의 cis 라인 실재(소멸 확인) + cis before-image 물리 보존 여부(archive 부재)
 *  VG3/apply  현재 활성 풋화장품 service 카탈로그(풋샴푸200ml / CTB / 리페어핸드크림30ml) service_id 매핑
 *  VG5  seller 후보 김규리 staff row(동명이인 확인)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
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
const URL = envVal('VITE_SUPABASE_URL') || envVal('SUPABASE_URL');
const KEY = envVal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !KEY) { console.error('missing env'); process.exit(1); }

async function q(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) return { error: `${r.status} ${await r.text()}` };
  return { data: await r.json() };
}

const out = {};

// VG3 — payment b7ab6496*
out.payment = await q(`payments?id=like.b7ab6496*&select=id,amount,status,payment_type,accounting_date,check_in_id,customer_id,parent_payment_id`);

// VG5 — parent check_in dec7e6c4* (checked_in_at for date-range visibility + clinic + therapist)
out.checkin = await q(`check_ins?id=like.dec7e6c4*&select=id,checked_in_at,clinic_id,customer_id,therapist_id,technician_id,visit_type`);

// VG5 — current cis lines under parent check_in (소멸 확인: 화장품 라인 부재 기대)
const ci = out.checkin.data && out.checkin.data[0];
if (ci) {
  out.cis_current = await q(`check_in_services?check_in_id=eq.${ci.id}&select=id,service_id,service_name,price,seller_staff_id,is_package_session,voided_at`);
}

// VG3/apply — active 풋화장품 catalog (clinic-scoped)
if (ci) {
  out.cosmetic_services = await q(`services?clinic_id=eq.${ci.clinic_id}&active=eq.true&or=(category.eq.%ED%92%8B%ED%99%94%EC%9E%A5%ED%92%88,category_label.eq.%ED%92%8B%ED%99%94%EC%9E%A5%ED%92%88)&select=id,name,price,category,active`);
  // VG5 — 김규리 staff rows (동명이인 census)
  out.kimgyuri = await q(`staff?clinic_id=eq.${ci.clinic_id}&name=eq.%EA%B9%80%EA%B7%9C%EB%A6%AC&select=id,name,role,active`);
}

console.log(JSON.stringify(out, null, 2));
