/**
 * T-20260725 2차 정밀진단 (READ-ONLY): 활성템플릿 존재하는데 no-template 실패하는 이유 규명.
 * 가설검증:
 *   H1 타이밍: 실패가 템플릿 생성/활성화 이전 시각에 몰려있나? (실패 created_at 히스토그램 vs 템플릿 created/updated)
 *   H2 중복행: (clinic,event,is_active=true) 다중행 → EF .maybeSingle() 이 PGRST116 error → tmpl=null?
 *   H3 채널: EF는 .order('channel').maybeSingle(). 활성행이 채널별로 여러개면 maybeSingle 깨짐.
 */
import fs from 'fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, ''); const SR = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };
async function rest(path, extra = {}) { const r = await fetch(BASE + '/rest/v1/' + path, { headers: { ...H, ...extra } }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { j, status: r.status, cr: r.headers.get('content-range') }; }

const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const SINCE = '2026-06-25';

(async () => {
  // ── H2/H3: jongno 템플릿 전체 상세 (event_type × channel × is_active × 타임스탬프) ──
  console.log('=== [H2/H3] jongno notification_templates 전체 상세 ===');
  const { j: tmpls } = await rest(`notification_templates?select=id,event_type,channel,is_active,created_at,updated_at,image_path&clinic_id=eq.${JONGNO}&order=event_type,channel`);
  const activeCombo = {};
  for (const t of tmpls) {
    console.log(`  ${t.is_active ? '✅' : '⬜'} ${String(t.event_type).padEnd(30)} ch=${String(t.channel).padEnd(6)} created=${t.created_at?.slice(0,19)} updated=${t.updated_at?.slice(0,19)}`);
    if (t.is_active) { const k = t.event_type; (activeCombo[k] ||= []).push(t.channel); }
  }
  console.log('\n  [활성행 event_type별 개수 — >1 이면 EF .maybeSingle() PGRST116 위험]');
  for (const [k, chs] of Object.entries(activeCombo)) console.log(`    ${k.padEnd(30)} ${chs.length}행  (채널: ${chs.join(',')})  ${chs.length > 1 ? '⚠ 다중행!' : ''}`);

  // ── EF 조회 재현: 실제 .maybeSingle() 이 뭘 반환하는지 REST로 시뮬 ──
  console.log('\n=== [EF 조회 재현] clinic=jongno, is_active=true, 각 event_type ===');
  for (const ev of ['resv_confirm', 'resv_reminder_d1', 'resv_reminder_morning']) {
    const { j, status } = await rest(`notification_templates?select=id,channel,is_active&clinic_id=eq.${JONGNO}&event_type=eq.${ev}&is_active=eq.true&order=channel`);
    console.log(`  ${ev.padEnd(24)} → ${Array.isArray(j) ? j.length + '행' : 'ERR'} ${Array.isArray(j) && j.length > 1 ? '⚠ maybeSingle() 다중행 error 발생 → tmpl=null' : ''}`);
  }

  // ── H1: 실패 시각 히스토그램 (일별) ──
  console.log('\n=== [H1] resv_confirm no-template 실패 일별 분포 ===');
  const rows = [];
  let from = 0; const PAGE = 1000;
  const filter = `clinic_id=eq.${JONGNO}&status=eq.failed&error_message=eq.no template found&event_type=eq.resv_confirm&created_at=gte.${SINCE}`;
  while (true) {
    const { j } = await rest(`notification_logs?select=created_at,reservation_id&${filter}&order=created_at.desc`, { Range: `${from}-${from + PAGE - 1}` });
    if (!Array.isArray(j) || j.length === 0) break;
    rows.push(...j); if (j.length < PAGE) break; from += PAGE;
  }
  const byDay = {};
  for (const r of rows) { const d = r.created_at.slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; }
  for (const [d, v] of Object.entries(byDay).sort()) console.log(`  ${d}  ${'█'.repeat(Math.ceil(v / 3))} ${v}`);
  const times = rows.map(r => r.created_at).sort();
  console.log(`\n  실패 최초: ${times[0]}`);
  console.log(`  실패 최종: ${times[times.length - 1]}`);
  const confTmpl = tmpls.find(t => t.event_type === 'resv_confirm' && t.is_active);
  if (confTmpl) console.log(`  resv_confirm 활성템플릿 created=${confTmpl.created_at} updated=${confTmpl.updated_at}`);

  // ── 대조: 같은 기간 resv_confirm 성공(sent) 건수 — 템플릿이 되긴 하는가? ──
  const { cr: sentCr } = await rest(`notification_logs?select=id&clinic_id=eq.${JONGNO}&status=eq.sent&event_type=eq.resv_confirm&created_at=gte.${SINCE}`, { Prefer: 'count=exact', Range: '0-0' });
  const { cr: failCr } = await rest(`notification_logs?select=id&clinic_id=eq.${JONGNO}&status=eq.failed&event_type=eq.resv_confirm&created_at=gte.${SINCE}`, { Prefer: 'count=exact', Range: '0-0' });
  console.log(`\n  [대조] resv_confirm 최근30일 sent=${sentCr?.split('/')[1]} / failed(전체사유)=${failCr?.split('/')[1]}`);

  // ── manual_send 6건 no-template 이상건: manual_send는 EF에서 템플릿조회 안함 → 별도 확인 ──
  console.log('\n=== [부가] manual_send no-template 6건 (EF는 manual_send서 템플릿조회 안함 → 이력/타경로 의심) ===');
  const { j: ms } = await rest(`notification_logs?select=created_at,error_message,body_rendered&clinic_id=eq.${JONGNO}&event_type=eq.manual_send&error_message=eq.no template found&created_at=gte.${SINCE}&order=created_at.desc&limit=6`);
  for (const m of (Array.isArray(ms) ? ms : [])) console.log(`  ${m.created_at?.slice(0,19)}  body=${(m.body_rendered||'').slice(0,40)}`);

  console.log('\n=== 2차 진단 끝 ===');
})();
