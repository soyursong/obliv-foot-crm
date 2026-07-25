#!/usr/bin/env node
/** SalesStaffTab 화장품 쿼리 EXACT 재현 (clinic 필터·checked_in_at 바운드) + 버킷 staff 검증 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const admin = createClient(g('VITE_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const JONGNO = '74967aea';
const { data: clinics } = await admin.from('clinics').select('id, name, slug');
const jongno = clinics.find((c) => c.slug === 'jongno-foot');
console.log('clinic jongno-foot id =', jongno.id);

async function runExact(from, to, clinicId) {
  // 1) 화장품 service_id
  const { data: svcRows } = await admin.from('services').select('id')
    .eq('clinic_id', clinicId).or('category.eq.풋화장품,category_label.eq.풋화장품');
  const cosmeticIds = (svcRows ?? []).map((s) => s.id);
  // 2) EXACT SalesStaffTab 쿼리
  const { data, error } = await admin.from('check_in_services')
    .select('price, seller_staff_id, service_id, check_ins!inner(therapist_id, clinic_id, checked_in_at, customer_id)')
    .in('service_id', cosmeticIds)
    .eq('check_ins.clinic_id', clinicId)
    .gte('check_ins.checked_in_at', `${from}T00:00:00+09:00`)
    .lte('check_ins.checked_in_at', `${to}T23:59:59+09:00`)
    .gt('price', 0);
  if (error) { console.log(`  [${from}~${to}] ERROR`, error.message); return; }
  const bySeller = new Map();
  let excluded = 0;
  for (const r of data ?? []) {
    const bucket = r.seller_staff_id ?? r.check_ins?.therapist_id ?? null;
    if (!bucket) { excluded++; continue; }
    bySeller.set(bucket, (bySeller.get(bucket) ?? 0) + (r.price ?? 0));
  }
  console.log(`\n[EXACT 쿼리 ${from}~${to} clinic=${clinicId.slice(0,8)}] 라인 ${data?.length ?? 0}건, 버킷 ${bySeller.size}, 미상제외 ${excluded}`);
  for (const [b, amt] of bySeller) console.log(`    bucket=${b.slice(0,8)} → ${amt}원`);
  return bySeller;
}

const today = await runExact('2026-07-25', '2026-07-25', jongno.id);
const month = await runExact('2026-07-01', '2026-07-31', jongno.id);

// 버킷 staff 검증 (clinic·role·name·active)
const allBuckets = new Set([...(today?.keys() ?? []), ...(month?.keys() ?? [])]);
if (allBuckets.size > 0) {
  const { data: staffRows } = await admin.from('staff')
    .select('id, name, clinic_id, role, is_active')
    .in('id', [...allBuckets]);
  console.log('\n[버킷 staff 검증]');
  for (const s of staffRows ?? []) {
    const inJongno = s.clinic_id === jongno.id ? 'jongno✓' : `⚠️clinic=${s.clinic_id?.slice(0,8)}`;
    console.log(`  ${s.name} | role=${s.role} | ${inJongno} | active=${s.is_active} | id=${s.id.slice(0,8)}`);
  }
  const foundIds = new Set((staffRows ?? []).map((s) => s.id));
  for (const b of allBuckets) if (!foundIds.has(b)) console.log(`  ⚠️ bucket ${b.slice(0,8)} → staff 레코드 없음(미등록)`);
}
console.log('\n=== done ===');
