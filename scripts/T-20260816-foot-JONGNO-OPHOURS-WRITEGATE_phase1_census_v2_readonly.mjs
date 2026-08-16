/**
 * T-20260816-foot-JONGNO-OPHOURS-WRITEGATE — Phase 1 READ-ONLY census v2 (prod)
 *
 * v2 델타(v1 대비): (1) created_via=NULL 버킷을 source_system 으로 교차분류(staff vs external),
 *   (2) out-of-window 를 REASON(closed_day/after_last_slot/before_open)으로 분해,
 *   (3) 버킷별 dow 분포. → 스태프 '의도적 예외운영' 실태(요일/시간유형) 규명.
 *
 * PHI 위생: 실명·연락처 컬럼 SELECT 안 함. emit = created_via/source_system/date/time/dow/visit_type/status.
 * UPDATE·INSERT·DDL 절대 없음 — 순수 SELECT census. write0·db_change0.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function loadEnv(path) {
  const out = {};
  if (!fs.existsSync(path)) return out;
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = { ...loadEnv('.env'), ...loadEnv('.env.local') };
const URL = env.VITE_SUPABASE_URL || process.env.SUPABASE_CRM_FOOT_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('❌ env 부재'); process.exit(1); }
const projectRef = URL.replace(/^https:\/\//, '').split('.')[0];
if (projectRef !== 'rxlomoozakkjesdqjtvd') { console.error(`❌ prod ref 불일치: ${projectRef}`); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const EXTERNAL_VIA = new Set(['dopamine', 'aicc', 'naver', 'meta', 'kakao', 'inbound', 'selfbook']);
const STAFF_VIA = new Set(['manual', 'walkin']);

function hhmmToMin(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

async function main() {
  const { data: clinics } = await sb.from('clinics').select('id, slug, name');
  const jongno = clinics.find(c => (c.slug || '').includes('jongno') || (c.name || '').includes('종로'));
  const jongnoId = jongno.id;

  const { data: oh } = await sb.from('clinic_operating_hours')
    .select('day_of_week, open_time, close_time, last_booking_slot, effective_from')
    .eq('clinic_id', jongnoId);
  const windowByDow = {};
  (oh || []).forEach(r => { windowByDow[r.day_of_week] = { openMin: hhmmToMin(r.open_time), lastMin: hhmmToMin(r.last_booking_slot) }; });

  const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('reservations')
      .select('reservation_date, reservation_time, created_via, source_system, visit_type, status')
      .eq('clinic_id', jongnoId)
      .gte('reservation_date', since)
      .order('reservation_date', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`=== census v2 (jongno ${jongnoId}, since ${since}, n=${rows.length}) ===`);
  const days = 120, mo = d => (d / days * 30).toFixed(1);

  // out-of-window 판정 + REASON
  function oowReason(r) {
    if (!r.reservation_date || !r.reservation_time) return 'undetermined';
    const dow = new Date(r.reservation_date + 'T00:00:00').getDay();
    const w = windowByDow[dow];
    if (!w) return 'closed_day';                       // dow 운영창 미존재 = 휴무(예: 일)
    const t = hhmmToMin(r.reservation_time);
    if (t == null || w.openMin == null || w.lastMin == null) return 'undetermined';
    if (t < w.openMin) return 'before_open';
    if (t > w.lastMin) return 'after_last_slot';       // last_booking_slot INCLUSIVE
    return 'in_window';
  }

  // 정밀 버킷: created_via 우선, NULL 은 source_system 으로 강등분류
  function refinedBucket(r) {
    const v = (r.created_via || '').toLowerCase();
    if (v && EXTERNAL_VIA.has(v)) return 'external';
    if (v && STAFF_VIA.has(v)) return 'staff';
    // created_via NULL/미상 → source_system 으로 판정 (EF: NULL=사람저작=staff / 값=sync=external)
    if (v === '') return (r.source_system == null || r.source_system === '') ? 'staff(via=NULL,ss=NULL)' : `external(via=NULL,ss=${r.source_system})`;
    return `other(${r.created_via})`;
  }

  const DOW = ['일','월','화','수','목','금','토'];
  const agg = {};
  for (const r of rows) {
    const b = refinedBucket(r);
    agg[b] ||= { total: 0, reason: {}, dowOut: {}, hourOut: {}, vtOut: {} };
    agg[b].total++;
    const reason = oowReason(r);
    if (reason !== 'in_window' && reason !== 'undetermined') {
      agg[b].reason[reason] = (agg[b].reason[reason] || 0) + 1;
      const dow = new Date(r.reservation_date + 'T00:00:00').getDay();
      agg[b].dowOut[DOW[dow]] = (agg[b].dowOut[DOW[dow]] || 0) + 1;
      const hr = String(r.reservation_time || '').slice(0, 2);
      agg[b].hourOut[hr] = (agg[b].hourOut[hr] || 0) + 1;
      const vt = r.visit_type ?? 'NULL';
      agg[b].vtOut[vt] = (agg[b].vtOut[vt] || 0) + 1;
    } else if (reason === 'undetermined') {
      agg[b].reason.undetermined = (agg[b].reason.undetermined || 0) + 1;
    }
  }

  for (const [b, a] of Object.entries(agg).sort((x,y)=>y[1].total-x[1].total)) {
    const out = Object.entries(a.reason).filter(([k])=>k!=='undetermined').reduce((s,[,n])=>s+n,0);
    console.log(`\n[${b}] total=${a.total}  out-of-window=${out} (≈${mo(out)}건/월)  undetermined=${a.reason.undetermined||0}`);
    console.log(`   reason: ${JSON.stringify(a.reason)}`);
    console.log(`   out.dow: ${JSON.stringify(a.dowOut)}`);
    console.log(`   out.hour: ${JSON.stringify(a.hourOut)}`);
    console.log(`   out.visit_type: ${JSON.stringify(a.vtOut)}`);
  }
  console.log('\n✅ census v2 done (READ-ONLY, write0).');
}
main().catch(e => { console.error('❌', e.message || e); process.exit(1); });
