// T-20260724-foot-SOGYEONSEO-SONJA-DIAGDATE-FIX — Phase 1 READ-ONLY probe
// 손정아 F-4673 소견서 발행상태 확인 (published vs draft). 쓰기 없음. scope: chart_number='4673' 고정.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// load service_role key from .env.local (gitignored)
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const url = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const key = get('SUPABASE_SERVICE_ROLE_KEY');
const sb = createClient(url, key, { auth: { persistSession: false } });

const CHART = 'F-4673';

// 1) customer(s) matching chart_number 4673
const { data: custs, error: cerr } = await sb
  .from('customers')
  .select('id, clinic_id, name, chart_number, phone')
  .eq('chart_number', CHART);
if (cerr) throw cerr;
console.log('=== customers chart_number=4673 ===');
console.log(JSON.stringify(custs, null, 2));

if (!custs || custs.length === 0) { console.log('NO CUSTOMER FOUND for chart 4673'); process.exit(0); }

// 2) opinion_doc template id(s)
const { data: tpls } = await sb
  .from('form_templates')
  .select('id, form_key, clinic_id')
  .eq('form_key', 'opinion_doc');
console.log('\n=== opinion_doc templates ===');
console.log(JSON.stringify(tpls, null, 2));
const tplIds = (tpls || []).map((t) => t.id);

for (const c of custs) {
  console.log(`\n=== form_submissions for ${c.name} (${c.id}) ===`);
  const { data: subs, error: serr } = await sb
    .from('form_submissions')
    .select('id, template_id, status, created_at, field_data')
    .eq('customer_id', c.id)
    .in('template_id', tplIds.length ? tplIds : ['00000000-0000-0000-0000-000000000000'])
    .order('created_at', { ascending: false });
  if (serr) { console.log('ERR', serr); continue; }
  for (const s of subs || []) {
    const fd = s.field_data || {};
    console.log(`- id=${s.id} status=${s.status} template=${s.template_id} created=${s.created_at}`);
    console.log(`    doc_type=${fd.doc_type} docDate=${fd.docDate} dateISO=${fd.dateISO} date=${fd.date} published_at=${fd.published_at}`);
    console.log(`    request_origin=${fd.request_origin} resolved_reason=${fd.resolved_reason}`);
    const body = String(fd.final_text || '');
    console.log(`    final_text.len=${body.length} snippet.date=${(body.match(/\d{4}[-./년 ]\s?\d{1,2}[-./월 ]\s?\d{1,2}/g) || []).join(' | ')}`);
  }
  if (!subs || subs.length === 0) console.log('  (none)');
}
console.log('\nDONE (read-only)');
