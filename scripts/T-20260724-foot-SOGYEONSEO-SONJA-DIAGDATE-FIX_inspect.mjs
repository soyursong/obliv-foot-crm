/**
 * T-20260724-foot-SOGYEONSEO-SONJA-DIAGDATE-FIX — INSPECT (READ-ONLY, prod write 0)
 *
 * 손정아(차트 F-4673) 소견서 form_submissions 전수 조회 →
 *   - opinion_doc(소견서/진단서) 발행/draft 행 나열(id, status, created_at, doc_type)
 *   - field_data 내 날짜류 필드 전부 덤프(diagnosis_date / dateISO / issue_date / final_text 内 날짜)
 *   - 진단일 2026-07-24 로 나온 "최신 신규발행" 1건 식별(scope 고정용 id)
 *
 * 안전: 오직 SELECT (service_role REST). prod write 0.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim();
    }
  }
  return null;
}
const URL = envFromLocal('VITE_SUPABASE_URL');
const SRK = envFromLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !SRK) { console.error('❌ missing URL/SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const CHART_NO = 'F-4673';
const NAME = '손정아';

// field_data 안에서 "날짜처럼 생긴" 값을 전부 뽑아 보여주는 헬퍼(키 이름 불문).
function scanDates(obj, prefix = '') {
  const hits = [];
  if (obj == null) return hits;
  if (typeof obj === 'string') {
    if (/\d{4}[-.\/]\d{1,2}[-.\/]\d{1,2}/.test(obj) || /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/.test(obj)) {
      hits.push([prefix, obj.length > 200 ? obj.slice(0, 200) + '…' : obj]);
    }
    return hits;
  }
  if (typeof obj !== 'object') return hits;
  for (const [k, v] of Object.entries(obj)) {
    hits.push(...scanDates(v, prefix ? `${prefix}.${k}` : k));
  }
  return hits;
}

async function main() {
  // 1) 고객 찾기 — chart_no 우선, 이름 폴백.
  let { data: custs, error: cErr } = await db
    .from('customers')
    .select("id, name, chart_number, clinic_id, phone")
    .or(`chart_number.eq.${CHART_NO},name.eq.${NAME}`);
  if (cErr) { console.error('customers 조회 오류:', cErr.message); process.exit(1); }
  console.log('── [A] 고객 매칭 ──');
  for (const c of custs ?? []) console.log('  ', { id: c.id, name: c.name, chart_number: c.chart_number, clinic_id: c.clinic_id });
  const target = (custs ?? []).find((c) => c.chart_number === CHART_NO) ?? (custs ?? [])[0];
  if (!target) { console.error('❌ 대상 고객 미발견'); process.exit(1); }
  console.log('  → 대상 customer_id:', target.id, '(', target.name, target.chart_no, ')');

  // 2) 해당 고객 form_submissions 전수(opinion_doc 계열 포함).
  const { data: subs, error: sErr } = await db
    .from('form_submissions')
    .select('id, template_id, status, created_at, field_data')
    .eq('customer_id', target.id)
    .order('created_at', { ascending: false });
  if (sErr) { console.error('form_submissions 조회 오류:', sErr.message); process.exit(1); }

  // template 이름 확인용
  const tplIds = [...new Set((subs ?? []).map((s) => s.template_id).filter(Boolean))];
  const { data: tpls } = await db.from('form_templates').select('id, name, template_key').in('id', tplIds.length ? tplIds : ['00000000-0000-0000-0000-000000000000']);
  const tplName = Object.fromEntries((tpls ?? []).map((t) => [t.id, `${t.name ?? ''}/${t.template_key ?? ''}`]));

  console.log(`\n── [B] form_submissions ${(subs ?? []).length}건 ──`);
  for (const s of subs ?? []) {
    const fd = s.field_data ?? {};
    console.log('\n  ■ id:', s.id);
    console.log('    template:', tplName[s.template_id] ?? s.template_id);
    console.log('    status  :', s.status, '| created:', s.created_at);
    console.log('    doc_type:', fd.doc_type, '| form_key:', fd.form_key ?? fd.formKey);
    const dateHits = scanDates(fd);
    if (dateHits.length) {
      console.log('    날짜류 필드:');
      for (const [k, v] of dateHits) console.log('       ·', k, '=', v);
    } else {
      console.log('    날짜류 필드: (없음)');
    }
    // 명시적으로 자주 쓰이는 날짜 키만 따로
    for (const key of ['diagnosis_date', 'dateISO', 'date', 'issue_date', 'resolved_at', 'diag_date']) {
      if (fd[key] !== undefined) console.log('    · 명시키', key, '=', JSON.stringify(fd[key]));
    }
  }

  console.log('\n── [C] field_data 전체 키 목록(최신 3건) ──');
  for (const s of (subs ?? []).slice(0, 3)) {
    console.log('  id', s.id, 'status', s.status, 'keys:', Object.keys(s.field_data ?? {}).join(', '));
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
