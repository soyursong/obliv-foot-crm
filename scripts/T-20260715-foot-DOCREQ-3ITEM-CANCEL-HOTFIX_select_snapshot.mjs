/**
 * T-20260715-foot-DOCREQ-3ITEM-CANCEL-HOTFIX — SELECT-first / SNAPSHOT (read-only)
 *
 * 김주연 총괄 명시요청: 풋 서류작성 큐 3건을 원장 발행 前 소프트취소(회수)한다.
 * 본 스크립트는 어떤 쓰기도 하지 않는다(SELECT + count guard + before-snapshot 만).
 *
 * 대상 (form_submissions):
 *   status='draft' AND field_data->>'request_origin'='staff_consult' AND clinic_id=<풋>
 *   AND customers.chart_number IN ('F-4692','F-4678','F-4574')
 *      - F-4692 / 송지현2   / 소견서
 *      - F-4678 / 총*현     / 소견서
 *      - F-4574 / 총괄테스트중 / 소견서
 *
 * Data-Correction SOP:
 *   count==3 확인. ≠3 이면 ABORT(초과/부족 매칭 사람 재확인). 다른 행 무접촉 보장을 위해
 *   WHERE 전조건 교차(chart_no + status=draft + origin=staff_consult + clinic=풋).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGET_CHART_NOS_RAW = ['4692', '4678', '4574'];
const TARGET_CHART_NOS_F = ['F-4692', 'F-4678', 'F-4574'];
const EXPECTED_NAMES = { '4692': '송지현2', '4678': '총*현', '4574': '총괄테스트중' };

// ── 1) 풋 clinic_id 확정 (cross_crm_data_contract slug=jongno-foot) ──
const { data: clinics, error: ce } = await sb.from('clinics').select('id, slug, name');
if (ce) { console.error('clinics err:', ce); process.exit(1); }
console.log('clinics:', clinics.map((c) => `${c.slug}=${c.name}(${c.id})`).join(' | '));
const foot = clinics.find((c) => c.slug === 'jongno-foot') || clinics.find((c) => /foot|풋/i.test(`${c.slug} ${c.name}`));
if (!foot) { console.error('ABORT: 풋 clinic 미확정'); process.exit(1); }
console.log(`\n★ 풋 clinic_id = ${foot.id} (slug=${foot.slug}, name=${foot.name})`);

// ── 2) 대상 고객 chart_number 매칭 (F- 접두 유무 양쪽 탐색) ──
const allChartCandidates = [...new Set([...TARGET_CHART_NOS_RAW, ...TARGET_CHART_NOS_F])];
const { data: custs, error: cue } = await sb
  .from('customers')
  .select('id, chart_number, name, clinic_id')
  .in('chart_number', allChartCandidates);
if (cue) { console.error('customers err:', cue); process.exit(1); }
console.log('\n=== 매칭된 customers ===');
custs.forEach((c) => console.log(`  chart_number=${c.chart_number} name=${c.name} clinic=${c.clinic_id} id=${c.id}`));

const footCusts = custs.filter((c) => c.clinic_id === foot.id);
const custIds = footCusts.map((c) => c.id);
const custById = new Map(footCusts.map((c) => [c.id, c]));
console.log(`\n풋 clinic 소속 대상 customer 수: ${footCusts.length}`);

// ── 3) SELECT-first: 서류작성 큐 draft (전조건 교차) ──
const { data: subs, error: se } = await sb
  .from('form_submissions')
  .select('id, customer_id, clinic_id, status, template_id, created_at, field_data')
  .in('customer_id', custIds.length ? custIds : ['00000000-0000-0000-0000-000000000000'])
  .eq('status', 'draft')
  .eq('clinic_id', foot.id);
if (se) { console.error('form_submissions err:', se); process.exit(1); }

// field_data->>'request_origin'='staff_consult' 필터 (JSONB, 클라이언트측)
const matched = subs.filter((s) => (s.field_data || {})['request_origin'] === 'staff_consult');

console.log(`\n=== 전조건 교차 매칭 form_submissions (status=draft + origin=staff_consult + clinic=풋 + chart_no IN 대상) ===`);
console.log(`매칭 count = ${matched.length}`);
for (const s of matched) {
  const c = custById.get(s.customer_id);
  const fd = s.field_data || {};
  console.log(`\n  --- id=${s.id} ---`);
  console.log(`   chart_number : ${c?.chart_number}  (기대명: ${EXPECTED_NAMES[String(c?.chart_number).replace(/^F-/, '')] || '?'} / 실제명: ${c?.name})`);
  console.log(`   status       : ${s.status}`);
  console.log(`   request_origin: ${fd['request_origin']}`);
  console.log(`   doc_type     : ${fd['doc_type']}  (${fd['doc_type'] === 'opinion' ? '소견서' : fd['doc_type']})`);
  console.log(`   created_at   : ${s.created_at}`);
  console.log(`   resolved_reason(before): ${fd['resolved_reason'] ?? '(none)'}`);
  console.log(`   resolved_at(before)    : ${fd['resolved_at'] ?? '(none)'}`);
  console.log(`   field_data(before): ${JSON.stringify(fd)}`);
}

// ── 4) COUNT GUARD ──
console.log('\n========================================');
if (matched.length === 3) {
  console.log('✅ GUARD PASS: count == 3. UPDATE 진행 가능.');
  console.log('대상 id 목록:', JSON.stringify(matched.map((s) => s.id)));
} else {
  console.log(`⛔ GUARD FAIL: count == ${matched.length} (≠3). ABORT — 사람 재확인 필요(초과/부족 매칭).`);
}
console.log('========================================');
