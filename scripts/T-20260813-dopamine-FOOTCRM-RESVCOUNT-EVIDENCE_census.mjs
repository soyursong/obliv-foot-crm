/**
 * T-20260813-dopamine-FOOTCRM-RESVCOUNT-EVIDENCE-0813 — 풋CRM TM집계 authoritative census (READ-ONLY)
 *
 * 목적: 도파민 TM통계 '예약수+내원수' 08-01~08-12 divergence 진단 협조.
 *   풋CRM 통계>TM집계 탭(TmAggregateSection)의 산식을 1:1 복제해 상담사별 authoritative 숫자 산출.
 *   write 0 · DDL 0 · SELECT만.
 *
 * 산식 SSOT = src/lib/stats.ts fetchTmAggregate + tmAttributionKey (라인 인용은 회신에 첨부):
 *   예약수(scheduled)  = reservations, reservation_date ∈ [from,to], 취소 포함(status 필터 없음)
 *   내원건수(visited)  = check_ins, created_date ∈ [from,to], deleted_at IS NULL, status != 'cancelled',
 *                         reservation_id 기준 dedup(done 우선), 워크인(reservation_id 없음) 유지
 *   예약등록(registered)= reservations, created_at ∈ [from,to] (KST +09:00 경계)
 *   WHO 귀속(tmAttributionKey):
 *     created_by 有 → staff:{uid} (직원명)
 *     created_by NULL + source_system='dopamine' + registrar_name 有 → dop:{registrar_name}
 *     created_by NULL + dopamine + registrar_name NULL → __dopamine__ ('도파민 등록')
 *     그 외 → __unassigned__ ('미지정')
 *   내원 귀속 = 매칭 예약(reservation_id, registered∪scheduled)의 attribution. 미매칭 → 워크인.
 *   ※ 기본 화면 = onlyMine=false, onlyTmRole=false (전 버킷 표시).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FROM = '2026-08-01';
const TO = '2026-08-12';
const p = (...a) => console.log(...a);

const PAGE = 1000;
async function fetchAll(build) {
  const all = [];
  let off = 0;
  for (let i = 0; i < 40; i++) {
    const { data, error } = await build(off);
    if (error) { p('ERR', JSON.stringify(error)); throw error; }
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
    off += PAGE;
  }
  return all;
}

// tmAttributionKey 복제
function attrKey(created_by, source_system, staffName, registrar_name) {
  if (created_by) return { key: `staff:${created_by}`, label: (staffName ?? '').trim() || '미지정' };
  if ((source_system ?? '').trim() === 'dopamine') {
    const rn = (registrar_name ?? '').trim();
    if (rn) return { key: `dop:${rn}`, label: rn };
    return { key: '__dopamine__', label: '도파민 등록' };
  }
  return { key: '__unassigned__', label: '미지정' };
}

// dedupVisited 복제 (done 우선, 워크인 유지)
function dedupVisited(rows) {
  const resMap = new Map();
  const walkIns = [];
  for (const r of rows) {
    if (!r.reservation_id) walkIns.push(r);
    else {
      const ex = resMap.get(r.reservation_id);
      if (!ex || r.status === 'done') resMap.set(r.reservation_id, r);
    }
  }
  return [...resMap.values(), ...walkIns];
}

async function main() {
  const { data: clinics } = await sb.from('clinics').select('id, name, slug');
  p('=== clinics ===', JSON.stringify(clinics));
  // 풋 종로점 clinic_id — 단일 clinic 이면 그것, 아니면 이름/slug로 탐색
  let clinicId = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 서울오리진점(jongno-foot)
  p('clinicId =', clinicId);

  const resSel = 'id, reservation_date, created_at, created_by, status, source_system, registrar_name';

  // A: 예약등록 (created_at KST 경계)
  const registered = await fetchAll((off) => sb.from('reservations').select(resSel)
    .eq('clinic_id', clinicId)
    .gte('created_at', `${FROM}T00:00:00+09:00`).lte('created_at', `${TO}T23:59:59+09:00`)
    .range(off, off + PAGE - 1));
  // B: 예약수 (reservation_date, 취소 포함)
  const scheduled = await fetchAll((off) => sb.from('reservations').select(resSel)
    .eq('clinic_id', clinicId)
    .gte('reservation_date', FROM).lte('reservation_date', TO)
    .range(off, off + PAGE - 1));
  // C: 내원 (created_date, deleted_at null, cancelled 제외)
  const visitedRaw = await fetchAll((off) => sb.from('check_ins')
    .select('id, reservation_id, created_date, checked_in_at, status')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null).neq('status', 'cancelled')
    .gte('created_date', FROM).lte('created_date', TO)
    .range(off, off + PAGE - 1));
  const visited = dedupVisited(visitedRaw);

  // staffMap (user_profiles active)
  const { data: staffRows } = await sb.from('user_profiles').select('id, name, role').eq('active', true);
  const staffMap = {};
  for (const s of staffRows ?? []) staffMap[s.id] = { name: s.name ?? '', role: s.role ?? '' };

  const allResMap = new Map();
  [...registered, ...scheduled].forEach((r) => allResMap.set(r.id, r));

  const attrOfRes = (r) => attrKey(r.created_by, r.source_system, staffMap[r.created_by ?? '']?.name, r.registrar_name);
  const attrOfCI = (ci) => {
    const m = ci.reservation_id ? allResMap.get(ci.reservation_id) : undefined;
    if (!m) return { key: '__walkin__', label: '워크인' };
    return attrOfRes(m);
  };

  const map = new Map();
  const ensure = (key, label) => { if (!map.has(key)) map.set(key, { tm: label, registered: 0, scheduled: 0, visited: 0 }); return map.get(key); };
  registered.forEach((r) => { const a = attrOfRes(r); ensure(a.key, a.label).registered += 1; });
  scheduled.forEach((r) => { const a = attrOfRes(r); ensure(a.key, a.label).scheduled += 1; });
  visited.forEach((ci) => { const a = attrOfCI(ci); ensure(a.key, a.label).visited += 1; });

  const rows = Array.from(map.entries()).map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.scheduled - a.scheduled);

  p('\n=== raw counts ===');
  p(`reservations(reservation_date window)=${scheduled.length}  registered(created_at)=${registered.length}  check_ins raw=${visitedRaw.length}  visited(dedup)=${visited.length}`);

  p('\n=== TM집계 (상담사별) — 기본화면(전 버킷) ===');
  p('bucket_key\tlabel\t예약등록\t예약수\t내원건수\t내원율');
  for (const r of rows) {
    const rate = r.scheduled > 0 ? (r.visited / r.scheduled * 100).toFixed(1) : '0.0';
    p(`${r.key}\t${r.tm}\t${r.registered}\t${r.scheduled}\t${r.visited}\t${rate}%`);
  }
  const T = rows.reduce((a, r) => ({ registered: a.registered + r.registered, scheduled: a.scheduled + r.scheduled, visited: a.visited + r.visited }), { registered: 0, scheduled: 0, visited: 0 });
  p(`합계\t\t${T.registered}\t${T.scheduled}\t${T.visited}`);

  // 도파민 대조값
  const dop = { '이수빈': [166, 100], '김효신': [157, 104], '진운선': [140, 83], '강솔희': [103, 61] };
  p('\n=== Δ(도파민 − 풋) 상담사별 ===');
  p('상담사\t도파민예약\t풋예약수\tΔ예약\t도파민내원\t풋내원\tΔ내원');
  for (const [name, [dRes, dVis]] of Object.entries(dop)) {
    const r = rows.find((x) => x.tm === name);
    const fRes = r?.scheduled ?? 0, fVis = r?.visited ?? 0;
    p(`${name}\t${dRes}\t${fRes}\t${dRes - fRes}\t${dVis}\t${fVis}\t${dVis - fVis}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
