/**
 * T-20260818-foot-CREATEDVIA-NULL-ORIGIN-CENSUS — created_via NULL 발생경로 census (READ-ONLY, SELECT만, write 0·db_change 0)
 *
 * 부모 T-20260816-foot-JONGNO-OPHOURS-WRITEGATE Phase1: reservations.created_via NULL=200건(8%)·oow 9% 확인·출처 미상.
 * 목적: NULL 행의 특성(시각대·요일·재진/신규·source_system·external_id·created_at 시계열) 집계 +
 *       created_via 컬럼 도입(2026-06-28 migration 20260628160000) 대비 pre/post 분해로 발생경로 규명.
 *
 * 판별 discriminator:
 *   - source_system='dopamine' + external_id NOT NULL  → 도파민 인입(EF/RPC) 경로 유래
 *   - source_system NULL                                → FE 수기(manual) 경로 유래
 *   - created_at < 2026-06-28 (컬럼 도입일)             → pre-migration 미수집(backfill 별건) = 영속 NULL
 *   - created_at >= 2026-06-28                          → post-migration 인데도 NULL = 미세팅 코드경로 존재 신호
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const p = (...a) => console.log(...a);
const MIG_DATE = '2026-06-28'; // created_via 컬럼 도입 migration 20260628160000

async function main() {
  p('=== SUPABASE_URL ===', env.VITE_SUPABASE_URL);

  // 0) clinics
  const { data: clinics } = await sb.from('clinics').select('id, name, slug');
  p('=== clinics ===', JSON.stringify(clinics));

  // helper: 전량 페이지네이션 (PostgREST 1000행 캡 회피)
  async function fetchAll(build) {
    const out = []; const PAGE = 1000; let from = 0;
    for (;;) {
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return out;
  }

  // 1) created_via 전체 분포 (parent census 재현·정합 확인) — clinic 별 count(head) 로 정확 집계
  p('\n=== [1] created_via 전체 분포 (전량 페이지네이션) ===');
  const allRows = await fetchAll(() => sb
    .from('reservations')
    .select('id, created_via, source_system, external_id, visit_type, reservation_date, reservation_time, created_at, clinic_id, status'));
  p('total reservations rows:', allRows.length);
  const dist = {}; const distByClinic = {};
  const clinicName = Object.fromEntries((clinics || []).map((c) => [c.id, c.slug]));
  for (const r of allRows) {
    const k = r.created_via ?? 'NULL'; dist[k] = (dist[k] || 0) + 1;
    const cs = clinicName[r.clinic_id] || r.clinic_id;
    distByClinic[cs] = distByClinic[cs] || {}; distByClinic[cs][k] = (distByClinic[cs][k] || 0) + 1;
  }
  p('created_via 분포(전체):', JSON.stringify(dist, null, 2));
  p('created_via 분포(clinic별):', JSON.stringify(distByClinic, null, 2));

  // 2) NULL 행만 추출 후 특성 집계
  const nulls = allRows.filter((r) => r.created_via == null);
  p(`\n=== [2] created_via IS NULL 행 특성 (n=${nulls.length}) ===`);

  // 2a) source_system 분해 (도파민 유래 vs 수기 유래)
  const bySrc = {};
  for (const r of nulls) { const k = r.source_system ?? 'NULL(수기추정)'; bySrc[k] = (bySrc[k] || 0) + 1; }
  p('[2a] source_system 분해:', JSON.stringify(bySrc, null, 2));

  // 2b) external_id 유무 (도파민 인입=external_id NOT NULL)
  const extPresent = nulls.filter((r) => r.external_id != null).length;
  p('[2b] external_id NOT NULL(도파민/외부 인입 유래):', extPresent, '/', nulls.length,
    ' | external_id NULL(수기 유래):', nulls.length - extPresent);

  // 2c) created_at pre/post migration 분해 (핵심 discriminator)
  const preMig = nulls.filter((r) => r.created_at && r.created_at < MIG_DATE).length;
  const postMig = nulls.filter((r) => r.created_at && r.created_at >= MIG_DATE).length;
  const noCreatedAt = nulls.filter((r) => !r.created_at).length;
  p(`[2c] created_at 기준 (컬럼도입 ${MIG_DATE}): pre-migration=${preMig} (미수집·영속NULL) | post-migration=${postMig} (★코드경로 미세팅 신호) | created_at없음=${noCreatedAt}`);

  // 2d) post-migration NULL 을 source_system 으로 재분해 (어느 경로가 여전히 NULL?)
  const postRows = nulls.filter((r) => r.created_at && r.created_at >= MIG_DATE);
  const postBySrc = {};
  for (const r of postRows) { const k = r.source_system ?? 'NULL(수기)'; postBySrc[k] = (postBySrc[k] || 0) + 1; }
  p('[2d] post-migration NULL 의 source_system 분해:', JSON.stringify(postBySrc, null, 2));
  // post-migration NULL 샘플 20건 (역추적용)
  p('[2d-샘플] post-migration NULL 최근 20건:');
  postRows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  for (const r of postRows.slice(0, 20)) {
    p(`   created_at=${r.created_at} date=${r.reservation_date} time=${r.reservation_time} src=${r.source_system ?? '-'} ext=${r.external_id ?? '-'} visit=${r.visit_type ?? '-'} status=${r.status ?? '-'}`);
  }

  // 2e) 시각대(예약시간) 분포
  const byHour = {};
  for (const r of nulls) {
    const t = (r.reservation_time || '').substring(0, 2);
    const k = t ? `${t}시` : 'NULL';
    byHour[k] = (byHour[k] || 0) + 1;
  }
  p('[2e] 예약시각(시간대) 분포:', JSON.stringify(byHour, null, 2));

  // 2f) 요일 분포 (reservation_date 기준)
  const dow = ['일', '월', '화', '수', '목', '금', '토'];
  const byDow = {};
  for (const r of nulls) {
    if (!r.reservation_date) { byDow['NULL'] = (byDow['NULL'] || 0) + 1; continue; }
    const d = new Date(r.reservation_date + 'T00:00:00+09:00');
    const k = dow[d.getUTCDay()] || '?';
    byDow[k] = (byDow[k] || 0) + 1;
  }
  p('[2f] 예약요일 분포:', JSON.stringify(byDow, null, 2));

  // 2g) 재진/신규 분포
  const byVisit = {};
  for (const r of nulls) { const k = r.visit_type ?? 'NULL'; byVisit[k] = (byVisit[k] || 0) + 1; }
  p('[2g] visit_type(신규/재진) 분포:', JSON.stringify(byVisit, null, 2));

  // 2h) created_at 월별 시계열 (NULL 발생이 특정 시기에 몰리는지)
  const byMonth = {};
  for (const r of nulls) { const k = (r.created_at || 'NULL').substring(0, 7); byMonth[k] = (byMonth[k] || 0) + 1; }
  p('[2h] created_at 월별 NULL 발생:', JSON.stringify(byMonth, null, 2));

  p('\n=== CENSUS DONE (READ-ONLY, write 0) ===');
}
main().catch((e) => { console.error(e); process.exit(1); });
