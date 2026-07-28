/** AUDIT3 — DELETE 흔적 탐지 (branch A/B 최종 판정). service_role READ-ONLY. */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const sb = createClient(env.VITE_SUPABASE_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co', env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const log = (...a) => console.log(...a);
const cid = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// [F] 감사 테이블 실재 여부 + form_submissions DELETE 이벤트 탐지
for (const t of ['audit_log', 'audit_logs', 'form_submissions_audit', 'activity_log', 'deleted_rows']) {
  const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true });
  if (error) { log(`  [F] ${t}: ERR ${error.code} ${error.message}`); continue; }
  log(`  [F] ${t}: 실재 O, 총 ${count}행`);
  // 컬럼 파악 위해 1행
  const { data: one } = await sb.from(t).select('*').limit(1);
  log(`        컬럼: ${one?.[0] ? Object.keys(one[0]).join(',') : '(빈 테이블)'}`);
}
log('');

// [G] form_submissions 시퀀스 연속성 — doc_serial_seq / rx_issue_seq gap 로 hard-delete 간접 탐지
const { data: seqs } = await sb.from('form_submissions')
  .select('doc_serial_seq').eq('clinic_id', cid).not('doc_serial_seq', 'is', null)
  .order('doc_serial_seq', { ascending: true });
const vals = (seqs || []).map(r => r.doc_serial_seq).filter(v => typeof v === 'number');
if (vals.length) {
  const gaps = [];
  for (let i = 1; i < vals.length; i++) if (vals[i] - vals[i - 1] > 1) gaps.push(`${vals[i - 1]}→${vals[i]}`);
  log(`  [G] doc_serial_seq: ${vals.length}건, 범위 ${vals[0]}~${vals[vals.length - 1]}, gap ${gaps.length}건 ${gaps.slice(0, 20).join(' ')}`);
} else log('  [G] doc_serial_seq: 값 없음');

// [H] staff_consult 요청 총량 재확인 (draft+voided = 소실 없음 증명)
const { count: dC } = await sb.from('form_submissions').select('id', { count: 'exact', head: true }).eq('clinic_id', cid).eq('status', 'draft').filter('field_data->>request_origin', 'eq', 'staff_consult');
const { count: vC } = await sb.from('form_submissions').select('id', { count: 'exact', head: true }).eq('clinic_id', cid).eq('status', 'voided').filter('field_data->>request_origin', 'eq', 'staff_consult');
log(`  [H] staff_consult 총계: draft=${dC} + voided=${vC} = ${dC + vC}건 (전량 실재)`);

// [I] cancelled(요청취소) 로 대시보드에서 사라진 건 — 소실처럼 보이나 row 생존
const { data: cancelled } = await sb.from('form_submissions')
  .select('id, created_at, field_data').eq('clinic_id', cid).eq('status', 'voided')
  .filter('field_data->>request_origin', 'eq', 'staff_consult')
  .filter('field_data->>resolved_reason', 'eq', 'cancelled')
  .order('created_at', { ascending: false });
log(`  [I] cancelled voided(대시보드 완전 비표시, row 생존): ${cancelled?.length ?? 0}건`);
for (const r of (cancelled || []).slice(0, 15)) { const fd = r.field_data || {}; log(`       • ${r.created_at} ${fd.patient_name} reqBy=${fd.requested_by_name}`); }
process.exit(0);
