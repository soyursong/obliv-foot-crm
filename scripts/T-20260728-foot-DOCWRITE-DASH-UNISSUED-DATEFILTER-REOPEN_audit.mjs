/**
 * T-20260728-foot-DOCWRITE-DASH-UNISSUED-DATEFILTER-REOPEN — AUDIT-FIRST (READ-ONLY)
 *
 * 현장 확정(김주연 총괄): 진료대시보드 '서류작성' 큐 항목이 ②완전 데이터 소실
 *   (재진입해도 흔적 없음). row 물리 소실 가능성 지목 → P0.
 *
 * 목적(분기 판정):
 *   (A) 조회 필터 문제 → draft row 는 생존(DB에 있음). 화면만 못 봄.
 *   (B) 실제 DB 삭제 → draft row 물리 소실(audit/soft-delete에도 흔적).
 *
 * 인증컨텍스트: service_role (RLS 우회) — Cross-CRM 진단 인증컨텍스트 표준 준수.
 *   anon 0-row 오독 방지. SELECT only. 코드/DB 변경 절대 없음.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// .env.local 로드 (prod rxlomoozakkjesdqjtvd)
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const URL_ = env.VITE_SUPABASE_URL || env.SUPABASE_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing in .env.local');
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });
const log = (...a) => console.log(...a);

log('✅ prod DB (rxlomoozakkjesdqjtvd) — service_role READ-ONLY audit\n');

// [0] 풋 clinic id
const { data: clinics, error: cErr } = await sb.from('clinics').select('id, name, slug');
if (cErr) throw cErr;
log('── [0] clinics ──');
for (const c of clinics) log(`  ${c.id}  ${c.slug}  ${c.name}`);
const foot = clinics.find(c => /foot|풋/i.test(`${c.slug} ${c.name}`)) || clinics[0];
log(`  → 대상 clinic: ${foot.id} (${foot.slug})\n`);
const cid = foot.id;

// [1] form_submissions 컬럼 — soft-delete 컬럼 존재 여부 확인
const { data: cols } = await sb.rpc('exec_sql_readonly', {}).then(() => ({ data: null })).catch(() => ({ data: null }));
// RPC 없을 수 있으니 information_schema 는 REST로 불가 → 대신 한 행 뽑아 키 확인
const { data: oneRow } = await sb.from('form_submissions').select('*').eq('clinic_id', cid).limit(1);
log('── [1] form_submissions 컬럼(샘플 키) ──');
log('  ' + (oneRow?.[0] ? Object.keys(oneRow[0]).join(', ') : '(행 없음)'));
const hasDeletedAt = oneRow?.[0] && ('deleted_at' in oneRow[0]);
log(`  soft-delete 컬럼(deleted_at) 존재: ${hasDeletedAt ? 'YES' : 'NO'}\n`);

// [2] 현재 서류작성 큐 = status='draft' + request_origin='staff_consult' (화면과 동일 조건, 날짜필터 無)
const { data: drafts, error: dErr } = await sb
  .from('form_submissions')
  .select('id, customer_id, check_in_id, field_data, created_at, status, template_id')
  .eq('clinic_id', cid)
  .eq('status', 'draft')
  .order('created_at', { ascending: false });
if (dErr) throw dErr;
const staffDrafts = (drafts || []).filter(r => (r.field_data || {}).request_origin === 'staff_consult');
log('── [2] 현재 draft 전체 / staff_consult 큐 ──');
log(`  status='draft' 전체: ${drafts.length}건`);
log(`  그중 request_origin='staff_consult'(큐 표시대상): ${staffDrafts.length}건`);
for (const r of staffDrafts.slice(0, 30)) {
  const fd = r.field_data || {};
  log(`   • ${r.created_at}  ${fd.patient_name ?? '—'}  doc=${fd.doc_type}  reqBy=${fd.requested_by_name ?? ''}  id=${r.id}`);
}
log('');

// [3] 최근 14일 form_submissions 상태분포 (draft/voided/published) — 소실 흐름 추적
const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
const { data: recent } = await sb
  .from('form_submissions')
  .select('id, field_data, created_at, status, updated_at')
  .eq('clinic_id', cid)
  .gte('created_at', `${since}T00:00:00+09:00`)
  .order('created_at', { ascending: false });
const byStatus = {};
let staffOrigin = 0;
for (const r of recent || []) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  if ((r.field_data || {}).request_origin === 'staff_consult') staffOrigin++;
}
log(`── [3] 최근 14일(${since}~) form_submissions 상태분포 ──`);
log('  ' + JSON.stringify(byStatus));
log(`  request_origin='staff_consult' 총건(전상태): ${staffOrigin}\n`);

// [4] staff_consult 요청 전건(전상태) — draft가 어디로 갔는지 status별로
const { data: allReq } = await sb
  .from('form_submissions')
  .select('id, field_data, created_at, updated_at, status')
  .eq('clinic_id', cid)
  .order('created_at', { ascending: false })
  .limit(500);
const sc = (allReq || []).filter(r => (r.field_data || {}).request_origin === 'staff_consult');
const scByStatus = {};
for (const r of sc) scByStatus[r.status] = (scByStatus[r.status] || 0) + 1;
log('── [4] staff_consult 요청 전건(최근 500 스캔) status 분포 ──');
log('  ' + JSON.stringify(scByStatus));
log(`  총 staff_consult 요청: ${sc.length}건`);
// voided(=발행완료) 중 resolved_reason 분포
const voided = sc.filter(r => r.status === 'voided');
const vReason = {};
for (const r of voided) { const rr = (r.field_data || {}).resolved_reason ?? '(none)'; vReason[rr] = (vReason[rr] || 0) + 1; }
log(`  voided resolved_reason 분포: ${JSON.stringify(vReason)}`);
log('');

// [5] 오늘/어제 생성된 staff_consult 요청 (현장 소실 신고 근접 구간)
const todayKST = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
const yestKST = new Date(Date.now() + 9 * 36e5 - 864e5).toISOString().slice(0, 10);
log(`── [5] 최근 생성 staff_consult 요청 (오늘=${todayKST}, 어제=${yestKST}) ──`);
for (const r of sc.slice(0, 25)) {
  const fd = r.field_data || {};
  log(`   • cre=${r.created_at}  upd=${r.updated_at ?? ''}  status=${r.status}  ${fd.patient_name ?? '—'}  reason=${fd.resolved_reason ?? ''}`);
}

log('\n✅ audit done — 분기 판정: [2] staffDrafts>0 & 신고건 존재=A(필터), draft 완전0인데 신고건 voided/삭제=조사계속');
await sb.auth.signOut().catch(() => {});
process.exit(0);
