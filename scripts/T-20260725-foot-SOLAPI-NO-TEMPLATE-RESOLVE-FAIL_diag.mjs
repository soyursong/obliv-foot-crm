/**
 * T-20260725-foot-SOLAPI-NO-TEMPLATE-RESOLVE-FAIL — 1단계 진단 (READ-ONLY, 무위험)
 *
 * 목적: 최근30일 풋(clinic A 종로) "no template found" 실패 255건의 근본원인 규명.
 *  Q1. no-template 실패가 어느 event_type(발송유형)에서 나는가?  (분류)
 *  Q2. send-notification EF 템플릿 조회 = (clinic_id, event_type, is_active=true) 3키.
 *      → notification_templates 실재를 clinic×event_type×is_active 로 대조 (어느 키가 미스나는가)
 *  Q3. 원인분류: (a)템플릿 레코드/설정 누락 (b)조회키 불일치 (c)특정 경로만 미등록
 *
 * 데이터 변경 없음. SELECT/count 만 수행.
 */
import fs from 'fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, ''); const SR = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };

async function rest(path, extraHeaders = {}) {
  const r = await fetch(BASE + '/rest/v1/' + path, { headers: { ...H, ...extraHeaders } });
  const cr = r.headers.get('content-range');
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { j, contentRange: cr, status: r.status };
}
// exact count helper
async function count(table, filter) {
  const { contentRange } = await rest(`${table}?select=id&${filter}`, { Prefer: 'count=exact', Range: '0-0' });
  return contentRange ? Number(contentRange.split('/')[1]) : null;
}

const SINCE = '2026-06-25'; // 최근 30일 (today 2026-07-25)

(async () => {
  console.log('=== T-20260725 no-template 진단 (READ-ONLY) ===');
  console.log('window: notification_logs.created_at >= ' + SINCE + '\n');

  // ── clinics 목록 (clinic_id ↔ name 매핑) ──
  const clinics = (await rest('clinics?select=id,name,slug')).j;
  const cById = {};
  for (const c of clinics) cById[c.id] = c;
  console.log('[clinics]');
  for (const c of clinics) console.log('  ' + c.id + '  ' + (c.slug || '') + '  ' + c.name);

  // ── Q1. no-template 실패 전체 건수 + event_type별 분류 ──
  const noTmplFilter = `status=eq.failed&error_message=eq.no template found&created_at=gte.${SINCE}`;
  const total = await count('notification_logs', noTmplFilter);
  console.log(`\n[Q1] no-template failed 총 ${total}건 (최근30일 전 CRM)`);

  // event_type + clinic_id 별 분해 — 페이지네이션으로 전량 수집
  const rows = [];
  let from = 0; const PAGE = 1000;
  while (true) {
    const { j } = await rest(
      `notification_logs?select=event_type,clinic_id,channel,created_at&${noTmplFilter}&order=created_at.desc`,
      { Range: `${from}-${from + PAGE - 1}` }
    );
    if (!Array.isArray(j) || j.length === 0) break;
    rows.push(...j);
    if (j.length < PAGE) break;
    from += PAGE;
  }
  console.log(`  (수집 ${rows.length}행)`);

  const byClinicEvent = {};
  const byEvent = {};
  const byClinic = {};
  for (const r of rows) {
    const cname = (cById[r.clinic_id]?.slug) || (cById[r.clinic_id]?.name) || r.clinic_id?.slice(0, 8) || 'NULL';
    const k = `${cname} | ${r.event_type}`;
    byClinicEvent[k] = (byClinicEvent[k] || 0) + 1;
    byEvent[r.event_type] = (byEvent[r.event_type] || 0) + 1;
    byClinic[cname] = (byClinic[cname] || 0) + 1;
  }
  console.log('\n[Q1a] event_type별:');
  for (const [k, v] of Object.entries(byEvent).sort((a, b) => b[1] - a[1])) console.log('  ' + String(v).padStart(5) + '건  ' + k);
  console.log('\n[Q1b] clinic별:');
  for (const [k, v] of Object.entries(byClinic).sort((a, b) => b[1] - a[1])) console.log('  ' + String(v).padStart(5) + '건  ' + k);
  console.log('\n[Q1c] clinic × event_type:');
  for (const [k, v] of Object.entries(byClinicEvent).sort((a, b) => b[1] - a[1])) console.log('  ' + String(v).padStart(5) + '건  ' + k);

  // ── Q2. notification_templates 실재 대조 (EF 조회 3키: clinic_id, event_type, is_active) ──
  const tmpls = (await rest('notification_templates?select=clinic_id,event_type,is_active,channel,id')).j;
  console.log(`\n[Q2] notification_templates 총 ${Array.isArray(tmpls) ? tmpls.length : '?'}행`);
  const tmplKey = new Set();     // clinic|event  (is_active=true 인 것만 = EF가 찾는 것)
  const tmplKeyAny = new Set();  // clinic|event  (is_active 무관)
  const tmplByClinic = {};
  for (const t of tmpls) {
    const cname = (cById[t.clinic_id]?.slug) || t.clinic_id?.slice(0, 8) || 'NULL';
    tmplKeyAny.add(`${cname}|${t.event_type}`);
    if (t.is_active === true) tmplKey.add(`${cname}|${t.event_type}`);
    (tmplByClinic[cname] ||= []).push(`${t.event_type}${t.is_active ? '' : '(inactive)'}`);
  }
  console.log('  [활성 템플릿 clinic별 보유 event_type]');
  for (const [c, evs] of Object.entries(tmplByClinic)) console.log('    ' + c + ': ' + evs.sort().join(', '));

  // ── Q3. 실패 (clinic,event) 조합이 템플릿에 있는지 판정 ──
  console.log('\n[Q3] 실패 조합별 템플릿 실재 판정 (EF는 is_active=true 만 매칭):');
  const failCombos = new Set(rows.map(r => {
    const cname = (cById[r.clinic_id]?.slug) || (cById[r.clinic_id]?.name) || r.clinic_id?.slice(0, 8) || 'NULL';
    return `${cname}|${r.event_type}`;
  }));
  for (const combo of failCombos) {
    const hasActive = tmplKey.has(combo);
    const hasAny = tmplKeyAny.has(combo);
    let verdict;
    if (hasActive) verdict = '⚠ 활성템플릿 존재하는데 실패 → (b)조회키/타이밍 불일치 의심';
    else if (hasAny) verdict = '△ 템플릿 존재하나 is_active=false → (a)비활성 설정';
    else verdict = '✗ 템플릿 레코드 자체 없음 → (a)레코드 누락 / (c)해당경로 미등록';
    console.log('  ' + combo.padEnd(45) + verdict);
  }

  // ── event_type 도메인 목록 (EF 정의 vs templates 등록) ──
  const efEvents = ['resv_confirm', 'resv_reminder_d1', 'resv_reminder_morning', 'noshow'];
  const registeredEvents = new Set(tmpls.filter(t => t.is_active).map(t => t.event_type));
  console.log('\n[참고] EF 정의 event_type vs 활성템플릿 등록 여부(전 clinic 합집합):');
  for (const e of efEvents) console.log('  ' + e.padEnd(24) + (registeredEvents.has(e) ? '등록됨' : '✗ 미등록(어느 clinic도 활성템플릿 없음)'));
  const extraEvents = [...registeredEvents].filter(e => !efEvents.includes(e));
  if (extraEvents.length) console.log('  (템플릿엔 있으나 EF 미정의: ' + extraEvents.join(', ') + ')');

  console.log('\n=== 진단 끝 ===');
})();
