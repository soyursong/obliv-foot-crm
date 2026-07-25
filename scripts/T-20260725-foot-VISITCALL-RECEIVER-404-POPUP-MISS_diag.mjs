#!/usr/bin/env node
/**
 * T-20260725-foot-VISITCALL-RECEIVER-404-POPUP-MISS — READ-ONLY 진단
 * RC-1a: receiver 404-despite-write / RC-1b: 팝업 status 필터 미표시
 * PHI 미조회 — visit_call_* + status + id + clinic 만.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const URL_ = g('VITE_SUPABASE_URL');
const SR = g('SUPABASE_SERVICE_ROLE_KEY');
const REF = URL_.match(/https:\/\/([a-z0-9]+)\.supabase/)[1];
const admin = createClient(URL_, SR, { auth: { persistSession: false } });

console.log('=== project ref:', REF, '===\n');

// 1) visit_call_result 가 세팅된 모든 예약 (07-22 window 포함)
const { data: rows, error } = await admin
  .from('reservations')
  .select('id, clinic_id, status, visit_call_result, visit_call_result_at, visit_call_result_event_id, reservation_date')
  .not('visit_call_result', 'is', null)
  .order('visit_call_result_at', { ascending: true });
if (error) { console.error('query error', error); process.exit(1); }

console.log(`[RC-1] visit_call_result 세팅된 예약: ${rows.length}건`);
for (const r of rows) {
  console.log(`  id=${r.id.slice(0,8)} clinic=${r.clinic_id?.slice(0,8)} status=${r.status} result=${r.visit_call_result} at=${r.visit_call_result_at} event=${r.visit_call_result_event_id}`);
}

// 2) status 분포 (RC-1b: 접수전 필터 확인)
const dist = {};
for (const r of rows) dist[r.status] = (dist[r.status]||0)+1;
console.log('\n[RC-1b] status 분포:', JSON.stringify(dist));

// 3) clinic slug 확인
const clinicIds = [...new Set(rows.map(r=>r.clinic_id).filter(Boolean))];
if (clinicIds.length) {
  const { data: clinics } = await admin.from('clinics').select('id, slug, name').in('id', clinicIds);
  console.log('\n[clinics]', clinics?.map(c=>`${c.id.slice(0,8)}=${c.slug}`).join(', '));
}

console.log('\n=== EF logs 는 별도 (management API) ===');
