/**
 * T-20260718-foot-NOSHOW-DONE-CONTRADICTION-TRIAGE — READ-ONLY census (prod)
 *
 * scope: reservations.status='no_show' ∧ 연결 check_in 실재
 *        ∧ check_in.status NOT IN ('cancelled','no_show')  (특히 done/treatment_waiting)
 *
 * PHI 위생(선행 티켓 C2 재발 방지): customer_name/phone 등 실명·연락처 컬럼을 SELECT 조차 하지 않는다.
 *   emit=UUID PK / status / 시각 뿐. 스크립트 어디에도 name/phone SELECT 없음.
 *
 * UPDATE 절대 없음 — 순수 SELECT census. freeze 스냅샷 JSON 산출.
 * 실행: node scripts/T-20260718-foot-NOSHOW-DONE-CONTRADICTION_census.mjs
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// ── env 로드 (.env.local: VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) ──
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
const URL = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('❌ env 부재 (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'); process.exit(1); }
const projectRef = URL.replace(/^https:\/\//, '').split('.')[0];
if (projectRef !== 'rxlomoozakkjesdqjtvd') { console.error(`❌ prod ref 불일치: ${projectRef}`); process.exit(1); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const SEED = '9f45105b'; // 반드시 census에 포함 확인 (reservation_id prefix)
const EXCLUDE = new Set(['cancelled', 'no_show']); // check_in.status 제외셋

// ── 페이지네이션 헬퍼 (실명 컬럼 미포함) ──
async function pagedSelect(table, cols, applyFilter) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(cols).range(from, from + PAGE - 1);
    q = applyFilter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} select: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// 1) reservations.status='no_show' — id/status/updated_at 만 (NO name/phone)
const noShowResv = await pagedSelect(
  'reservations',
  'id,status,updated_at',
  (q) => q.eq('status', 'no_show')
);
console.log(`reservations.status='no_show' 총 ${noShowResv.length}행`);

// 2) 연결 check_in 실재 — reservation_id IN (…) — id/reservation_id/status/updated_at/created_at/completed_at
const resvIds = noShowResv.map((r) => r.id);
const checkins = [];
const CHUNK = 300;
for (let i = 0; i < resvIds.length; i += CHUNK) {
  const chunk = resvIds.slice(i, i + CHUNK);
  // NOTE: prod check_ins 테이블에 updated_at 컬럼 부재(실측) — created_at/completed_at 을 시각 근거로 사용
  const { data, error } = await sb
    .from('check_ins')
    .select('id,reservation_id,status,created_at,completed_at')
    .in('reservation_id', chunk);
  if (error) throw new Error(`check_ins select: ${error.message}`);
  checkins.push(...data);
}
console.log(`연결 check_in 실재 ${checkins.length}행`);

// 3) fingerprint 매칭: check_in.status NOT IN (cancelled,no_show)
const resvById = new Map(noShowResv.map((r) => [r.id, r]));
const matched = checkins
  .filter((c) => !EXCLUDE.has(c.status))
  .map((c) => {
    const r = resvById.get(c.reservation_id);
    return {
      reservation_id: c.reservation_id,
      checkin_id: c.id,
      resv_status: r?.status ?? null,
      checkin_status: c.status,
      reservations_updated_at: r?.updated_at ?? null,
      checkin_updated_at: null, // prod check_ins.updated_at 컬럼 부재 — created_at/completed_at 참조
      checkin_created_at: c.created_at ?? null,
      checkin_completed_at: c.completed_at ?? null,
      // override 흔적 판정 힌트: check_in이 resv.updated_at보다 먼저 만들어졌으면 resv가 나중에 no_show로 flip
      override_hint:
        r?.updated_at && c.created_at
          ? (new Date(c.created_at) < new Date(r.updated_at) ? 'resv_flipped_after_checkin' : 'resv_updated_before_checkin')
          : 'unknown',
    };
  })
  .sort((a, b) => (a.reservations_updated_at || '').localeCompare(b.reservations_updated_at || ''));

// 분포 집계
const dist = {};
for (const m of matched) dist[m.checkin_status] = (dist[m.checkin_status] || 0) + 1;

const seedIncluded = matched.some((m) => m.reservation_id.startsWith(SEED));

const snapshot = {
  ticket: 'T-20260718-foot-NOSHOW-DONE-CONTRADICTION-TRIAGE',
  generated_note: "READ-ONLY census — divergence class 규모 산출. UPDATE 없음. PHI(name/phone) SELECT·emit 없음.",
  db: { project_ref: projectRef, env: 'prod' },
  fingerprint: "reservations.status='no_show' ∧ check_in 실재 ∧ check_in.status NOT IN ('cancelled','no_show')",
  schema_note: "prod check_ins 테이블에 updated_at 컬럼 부재(실측) → checkin_updated_at=null. check_in 시각 근거는 created_at/completed_at.",
  totals: {
    reservations_no_show: noShowResv.length,
    checkins_linked_to_no_show_resv: checkins.length,
    matched_diverged: matched.length,
  },
  checkin_status_dist: dist,
  seed_9f45105b_included: seedIncluded,
  rows: matched,
};

const outPath = process.env.HOME + '/claude-sync/memory/_handoff/backfill_artifacts/T-20260718-foot-NOSHOW-DONE-CONTRADICTION_census.json';
fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
console.log(`\n✅ matched(diverged)=${matched.length}  seed(${SEED}) 포함=${seedIncluded}`);
console.log(`   checkin_status_dist=${JSON.stringify(dist)}`);
console.log(`   freeze → ${outPath}`);
