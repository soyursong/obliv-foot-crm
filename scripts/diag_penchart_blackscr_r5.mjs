/**
 * T-20260525-foot-PENCHART-FORM-BLACKSCR REOPEN5 진단 (READ-ONLY)
 *
 * 목적: 현장 신규 단서 "관리자 정상 / 직원 검정화면"을 RLS/데이터 드리프트 축에서 검증.
 *   커밋된 마이그레이션 레벨에선 펜차트 리소스(form_templates SELECT=is_approved_user,
 *   phrase_templates SELECT=true, photos storage=authenticated, pen_chart bg=정적 public 파일)
 *   어디에도 role-gate가 없음 → prod DB 드리프트 가능성만 남음. 이 스크립트가 그걸 확인.
 *
 * 절대 쓰기/스키마 변경 없음. SELECT only.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const line = (t) => console.log(`\n===== ${t} =====`);

// 1) prod pen_chart form_templates 행 — template_path 정적 여부 / required_role / active
line('1. form_templates pen_chart (정적 path 여부 = 검정화면 핵심)');
{
  const { data, error } = await sb
    .from('form_templates')
    .select('clinic_id, form_key, name_ko, template_path, template_format, required_role, active')
    .in('form_key', ['pen_chart', 'health_questionnaire_general', 'health_questionnaire_senior', 'refund_consent']);
  if (error) console.log('ERR:', error.message);
  else console.table(data?.map(r => ({
    form_key: r.form_key,
    template_path: r.template_path,
    is_static: String(r.template_path ?? '').startsWith('/'),
    required_role: r.required_role,
    active: r.active,
  })));
}

// 2) phrase_templates 데이터 존재 여부 (직원이 빈 목록 보는지 = 데이터 부재 vs RLS)
line('2. phrase_templates 건수 (is_active)');
{
  const { count, error } = await sb
    .from('phrase_templates')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);
  console.log(error ? `ERR: ${error.message}` : `active phrase rows = ${count}`);
}

// 3) user_profiles role 분포 + approved/active (is_approved_user 게이트 영향)
line('3. user_profiles role × approved × active 분포');
{
  const { data, error } = await sb
    .from('user_profiles')
    .select('role, approved, active');
  if (error) { console.log('ERR:', error.message); }
  else {
    const agg = {};
    for (const r of data ?? []) {
      const k = `${r.role} | approved=${r.approved} | active=${r.active}`;
      agg[k] = (agg[k] ?? 0) + 1;
    }
    console.table(Object.entries(agg).map(([k, v]) => ({ profile: k, count: v })));
  }
}

// 4) RLS 정책 현행 (drift 확인) — form_templates / phrase_templates
line('4. 현행 RLS 정책 (pg_policies) — form_templates / phrase_templates');
{
  const { data, error } = await sb
    .from('pg_policies')
    .select('tablename, policyname, cmd, roles, qual, with_check')
    .in('tablename', ['form_templates', 'phrase_templates', 'form_submissions']);
  if (error) console.log('ERR(pg_policies 미노출 가능):', error.message);
  else data?.forEach(p => console.log(`[${p.tablename}] ${p.policyname} cmd=${p.cmd} roles=${p.roles}\n   USING: ${p.qual}\n   CHECK: ${p.with_check}`));
}

// 5) storage.objects photos 정책 (signed URL 발급이 role 무관인지)
line('5. storage.objects photos 정책');
{
  const { data, error } = await sb
    .from('pg_policies')
    .select('tablename, policyname, cmd, qual')
    .eq('tablename', 'objects');
  if (error) console.log('ERR:', error.message);
  else data?.filter(p => String(p.qual ?? '').includes('photos')).forEach(p =>
    console.log(`[storage.objects] ${p.policyname} cmd=${p.cmd}\n   USING: ${p.qual}`));
}

console.log('\n진단 종료. (READ-ONLY, 쓰기 없음)');
