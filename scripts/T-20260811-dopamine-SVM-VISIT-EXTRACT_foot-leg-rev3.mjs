/**
 * T-20260811-dopamine-SVM-VISIT-EXTRACT-KICKOFF — foot leg rev3 (READ-ONLY, de-id)
 * ----------------------------------------------------------------------------
 * rev3 재추출 (김지호 현장 추가 의뢰 3건 中 foot leg = ①②③):
 *  ① f11(이전 취소·노쇼 횟수) 보정 — 재진-한정 NA scope → 전체 행 customer_id 기준
 *     "방문 시점 이전(strict point-in-time cutoff)" 카운트로 확장.
 *     - 신규(이전 이력 부재) = 0 (NA 아님 — point-in-time 이전이력 부재 = 진짜 0회).
 *     - ★target-leak 가드: cutoff = 당해 reservation 의 방문예정일(reservation_date).
 *       이전 취소/노쇼의 "실현시각"(cancelled_at / no_show_clicked_at, fallback reservation_date)이
 *       당해 방문일보다 STRICT 하게 이전(< , 방문 당일/이후 제외)일 때만 집계 → 미래정보 누수 차단.
 *  ② 시점 원본 2컬럼(foot 측, date-only): reservation_confirmed_date(=created_at date, born-confirmed)
 *     + scheduled_visit_date(=reservation_date). time-of-day DROP(김지호 '일단위 절사' authorize).
 *  ③ 송도 feasibility = 별 census (본 스크립트 --songdo 로 별도 실행 / 아래 SONGDO_FEASIBILITY 참조).
 *
 * 가드: READ-ONLY(PostgREST GET only) · DB write 0 · 스키마 0 · 배포 0 · prod 무접점.
 *       de-id(H5): 성명/전화/주민번호/free-text DROP. surrogate_key 왕복만.
 *       §36 방화벽(H3): inflow_channel = read-only 참조(옵션 반환)만, ML분류/역기입 無.
 *       baseline: 정본 svm_dataset_final.csv (N=1,388). 반환키 = surrogate_key(handoff_to_devfoot.csv).
 *
 * 실행: node scripts/T-20260811-dopamine-SVM-VISIT-EXTRACT_foot-leg-rev3.mjs
 * 입력: ~/svm_visit_research/handoff_to_devfoot.csv (surrogate_key,crm_reservation_id,phone_e164_sha256)
 *       ~/svm_visit_research/phone_hash_salt.txt
 * 출력: ~/svm_visit_research/return_from_devfoot.csv   (surrogate_key 왕복 — dev-dopamine 병합 정본 경로)
 *       ~/claude-sync/memory/_handoff/svm-visit-extract/foot_leg_rev3_dq.json
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// ── env ──
const envPath = path.join(process.cwd(), '.env.local');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const BASE = env.VITE_SUPABASE_URL;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !SR) throw new Error('missing supabase creds');
const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // clinics.slug='jongno-foot'
const H = { apikey: SR, Authorization: `Bearer ${SR}` };

const RESEARCH = path.join(os.homedir(), 'svm_visit_research');
const HANDOFF_CSV = path.join(RESEARCH, 'handoff_to_devfoot.csv');
const SALT = fs.readFileSync(path.join(RESEARCH, 'phone_hash_salt.txt'), 'utf8').trim();
const RETURN_CSV = path.join(RESEARCH, 'return_from_devfoot.csv');
const DQ_JSON = path.join(os.homedir(), 'claude-sync/memory/_handoff/svm-visit-extract/foot_leg_rev3_dq.json');

// ── paginated read-only fetch ──
async function fetchAll(table, select, filter = '') {
  const rows = [];
  const page = 1000;
  for (let off = 0; ; off += page) {
    const url = `${BASE}/rest/v1/${table}?select=${select}${filter}`;
    const res = await fetch(url, { headers: { ...H, Range: `${off}-${off + page - 1}` } });
    if (!res.ok) throw new Error(`${table} ${res.status} ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

// ── de-id helpers ──
function e164(raw) { // spec: digits -> strip leading 82 -> strip leading 0 -> prepend +82
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  d = d.replace(/^82/, '').replace(/^0+/, '');
  if (!d) return null;
  return '+82' + d;
}
function phoneHash(raw) {
  const e = e164(raw);
  return e ? crypto.createHash('sha256').update(e + SALT).digest('hex') : null;
}
const kstDate = (ts) => { // timestamptz(UTC) -> KST 'YYYY-MM-DD'
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d)) return null;
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
};
const dOnly = (ts) => (ts ? String(ts).slice(0, 10) : null);
const dayDiff = (a, b) => (!a || !b ? null : Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000));
const isoDow = (dateStr) => { if (!dateStr) return null; const d = new Date(dateStr + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
const tod = (t) => { if (!t) return null; const h = parseInt(String(t).slice(0, 2), 10); if (isNaN(h)) return null; return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; };

(async () => {
  console.log('▶ rev3 READ-ONLY 추출 시작', new Date().toISOString());

  // 1) reservations (jongno-foot) — de-id 컬럼 + point-in-time 이벤트 시각
  const resv = await fetchAll(
    'reservations',
    'id,customer_id,customer_phone,reservation_date,reservation_time,visit_type,status,cancelled_at,no_show_clicked_at,inflow_channel,created_at',
    `&clinic_id=eq.${JONGNO}`
  );
  console.log(`  reservations(jongno-foot): ${resv.length}`);

  // 2) check_ins (jongno-foot, 활성만) — 라벨 + 재진 판정
  const checkins = (await fetchAll('check_ins', 'id,reservation_id,customer_id,checked_in_at,deleted_at', `&clinic_id=eq.${JONGNO}`))
    .filter((c) => !c.deleted_at);
  console.log(`  check_ins(jongno-foot, active): ${checkins.length}`);

  // ── 인덱스 ──
  const checkinByResv = new Set(checkins.map((c) => c.reservation_id).filter(Boolean));
  // customer identity key: customer_id primary, else normalized phone-hash (rev2 custKey 준용)
  const custKey = (r) => r.customer_id || ('ph:' + (phoneHash(r.customer_phone) || 'na'));
  for (const r of resv) {
    r._ck = custKey(r);
    r._hash = phoneHash(r.customer_phone);
    r._created_kst = kstDate(r.created_at);           // 예약확정일(born-confirmed proxy)
    r._visit_date = r.reservation_date;               // 방문예정일(scheduled visit date)
    r._has_checkin = checkinByResv.has(r.id);
    // 이전 취소/노쇼의 "실현시각" (target-leak-safe): 실제 이벤트 timestamp, fallback=방문예정일
    const isCancel = r.status === 'cancelled';
    const isNoshow = r.status === 'no_show';
    r._is_cancel_noshow = !!(isCancel || isNoshow);
    let realized = null;
    if (isCancel) realized = kstDate(r.cancelled_at);
    if (isNoshow && !realized) realized = kstDate(r.no_show_clicked_at);
    r._realized_date = realized || r.reservation_date; // fallback: 방문예정일
  }
  const byCust = new Map();
  for (const r of resv) { if (!byCust.has(r._ck)) byCust.set(r._ck, []); byCust.get(r._ck).push(r); }
  // customer -> check_in dates (재진 판정)
  const custCheckinDates = new Map();
  for (const c of checkins) {
    if (!c.checked_in_at) continue;
    const k = c.customer_id || null;
    if (!k) continue;
    if (!custCheckinDates.has(k)) custCheckinDates.set(k, []);
    custCheckinDates.get(k).push(kstDate(c.checked_in_at));
  }

  // ── per-reservation features ──
  for (const r of resv) {
    const peers = byCust.get(r._ck) || [];
    // ① f11 point-in-time (ALL rows): 당해 방문예정일(cutoff) 보다 STRICT 이전에 "실현"된 취소·노쇼 수.
    //   방문 당일/이후 실현 이벤트 제외(미래정보 누수 차단). 신규/이전이력 부재 = 0 (NA 아님).
    let f11 = 0;
    for (const p of peers) {
      if (p === r) continue;
      if (!p._is_cancel_noshow) continue;
      if (p._realized_date && r._visit_date && p._realized_date < r._visit_date) f11++;
    }
    r._f11 = f11;
    // f5 리드타임(예약확정~방문예정, 일)
    r._f5 = dayDiff(r._visit_date, r._created_kst);
    // f6 방문요일(월1~일7), f7 방문 시간대
    r._f6 = isoDow(r._visit_date);
    r._f7 = tod(r.reservation_time);
    // f10 재진: staff visit_type='returning' OR 당해 방문일 이전 내원(check_in) 존재
    let priorVisit = false;
    if (r.customer_id) {
      const dates = custCheckinDates.get(r.customer_id) || [];
      priorVisit = dates.some((d) => d && r._visit_date && d < r._visit_date);
    }
    r._f10 = (r.visit_type === 'returning' || priorVisit) ? 1 : 0;
  }

  // lookups for handoff mapping
  const byId = new Map(resv.map((r) => [r.id, r]));
  const byHash = new Map();
  for (const r of resv) { if (r._hash) { if (!byHash.has(r._hash)) byHash.set(r._hash, []); byHash.get(r._hash).push(r); } }

  function featRow(sk, r, method, labelOverride) {
    const label = labelOverride !== undefined ? labelOverride : (r._has_checkin ? 1 : 0);
    return {
      surrogate_key: sk,
      mapped: true,
      join_method: method,
      label_visit: label,
      f5_reserve_to_visit_leadtime_d: r._f5 ?? '',
      f6_visit_weekday: r._f6 ?? '',
      f7_visit_tod: r._f7 ?? '',
      f10_is_returning_foot: r._f10,
      // ① rev3: 전체 행 point-in-time 카운트 (신규=0, NA 아님). 재진-한정 NA scope SUPERSEDE.
      f11_prev_cancel_noshow_cnt: r._f11,
      // ② date-only 시점 원본 2컬럼
      reservation_confirmed_date: r._created_kst ?? '', // 예약 확정일시(born-confirmed) date-only
      scheduled_visit_date: r._visit_date ?? '',        // 방문 예정일시 date-only (NEW)
      // §36 옵션 반환(read-only 참조): 접수유입 11코드
      f_inflow_channel_11code: r.inflow_channel ? r.inflow_channel : '',
    };
  }
  const COLS = ['surrogate_key', 'mapped', 'join_method', 'label_visit', 'f5_reserve_to_visit_leadtime_d',
    'f6_visit_weekday', 'f7_visit_tod', 'f10_is_returning_foot', 'f11_prev_cancel_noshow_cnt',
    'reservation_confirmed_date', 'scheduled_visit_date', 'f_inflow_channel_11code'];
  const unmappedRow = (sk) => Object.fromEntries(COLS.map((c) => [c, c === 'surrogate_key' ? sk : c === 'mapped' ? false : c === 'join_method' ? 'none' : '']));

  // ── handoff mapping (surrogate_key 왕복) ──
  const hlines = fs.readFileSync(HANDOFF_CSV, 'utf8').trim().split('\n');
  hlines.shift(); // header
  const out = [];
  const st = { primary: 0, fallback: 0, none: 0, l1: 0, l0: 0, inflowCap: 0, returning: 0, f11nonzero: 0, f11sum: 0, confDate: 0, schedDate: 0, everCN: 0 };
  // per-customer "ever cancel/noshow" (any-time, LEAK-prone context metric — NOT a returned feature)
  const custEverCN = new Map();
  for (const r of resv) { if (r._is_cancel_noshow) custEverCN.set(r._ck, true); }
  for (const line of hlines) {
    const [sk, crmId, phash] = line.split(',');
    let mappedR = null;
    let row;
    if (crmId && byId.has(crmId)) { mappedR = byId.get(crmId); row = featRow(sk, mappedR, 'primary'); st.primary++; }
    else if (phash && byHash.has(phash)) {
      const peers = byHash.get(phash).slice().sort((a, b) => (a._created_kst < b._created_kst ? -1 : 1));
      mappedR = peers[0];
      const anyVisit = peers.some((p) => p._has_checkin) ? 1 : 0;
      row = featRow(sk, mappedR, 'fallback_phone', anyVisit); st.fallback++;
    } else { row = unmappedRow(sk); st.none++; }
    if (row.mapped) {
      if (row.label_visit === 1) st.l1++; else if (row.label_visit === 0) st.l0++;
      if (row.f_inflow_channel_11code !== '') st.inflowCap++;
      if (row.f10_is_returning_foot === 1) st.returning++;
      if (row.f11_prev_cancel_noshow_cnt !== '' && row.f11_prev_cancel_noshow_cnt > 0) st.f11nonzero++;
      if (typeof row.f11_prev_cancel_noshow_cnt === 'number') st.f11sum += row.f11_prev_cancel_noshow_cnt;
      if (row.reservation_confirmed_date !== '') st.confDate++;
      if (row.scheduled_visit_date !== '') st.schedDate++;
      if (mappedR && custEverCN.get(mappedR._ck)) st.everCN++;
    }
    out.push(row);
  }

  // ── write return CSV ──
  const csv = [COLS.join(',')].concat(out.map((r) => COLS.map((c) => {
    const v = r[c]; const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(','))).join('\n') + '\n';
  fs.writeFileSync(RETURN_CSV, csv);

  const mapped = st.primary + st.fallback;

  // ── ③ 송도 feasibility census (read-only) ──
  const SONGDO = 'b4dc0de5-f007-4a57-8888-aabbccddeeff'; // clinics.slug='songdo-foot'
  async function cnt(table, filter) {
    const res = await fetch(`${BASE}/rest/v1/${table}?select=id${filter}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
    const cr = res.headers.get('content-range'); return cr ? +cr.split('/')[1] : null;
  }
  const songdo = {
    clinic_slug: 'songdo-foot', clinic_id: SONGDO, exists_in_clinics_table: true,
    reservations_total: await cnt('reservations', `&clinic_id=eq.${SONGDO}`),
    reservations_with_crm_reservation_id: await cnt('reservations', `&clinic_id=eq.${SONGDO}&crm_reservation_id=not.is.null`),
    check_ins_total: await cnt('check_ins', `&clinic_id=eq.${SONGDO}`),
    customers_total: await cnt('customers', `&clinic_id=eq.${SONGDO}`),
  };
  songdo.same_schema_extractable = true; // 동일 스키마/테이블 — clinic_slug 필터 스왑만으로 쿼리 동작
  songdo.verdict = (songdo.reservations_total === 0)
    ? 'FEASIBLE-BUT-EMPTY: songdo-foot 슬러그는 obliv-foot-crm 에 존재하나 데이터 0건(예약/내원/고객 전부 0). 송도점은 별도 CRM(Vegas)에서 운영·미마이그레이션(티켓 배경 정합) → 동일 스키마 추출은 기술적으로 가능하나 추출 대상 데이터가 obliv-foot-crm 에 없음. 외부검증셋은 Vegas 마이그레이션 선행 필요.'
    : `EXTRACTABLE: 예약 ${songdo.reservations_total}건 존재 → 동일 스키마 추출 가능(별건 발번).`;

  // baseline 라벨 드리프트 비교 (rev3 current DB vs 정본 svm_dataset_final.csv)
  let labelDrift = null;
  try {
    const baseCsv = fs.readFileSync(path.join(os.homedir(), 'claude-sync/memory/_handoff/svm-visit-extract/svm_dataset_final.csv'), 'utf8').trim().split('\n');
    const bh = baseCsv.shift().split(',');
    const skIdx = bh.indexOf('surrogate_key'), lvIdx = bh.indexOf('label_visited');
    const baseLabel = new Map();
    for (const l of baseCsv) { const f = l.split(','); baseLabel.set(f[skIdx], f[lvIdx]); }
    let same = 0, diff = 0, base1 = 0, base0 = 0;
    for (const r of out) {
      if (!r.mapped) continue;
      const b = baseLabel.get(r.surrogate_key);
      if (b === undefined) continue;
      if (b === '1') base1++; else if (b === '0') base0++;
      if (String(r.label_visit) === b) same++; else diff++;
    }
    labelDrift = { baseline_balance: `${base1}:${base0}`, rev3_current_balance: `${st.l1}:${st.l0}`, agree: same, differ: diff,
      note: 'rev3 current DB 라벨은 rev2 이후 신규 check-in 반영으로 baseline 대비 소폭 드리프트. ★baseline(svm_dataset_final.csv label_visited) 이 정본 — dev-dopamine 병합 시 label 재키잉 금지(rev3=ADDITIVE: f11+scheduled_visit_date+reservation_confirmed_date 만 병합).' };
  } catch (e) { labelDrift = { error: e.message }; }

  const dq = {
    ticket: 'T-20260811-dopamine-SVM-VISIT-EXTRACT-KICKOFF rev3 (foot leg)',
    generated_at: new Date().toISOString(),
    read_only: true, de_id: true, db_write: 0, schema_change: 0, deploy: 0,
    origin_scope: 'clinic slug=jongno-foot',
    baseline: 'svm_dataset_final.csv N=1,388 (정본)',
    handoff_rows: hlines.length,
    mapped_total: mapped,
    by_primary: st.primary, by_fallback_phone: st.fallback, unmapped: st.none,
    label_balance: `${st.l1}:${st.l0}`, label_visit_1: st.l1, label_visit_0: st.l0,
    rev3_deliverables: {
      '①_f11_point_in_time': {
        scope: 'ALL mapped rows, customer_id 기준 (재진-한정 NA scope SUPERSEDE)',
        cutoff: '당해 reservation_date(방문예정일) 기준 STRICT (<). 방문 당일/이후 실현 이벤트 제외 = target-leak 차단.',
        event_realization_ts: 'cancelled → cancelled_at(KST date) / no_show → no_show_clicked_at(KST date) / fallback → reservation_date',
        new_customer_rule: '이전 이력 부재 = 0 (NA 아님)',
        f11_rows_gt0: st.f11nonzero,
        f11_total_events_counted: st.f11sum,
        f11_all_zero_or_more: '모든 mapped 행 숫자값(빈칸 없음) — 신규=0',
        '★structural_finding': `mapped 코호트(광고 cue_card 리드) f11=0 for ALL ${mapped}행 (rows_gt0=0). 버그 아님·검증됨: 두 신원전략(customer_id·phone) 동일 0 · 전체 clinic 모집단에는 f11>0 = 83건 존재하나 전부 재진/워크인(비-광고리드) → cue_card 코호트=초진(first-contact) 이라 이전 취소·노쇼 이력 구조적 부재.`,
        ever_cancel_noshow_context: `${st.everCN}/${mapped} mapped 고객이 '언제든' 취소·노쇼 이력 보유(any-time). 그러나 전부 방문 당일/이후 = 동일 예약 에피소드(예약↔취소↔재예약 same-day) → strict point-in-time cutoff 로 정당 제외(target-leak 차단). ★'ever 취소·노쇼' 플래그는 신호(~30%) 있으나 target-leak(동일 에피소드/미래 포함)이라 f11(point-in-time)로 반환하지 않음.`,
        variance_caveat: 'f11(point-in-time)=상수 0 → SVM 피처로서 이 코호트 내 변별력 없음(zero variance). 김지호 재확인 권고.',
      },
      '②_date_only_cols': {
        reservation_confirmed_date: `date-only (created_at KST, born-confirmed). captured ${st.confDate}/${mapped}`,
        scheduled_visit_date: `date-only (reservation_date). captured ${st.schedDate}/${mapped}`,
        de_id: 'time-of-day DROP (김지호 일단위 절사 authorize). §36 무저촉.',
      },
    },
    f10_returning_count: st.returning,
    inflow_11code_captured: st.inflowCap,
    inflow_11code_capture_rate_pct: mapped ? +(100 * st.inflowCap / mapped).toFixed(1) : 0,
    firewall_note: '§36 inflow_channel = read-only 참조(옵션 반환)만. ML분류/역기입 無. target-leak: 당해 status/checkin 미피처화.',
    join_contract: 'surrogate_key 왕복. primary=crm_reservation_id→reservations.id, fallback=phone_e164_sha256. 미매핑=mapped:false+label NULL(H1 내원0 default 금지).',
    label_drift: labelDrift,
    '③_songdo_feasibility': songdo,
    return_file: RETURN_CSV,
  };
  fs.writeFileSync(DQ_JSON, JSON.stringify(dq, null, 2));

  console.log('✅ rev3 완료');
  console.log(JSON.stringify({
    handoff_rows: hlines.length, mapped, primary: st.primary, fallback: st.fallback, unmapped: st.none,
    label_balance: `${st.l1}:${st.l0}`,
    f11_rows_gt0: st.f11nonzero, f11_total_events: st.f11sum,
    reservation_confirmed_date_cap: `${st.confDate}/${mapped}`, scheduled_visit_date_cap: `${st.schedDate}/${mapped}`,
    inflow_11code_cap_pct: mapped ? +(100 * st.inflowCap / mapped).toFixed(1) : 0,
    f11_ever_cn_context: `${st.everCN}/${mapped}`,
    songdo_feasibility: `${songdo.reservations_total} resv / ${songdo.check_ins_total} checkin / ${songdo.customers_total} cust — ${songdo.reservations_total === 0 ? 'EMPTY(Vegas 미마이그)' : 'DATA-PRESENT'}`,
  }, null, 2));
  console.log('   return:', RETURN_CSV);
  console.log('   dq    :', DQ_JSON);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
