/**
 * T-20260728-foot-DOCWRITE-DASH-UNISSUED-DATEFILTER-REOPEN — AUDIT2 (READ-ONLY, errors surfaced)
 * service_role, prod rxlomoozakkjesdqjtvd. SELECT only.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const sb = createClient(env.VITE_SUPABASE_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co', env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const log = (...a) => console.log(...a);
const cid = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot
const songdo = 'b4dc0de5-f007-4a57-8888-aabbccddeeff';

// [A] 상태별 count (date filter 無, count exact)
log('── [A] form_submissions status별 count (jongno-foot, no date filter) ──');
for (const st of ['draft', 'voided', 'published', 'submitted']) {
  const { count, error } = await sb.from('form_submissions').select('id', { count: 'exact', head: true }).eq('clinic_id', cid).eq('status', st);
  log(`  status=${st}: ${error ? 'ERR ' + error.message : count}`);
}
const { count: totalCnt } = await sb.from('form_submissions').select('id', { count: 'exact', head: true }).eq('clinic_id', cid);
log(`  전체: ${totalCnt}\n`);

// [B] staff_consult 요청 전건 — status별 (field_data JSONB 필터 서버측)
log('── [B] request_origin=staff_consult 전건 (서버 JSONB 필터) ──');
for (const st of ['draft', 'voided', 'published']) {
  const { data, error } = await sb.from('form_submissions')
    .select('id, created_at, status, field_data')
    .eq('clinic_id', cid).eq('status', st)
    .filter('field_data->>request_origin', 'eq', 'staff_consult')
    .order('created_at', { ascending: false });
  if (error) { log(`  status=${st}: ERR ${error.message}`); continue; }
  log(`  status=${st}: ${data.length}건`);
  for (const r of data.slice(0, 40)) {
    const fd = r.field_data || {};
    log(`     • cre=${r.created_at} ${fd.patient_name ?? '—'} doc=${fd.doc_type} reqBy=${fd.requested_by_name ?? ''} reason=${fd.resolved_reason ?? ''} id=${r.id}`);
  }
}
log('');

// [C] 최근 7일 생성된 전체 form_submissions (staff_consult 여부 무관) — 생성흐름 확인
log('── [C] 최근 생성 form_submissions 30건 (전 origin) ──');
const { data: recent, error: rErr } = await sb.from('form_submissions')
  .select('id, created_at, status, field_data, template_id')
  .eq('clinic_id', cid).order('created_at', { ascending: false }).limit(30);
if (rErr) log('  ERR ' + rErr.message);
else for (const r of recent) {
  const fd = r.field_data || {};
  log(`   • cre=${r.created_at} status=${r.status} origin=${fd.request_origin ?? '-'} ${fd.patient_name ?? ''} doc=${fd.doc_type ?? ''}`);
}
log('');

// [D] 송도 clinic 도 동일 점검 (혹시 clinic_id 오귀속)
log('── [D] songdo-foot staff_consult draft count ──');
const { count: sdDraft } = await sb.from('form_submissions').select('id', { count: 'exact', head: true }).eq('clinic_id', songdo).eq('status', 'draft').filter('field_data->>request_origin', 'eq', 'staff_consult');
log(`  songdo staff_consult draft: ${sdDraft}`);

// [E] audit/log 테이블 존재 여부 — 삭제 흔적 소스 후보
log('\n── [E] 감사/삭제 흔적 테이블 후보 조회 ──');
for (const t of ['audit_log', 'audit_logs', 'form_submissions_audit', 'activity_log', 'deleted_rows']) {
  const { error } = await sb.from(t).select('*', { head: true, count: 'exact' }).limit(1);
  log(`  ${t}: ${error ? 'ABSENT/denied (' + error.code + ')' : 'EXISTS'}`);
}
process.exit(0);
