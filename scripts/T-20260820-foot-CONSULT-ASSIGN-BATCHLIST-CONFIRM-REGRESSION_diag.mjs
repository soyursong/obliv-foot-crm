import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// clinic id (foot origin)
const { data: clinics } = await sb.from('clinics').select('id, name, slug').limit(20);
console.log('=== clinics ===', JSON.stringify(clinics));
const clinic = (clinics ?? []).find((c) => /foot|풋|origin|종로/i.test(`${c.name} ${c.slug}`)) ?? (clinics ?? [])[0];
console.log('picked clinic:', JSON.stringify(clinic));
const clinicId = clinic?.id;

// today KST midnight
const now = new Date();
const kst = new Date(now.getTime() + 9 * 3600 * 1000);
const todayIso = kst.toISOString().slice(0, 10);
const todayStart = `${todayIso}T00:00:00+09:00`;
console.log('todayIso(KST):', todayIso);

// today's check_ins
let q = sb.from('check_ins').select('id, customer_id, status, consultant_id, therapist_id, checked_in_at, visit_type, assignment_consult_type, consult_notify_status, deleted_at')
  .gte('checked_in_at', todayStart)
  .is('deleted_at', null)
  .order('checked_in_at', { ascending: true });
if (clinicId) q = q.eq('clinic_id', clinicId);
const { data: today, error: terr } = await q;
if (terr) { console.log('TODAY ERR', terr); }
console.log(`\n=== today check_ins: ${today?.length ?? 0} ===`);
const byStatus = {};
for (const c of today ?? []) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
console.log('status dist:', JSON.stringify(byStatus));
const withConsultant = (today ?? []).filter((c) => c.consultant_id).length;
const withTherapist = (today ?? []).filter((c) => c.therapist_id).length;
console.log(`with consultant_id: ${withConsultant} · with therapist_id: ${withTherapist}`);
const vtDist = {};
for (const c of today ?? []) vtDist[c.visit_type ?? '(null)'] = (vtDist[c.visit_type ?? '(null)'] ?? 0) + 1;
console.log('stored visit_type dist:', JSON.stringify(vtDist));

// Per-checkin recency classification (mimic resolveVisitTypesByCheckIn)
const custIds = [...new Set((today ?? []).map((c) => c.customer_id).filter(Boolean))];
console.log(`\n=== recency classification for ${custIds.length} distinct customers ===`);
const doneByCust = new Map();
let recencyErr = false;
if (custIds.length) {
  const CHUNK = 200;
  for (let i = 0; i < custIds.length; i += CHUNK) {
    const slice = custIds.slice(i, i + CHUNK);
    let dq = sb.from('check_ins').select('customer_id, checked_in_at')
      .in('customer_id', slice).is('deleted_at', null).eq('status', 'done')
      .order('checked_in_at', { ascending: true });
    if (clinicId) dq = dq.eq('clinic_id', clinicId);
    const { data, error } = await dq;
    if (error) { console.log('  recency query ERR:', error.code, error.message); recencyErr = true; continue; }
    for (const r of data ?? []) {
      const arr = doneByCust.get(r.customer_id) ?? []; arr.push(r.checked_in_at); doneByCust.set(r.customer_id, arr);
    }
  }
}
console.log('recency query errored?', recencyErr);
// classify each today check_in
function seoulDate(iso){ return new Date(new Date(iso).getTime()+9*3600*1000).toISOString().slice(0,10); }
function diffDays(a,b){ return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000); }
let cntReturning=0, cntNew=0;
const consultRows = (today ?? []).filter((c)=> ['waiting_consult','consultation','consult_waiting','waiting'].includes(c.status) || c.consultant_id);
for (const c of today ?? []) {
  if (!c.customer_id) { cntNew++; continue; }
  const dones = (doneByCust.get(c.customer_id) ?? []).filter((d)=> d < c.checked_in_at);
  const last = dones.length ? dones[dones.length-1] : null;
  const rec = !last ? 'new' : (diffDays(seoulDate(last), seoulDate(c.checked_in_at)) <= 365 ? 'returning' : 'new');
  if (rec==='returning') cntReturning++; else cntNew++;
}
console.log(`per-checkin recency: returning=${cntReturning} new=${cntNew} (total ${today?.length ?? 0})`);

// active status values present (for activeRole understanding)
console.log('\n=== distinct statuses seen today ===', JSON.stringify(Object.keys(byStatus)));
console.log('\n=== DONE ===');
