/**
 * T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT — READ-SIDE LIVE DIAGNOSTIC (READ-ONLY, NO WRITE)
 *
 * 목적(verify-first §963⑩(a)): foot TmAggregateSection 이 registrar_name 을
 *   (1) TM집계 grouping key, (2) "TM팀만" 필터 inclusion 판정축 으로 read 하는지
 *   소스뿐 아니라 LIVE 실측으로 확정한다. *** SELECT 만. write 없음. ***
 *
 * 판정:
 *   - registrar_name 이 grouping key 로 실제 병합에 기여하는 행 수
 *     = created_by NULL/미매칭 AND registrar_name 비어있지 않음.
 *   - registrar_name 이 "TM팀만" inclusion 을 실제로 좌우하는 케이스
 *     = 위 행 중 registrar_name ∈ {role='tm' 직원명}.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const DAYS = 60;
const to = new Date();
const from = new Date(to.getTime() - DAYS * 86400000);
const fromISO = from.toISOString();

const out = {};

// 1) active staff map (id -> {name, role})
const { data: staff, error: e1 } = await sb
  .from('user_profiles')
  .select('id, name, role')
  .eq('active', true);
if (e1) throw e1;
const staffById = new Map();
const tmNames = new Set();
for (const s of staff ?? []) {
  staffById.set(s.id, { name: s.name ?? '', role: s.role ?? '' });
  if (s.role === 'tm' && s.name) tmNames.add(s.name);
}
out.active_staff = staff?.length ?? 0;
out.tm_role_names = Array.from(tmNames);

// 2) recent reservations (created_at window ~ 예약등록건수 lane)
let all = [];
let offset = 0;
for (let p = 0; p < 30; p++) {
  const { data, error } = await sb
    .from('reservations')
    .select('id, created_by, source_system, registrar_name, created_at')
    .gte('created_at', fromISO)
    .range(offset, offset + 999);
  if (error) throw error;
  all.push(...(data ?? []));
  if ((data?.length ?? 0) < 1000) break;
  offset += 1000;
}
out.window_days = DAYS;
out.reservations_scanned = all.length;

const norm = (v) => (v ?? '').trim();
let createdByResolved = 0;
let createdByNullOrUnmatched = 0;
let regnameDrivesGrouping = 0; // created_by 미해소 AND registrar_name 존재 → 현재 grouping key = registrar_name
let regnameDrivesTmFilter = 0; // 위 중 registrar_name ∈ tmNames → "TM팀만" inclusion 을 registrar_name 이 좌우
let dopamineWithRegname = 0;
let dopamineTotal = 0;
const regnameBuckets = new Map();

for (const r of all) {
  const cb = norm(r.created_by);
  const staffName = cb ? staffById.get(r.created_by)?.name : undefined;
  const resolved = !!(cb && staffName);
  if (resolved) createdByResolved++;
  else createdByNullOrUnmatched++;

  const rn = norm(r.registrar_name);
  if (norm(r.source_system) === 'dopamine') {
    dopamineTotal++;
    if (rn) dopamineWithRegname++;
  }
  if (!resolved && rn) {
    regnameDrivesGrouping++;
    regnameBuckets.set(rn, (regnameBuckets.get(rn) ?? 0) + 1);
    if (tmNames.has(rn)) regnameDrivesTmFilter++;
  }
}

out.created_by_resolved = createdByResolved;
out.created_by_null_or_unmatched = createdByNullOrUnmatched;
out.regname_drives_grouping = regnameDrivesGrouping;
out.regname_drives_tmfilter = regnameDrivesTmFilter;
out.dopamine_total = dopamineTotal;
out.dopamine_with_regname = dopamineWithRegname;
out.regname_grouping_buckets = Object.fromEntries(
  Array.from(regnameBuckets.entries()).sort((a, b) => b[1] - a[1]),
);

console.log(JSON.stringify(out, null, 2));
