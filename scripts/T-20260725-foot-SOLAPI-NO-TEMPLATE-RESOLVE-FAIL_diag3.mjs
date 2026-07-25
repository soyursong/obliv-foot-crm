/**
 * T-20260725 3차 확정진단 (READ-ONLY): no-template 실패 종료시점 ↔ 템플릿 updated_at 상관 +
 * 07-11 이후 실패사유 전환 확인 + 중복행 가능성(제약) 점검.
 */
import fs from 'fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, ''); const SR = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };
async function rest(path, extra = {}) { const r = await fetch(BASE + '/rest/v1/' + path, { headers: { ...H, ...extra } }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { j, cr: r.headers.get('content-range') }; }
const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const SINCE = '2026-06-25';

(async () => {
  // ── 각 event_type: no-template 실패 min/max + 활성템플릿 updated_at ──
  console.log('=== event_type별 no-template 실패창 ↔ 템플릿 updated_at ===');
  const { j: tmpls } = await rest(`notification_templates?select=event_type,updated_at,created_at,is_active&clinic_id=eq.${JONGNO}&is_active=eq.true`);
  const tByEv = {}; for (const t of tmpls) tByEv[t.event_type] = t;
  for (const ev of ['resv_confirm', 'resv_reminder_d1', 'resv_reminder_morning']) {
    const { j: rows } = await rest(`notification_logs?select=created_at&clinic_id=eq.${JONGNO}&status=eq.failed&error_message=eq.no template found&event_type=eq.${ev}&created_at=gte.${SINCE}&order=created_at.asc`);
    const arr = Array.isArray(rows) ? rows : [];
    const t = tByEv[ev];
    console.log(`\n  ${ev}`);
    console.log(`    no-template 실패: ${arr.length}건, 최초 ${arr[0]?.created_at?.slice(0,19)} ~ 최종 ${arr[arr.length-1]?.created_at?.slice(0,19)}`);
    console.log(`    활성템플릿 updated_at=${t?.updated_at?.slice(0,19)}  created_at=${t?.created_at?.slice(0,19)}`);
  }

  // ── resv_confirm 전체 실패의 error_message × 주별 전환 (07-11 이후 뭐로 바뀌나) ──
  console.log('\n=== resv_confirm 전체 failed 의 error_message × 일별 (07-08~ ) ===');
  const rows = [];
  let from = 0; const PAGE = 1000;
  while (true) {
    const { j } = await rest(`notification_logs?select=created_at,error_message&clinic_id=eq.${JONGNO}&status=eq.failed&event_type=eq.resv_confirm&created_at=gte.2026-07-08&order=created_at.asc`, { Range: `${from}-${from+PAGE-1}` });
    if (!Array.isArray(j) || j.length === 0) break; rows.push(...j); if (j.length < PAGE) break; from += PAGE;
  }
  const dayMsg = {};
  for (const r of rows) {
    const d = r.created_at.slice(0, 10);
    const msg = (r.error_message || '').slice(0, 40);
    (dayMsg[d] ||= {})[msg] = (dayMsg[d][msg] || 0) + 1;
  }
  for (const [d, msgs] of Object.entries(dayMsg).sort()) {
    console.log(`  ${d}:`);
    for (const [m, c] of Object.entries(msgs).sort((a,b)=>b[1]-a[1])) console.log(`      ${String(c).padStart(4)}  ${m}`);
  }

  // ── 실패 로그의 reservation_id 존재/clinic 정합 샘플 (조회키 불일치 H 확인) ──
  console.log('\n=== no-template 실패건 reservation_id 정합 샘플 (10건) ===');
  const { j: samp } = await rest(`notification_logs?select=reservation_id,customer_id,created_at&clinic_id=eq.${JONGNO}&status=eq.failed&error_message=eq.no template found&event_type=eq.resv_confirm&created_at=gte.${SINCE}&order=created_at.desc&limit=10`);
  for (const s of (Array.isArray(samp) ? samp : [])) {
    let resvClinic = 'n/a';
    if (s.reservation_id) {
      const { j: rv } = await rest(`reservations?select=clinic_id,status&id=eq.${s.reservation_id}`);
      resvClinic = Array.isArray(rv) && rv[0] ? `${rv[0].clinic_id?.slice(0,8)}(${rv[0].status})` : 'NOT-FOUND';
    }
    console.log(`  log ${s.created_at?.slice(0,19)} resv=${s.reservation_id?.slice(0,8)||'NULL'} resv.clinic=${resvClinic} ${s.reservation_id && resvClinic.startsWith('74967aea') ? '✓정합' : '⚠'}`);
  }

  console.log('\n=== 3차 진단 끝 ===');
})();
