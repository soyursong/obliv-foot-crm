/**
 * T-20260811-dopamine-SVM-VISIT-EXTRACT-KICKOFF — foot leg (READ-ONLY, de-id)
 * ----------------------------------------------------------------------------
 * SVM 연구 데이터셋 — foot CRM 측 라벨(내원 O/X) + foot-파생 피처 추출.
 * - READ-ONLY: DB write 0 / 스키마 0 / 배포 0. PostgREST GET only.
 * - de-id(H5): 성명/전화/주민번호/free-text(memo/referral) DROP. surrogate key(reservation.id)만.
 * - §36 방화벽(H3): inflow_channel/referral_source/source_system 미수집(read-only 참조도 피처화 안 함).
 * - 오리진 scope: clinic slug 'jongno-foot'.
 * - 산출: crm_reservation_id(=reservations.id, 서로게이트) 그레인 de-id 집계행 + 라벨.
 *   dev-dopamine 이 (surrogate_key ↔ crm_reservation_id) 매핑으로 inner-join → 미매핑 행 제외(H1).
 * - target leakage 회피: 당해 reservation.status(checked_in) = 라벨과 동일신호 → 피처 제외.
 *
 * 실행: node scripts/T-20260811-dopamine-SVM-VISIT-EXTRACT_foot-leg.mjs
 * 출력: ~/claude-sync/memory/_handoff/svm-visit-extract/foot_deid_features.csv
 *       ~/claude-sync/memory/_handoff/svm-visit-extract/foot_data_quality.json
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// ── env ──
const envPath = path.join(process.cwd(), '.env.local');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL = env.VITE_SUPABASE_URL;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SR) throw new Error('missing supabase creds');
const JONGNO_FOOT = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // clinics.slug='jongno-foot'

const H = { apikey: SR, Authorization: `Bearer ${SR}` };

// paginated read-only fetch (PostgREST Range)
async function fetchAll(table, select, filter = '') {
  const rows = [];
  const page = 1000;
  for (let off = 0; ; off += page) {
    const url = `${URL}/rest/v1/${table}?select=${select}${filter}`;
    const res = await fetch(url, { headers: { ...H, Range: `${off}-${off + page - 1}` } });
    if (!res.ok) throw new Error(`${table} ${res.status} ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

const dOnly = (ts) => (ts ? String(ts).slice(0, 10) : null);
const dayDiff = (a, b) => { // a,b: 'YYYY-MM-DD' -> a - b in days
  if (!a || !b) return null;
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
};
const isoDow = (dateStr) => { // Mon=1..Sun=7
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  return d === 0 ? 7 : d;
};
const hourOf = (timeStr) => { // 'HH:MM:SS' -> int
  if (!timeStr) return null;
  const h = parseInt(String(timeStr).slice(0, 2), 10);
  return Number.isFinite(h) ? h : null;
};
const timeBand = (h) => (h == null ? null : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');
const leadBucket = (d) => (d == null ? null : d < 0 ? 'walkin_sameday_neg' : d === 0 ? 'sameday' : d <= 1 ? '1d' : d <= 3 ? '2-3d' : d <= 7 ? '4-7d' : d <= 14 ? '8-14d' : '15d+');

(async () => {
  console.log('▶ READ-ONLY 추출 시작', new Date().toISOString());

  // 1) reservations (jongno-foot) — de-id 컬럼만
  const resv = await fetchAll(
    'reservations',
    'id,customer_id,reservation_date,reservation_time,visit_type,status,service_id,created_at',
    `&clinic_id=eq.${JONGNO_FOOT}`
  );
  console.log(`  reservations(jongno-foot): ${resv.length}`);

  // 2) check_ins (jongno-foot) — 라벨 + 재진 판정용 (de-id: reservation_id,customer_id,checked_in_at)
  const checkins = await fetchAll(
    'check_ins',
    'id,reservation_id,customer_id,checked_in_at',
    `&clinic_id=eq.${JONGNO_FOOT}`
  );
  console.log(`  check_ins(jongno-foot): ${checkins.length}`);

  // 3) customers — tenure(created_at)용, de-id: id,created_at
  const custs = await fetchAll('customers', 'id,created_at');
  console.log(`  customers: ${custs.length}`);

  // ── 인덱스 ──
  const checkinByResv = new Set(checkins.map((c) => c.reservation_id).filter(Boolean));
  const custCreated = new Map(custs.map((c) => [c.id, dOnly(c.created_at)]));
  // customer -> check_in dates
  const custCheckinDates = new Map();
  for (const c of checkins) {
    if (!c.customer_id || !c.checked_in_at) continue;
    if (!custCheckinDates.has(c.customer_id)) custCheckinDates.set(c.customer_id, []);
    custCheckinDates.get(c.customer_id).push(dOnly(c.checked_in_at));
  }
  // customer -> reservations (for prior counts)
  const custResv = new Map();
  for (const r of resv) {
    if (!r.customer_id) continue;
    if (!custResv.has(r.customer_id)) custResv.set(r.customer_id, []);
    custResv.get(r.customer_id).push(r);
  }

  // ── 피처 빌드 ──
  const outRows = [];
  const cap = {}; // capture counts
  const bump = (k, ok) => { cap[k] = cap[k] || { n: 0, ok: 0 }; cap[k].n++; if (ok) cap[k].ok++; };

  for (const r of resv) {
    const rdate = r.reservation_date;                 // DATE
    const cdate = dOnly(r.created_at);                // booking date
    const label = checkinByResv.has(r.id) ? 1 : 0;    // ★ 내원 O/X

    // 5. 리드타임(예약확정~방문예정, 일)
    const lead = dayDiff(rdate, cdate);
    // 6. 방문예정 요일(월1~일7)
    const dow = isoDow(rdate);
    // 7. 방문예정 시간대
    const hr = hourOf(r.reservation_time);
    const band = timeBand(hr);
    // 10. 재진 여부 = 당해 방문일 이전 check_in 존재
    let revisit = null, priorCheckinCnt = null;
    if (r.customer_id) {
      const dates = custCheckinDates.get(r.customer_id) || [];
      const prior = dates.filter((d) => d && rdate && d < rdate).length;
      priorCheckinCnt = prior;
      revisit = prior > 0 ? 1 : 0;
    }
    // 11. 이전 취소·노쇼 횟수(booking 시점 이전 예약 기준). 재진 한정 semantic.
    let priorCancelNoshow = null;
    if (r.customer_id) {
      const rs = custResv.get(r.customer_id) || [];
      priorCancelNoshow = rs.filter((x) =>
        x.id !== r.id && dOnly(x.created_at) && cdate && dOnly(x.created_at) < cdate &&
        (x.status === 'cancelled' || x.status === 'noshow')
      ).length;
    }
    // 추가 de-id 피처
    const priorResvCnt = r.customer_id
      ? (custResv.get(r.customer_id) || []).filter((x) => x.id !== r.id && dOnly(x.created_at) && cdate && dOnly(x.created_at) < cdate).length
      : null;
    const tenure = r.customer_id && custCreated.get(r.customer_id) && cdate ? dayDiff(cdate, custCreated.get(r.customer_id)) : null;
    const month = rdate ? parseInt(rdate.slice(5, 7), 10) : null;
    const hasService = r.service_id ? 1 : 0;

    // capture tracking
    bump('label', true);
    bump('f5_lead_time_days', lead != null);
    bump('f6_visit_dow', dow != null);
    bump('f7_time_band', band != null);
    bump('f7_reservation_hour', hr != null);
    bump('f10_revisit', revisit != null);
    bump('f11_prior_cancel_noshow', priorCancelNoshow != null);
    bump('x_prior_reservation_count', priorResvCnt != null);
    bump('x_prior_checkin_count', priorCheckinCnt != null);
    bump('x_customer_tenure_days', tenure != null);
    bump('x_visit_type', !!r.visit_type);
    bump('x_visit_month', month != null);
    bump('x_has_service', true);

    outRows.push({
      crm_reservation_id: r.id,
      label_visited: label,
      f5_lead_time_days: lead ?? '',
      f5_lead_time_bucket: leadBucket(lead) ?? '',
      f6_visit_dow: dow ?? '',
      f7_reservation_hour: hr ?? '',
      f7_time_band: band ?? '',
      f10_revisit: revisit ?? '',
      f11_prior_cancel_noshow: priorCancelNoshow ?? '',
      x_prior_reservation_count: priorResvCnt ?? '',
      x_prior_checkin_count: priorCheckinCnt ?? '',
      x_customer_tenure_days: tenure ?? '',
      x_visit_type: r.visit_type ?? '',
      x_visit_month: month ?? '',
      x_has_service: hasService,
    });
  }

  // ── CSV ──
  const outDir = path.join(os.homedir(), 'claude-sync/memory/_handoff/svm-visit-extract');
  fs.mkdirSync(outDir, { recursive: true });
  const cols = Object.keys(outRows[0]);
  const csv = [cols.join(',')].concat(
    outRows.map((row) => cols.map((c) => {
      const v = row[c];
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
  ).join('\n');
  fs.writeFileSync(path.join(outDir, 'foot_deid_features.csv'), csv);

  // ── data quality ──
  const capRate = {};
  for (const [k, v] of Object.entries(cap)) capRate[k] = { n: v.n, captured: v.ok, rate: +(v.ok / v.n).toFixed(4) };
  const labelPos = outRows.filter((r) => r.label_visited === 1).length;
  const dq = {
    ticket: 'T-20260811-dopamine-SVM-VISIT-EXTRACT-KICKOFF (foot leg)',
    generated_at: new Date().toISOString(),
    read_only: true,
    de_id: true,
    origin_scope: 'clinic slug=jongno-foot',
    firewall_note: '§36 inflow_channel/referral_source/source_system 미수집(피처 제외). target-leak(당해 status) 제외.',
    grain: 'crm_reservation_id (= foot reservations.id, surrogate)',
    row_count: outRows.length,
    label: {
      definition: 'check_ins.reservation_id 존재 = 1(내원) / 없음 = 0',
      positives: labelPos,
      negatives: outRows.length - labelPos,
      positive_rate: +(labelPos / outRows.length).toFixed(4),
    },
    feature_capture: capRate,
    join_contract: {
      note: 'dev-dopamine 이 (surrogate_key ↔ crm_reservation_id) 매핑으로 inner-join. 미매핑 행 제외(H1: 내원=0 default 금지).',
      keys: 'crm_reservation_id ← cue_cards.crm_reservation_id (dopamine 측). phone E.164 = fallback only(본 산출 미사용).',
      superset_notice: '본 산출은 jongno-foot 전체 reservation 슈퍼셋(cohort 미필터). dopamine 매핑 교집합이 최종 코호트.',
    },
  };
  fs.writeFileSync(path.join(outDir, 'foot_data_quality.json'), JSON.stringify(dq, null, 2));

  console.log(`✅ 완료: ${outRows.length}행, 라벨+=${labelPos}(${(labelPos/outRows.length*100).toFixed(1)}%)`);
  console.log(`   CSV: ${path.join(outDir, 'foot_deid_features.csv')}`);
  console.log(`   DQ : ${path.join(outDir, 'foot_data_quality.json')}`);
  console.log('── capture rates ──');
  for (const [k, v] of Object.entries(capRate)) console.log(`  ${k}: ${(v.rate*100).toFixed(1)}% (${v.captured}/${v.n})`);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
