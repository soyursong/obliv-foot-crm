/**
 * T-20260716-foot-NOSHOW-CHECKIN-STATUS-DIVERGENCE-BACKFILL — 대상셋 census (READ-ONLY)
 *
 * ⚠️ READ-ONLY — SELECT 만. UPDATE/DELETE/ALTER 0. 백필 scope 산출 전용.
 *    (실제 정정 UPDATE 는 DA CONSULT GO + supervisor DB 게이트 후 별도 스크립트)
 *
 * 목적: 트리거 fn_checkin_sync_reservation() 과협소(status='confirmed' 정확일치) 버그로
 *   check_in 은 실재하는데 reservations.status 가 'confirmed' 에 머문 divergence 잔존행을
 *   버그경로 지문 교집합으로 전수 census. + 정정 방향(checked_in vs done) 분포 산출.
 *
 * 버그경로 지문(교집합):
 *   ① reservations.status = 'confirmed'
 *   ② 연결 check_in 실재 (check_ins.reservation_id = reservations.id)
 *   ③ check_in.status 비cancelled·비no_show (= BEFORE 가드 통과분)
 *   → 트리거가 sync 성공했다면 status='checked_in'/'done' 이었어야 함.
 *
 * 정정 방향 규칙(★ 스키마 실측 반영):
 *   reservations.status 도메인 = {confirmed, checked_in, no_show, cancelled} — 'done' 값 없음(0/575).
 *   시술완료(done)는 check_ins.status 에만 존재하고 reservations 의 terminal 은 'checked_in'.
 *   ⇒ 트리거가 정상 sync 했다면 check_in 진행단계 무관 항상 'checked_in' 착지.
 *   ⇒ 정정 방향: 전 대상행 → reservations.status='checked_in' (분기 없음).
 *      check_in.status(done/treatment_waiting 등)는 그대로 보존 — 시술완료 정보 무손실.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// .env.local 파싱 (dotenv 없이 최소)
const env = {};
try {
  for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const URL = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요'); process.exit(1); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const EXCLUDE_CHECKIN = new Set(['cancelled', 'canceled', 'no_show']);
// reservations.status 도메인에 'done' 없음(실측 0/575) → 전 대상 checked_in 수렴.
const CORRECTION_TARGET = 'checked_in';

async function main() {
  // ② check_in 실재 (reservation_id NOT NULL) — 전 check_ins 조회 후 조인 (테이블 규모 작음)
  const { data: checkins, error: e1 } = await sb
    .from('check_ins')
    .select('id, reservation_id, status, created_at, customer_id')
    .not('reservation_id', 'is', null);
  if (e1) { console.error('check_ins query error:', e1.message); process.exit(1); }

  // reservation_id → 최신 check_in (비cancelled 우선)
  const byResv = new Map();
  for (const c of checkins) {
    if (EXCLUDE_CHECKIN.has((c.status || '').toLowerCase())) continue; // ③ 비cancelled/no_show
    const prev = byResv.get(c.reservation_id);
    if (!prev || (c.created_at || '') > (prev.created_at || '')) byResv.set(c.reservation_id, c);
  }

  const resvIds = [...byResv.keys()];
  // ① reservations.status='confirmed' 인 것만 (버그경로 지문 교집합)
  const diverged = [];
  const CHUNK = 200;
  for (let i = 0; i < resvIds.length; i += CHUNK) {
    const slice = resvIds.slice(i, i + CHUNK);
    const { data: resvs, error: e2 } = await sb
      .from('reservations')
      // §4 PHI 위생: customer_name(실명) 미조회 — 정정·감사는 UUID PK로 충분.
      .select('id, status, reservation_date, reservation_time, customer_id, created_at, updated_at')
      .in('id', slice)
      .eq('status', 'confirmed');
    if (e2) { console.error('reservations query error:', e2.message); process.exit(1); }
    for (const r of resvs) {
      const ci = byResv.get(r.id);
      const target = CORRECTION_TARGET;
      diverged.push({
        reservation_id: r.id,
        reservation_date: r.reservation_date,
        reservation_time: r.reservation_time,
        resv_status: r.status,
        checkin_id: ci.id,
        checkin_status: ci.status,
        checkin_created_at: ci.created_at,
        correction_target: target,
      });
    }
  }

  diverged.sort((a, b) => (a.checkin_created_at || '').localeCompare(b.checkin_created_at || ''));

  const dist = diverged.reduce((acc, d) => { acc[d.correction_target] = (acc[d.correction_target] || 0) + 1; return acc; }, {});
  const ciDist = diverged.reduce((acc, d) => { acc[d.checkin_status] = (acc[d.checkin_status] || 0) + 1; return acc; }, {});

  const report = {
    ticket: 'T-20260716-foot-NOSHOW-CHECKIN-STATUS-DIVERGENCE-BACKFILL',
    generated_note: 'READ-ONLY census — 백필 scope 산출. 실제 UPDATE 아님.',
    fingerprint: "reservations.status='confirmed' ∧ check_in 실재 ∧ check_in.status NOT IN (cancelled,no_show)",
    correction_rule: {
      target: "전 대상행 → reservations.status='checked_in'",
      rationale: "reservations.status 도메인에 'done' 없음(실측 0/575) — terminal='checked_in'. 시술완료는 check_ins.status 보존.",
    },
    total_diverged: diverged.length,
    total_checkins_with_resv: checkins.length,
    correction_target_dist: dist,
    checkin_status_dist: ciDist,
    rows: diverged,
  };

  const OUT = join(__dirname, 'out');
  mkdirSync(OUT, { recursive: true });
  const base = join(OUT, 'T-20260716-NOSHOW-DIVERGENCE_census');
  writeFileSync(base + '.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ total_diverged: report.total_diverged, correction_target_dist: dist, checkin_status_dist: ciDist }, null, 2));
  console.log('\n--- rows ---');
  for (const d of diverged) {
    console.log(`${d.reservation_date} ${d.reservation_time || ''} | resv=${d.reservation_id.slice(0,8)} status=${d.resv_status} | checkin=${(d.checkin_id||'').slice(0,8)}/${d.checkin_status} → 정정:${d.correction_target}`);
  }
  console.log('\nsaved:', base + '.json');
}
main().catch(e => { console.error(e); process.exit(1); });
