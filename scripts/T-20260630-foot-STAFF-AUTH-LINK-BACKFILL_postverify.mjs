/**
 * T-20260630-foot-STAFF-AUTH-LINK-BACKFILL — AC-4 사후검증 (apply COMMIT 후 실행)
 * (a) 대상 2건 user_id 적재 회복 (created_by attribution 경로 회복)
 * (b) 타 신원 cross-contamination 0 (다른 staff/user_profiles 귀속 무회귀)
 * READ-ONLY. supervisor apply COMMIT 후에만 의미 있음.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim();
    }
  }
  return null;
}
const db = createClient(envFromLocal('VITE_SUPABASE_URL'), envFromLocal('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const PAIRS = [
  { name: '박민석', staff_id: 'fd54a977-d203-44f6-91cb-0f1fce47dd97', user_id: 'dad7dc00-dc99-41af-b5fc-42aa77a0bd9b' },
  { name: '문지은', staff_id: 'b46abc6d-4a24-4776-b807-751b62f60fe3', user_id: 'd343769a-493a-49c9-b718-4c92c6f5db9a' },
];
let fail = 0; const note = (ok, m) => { console.log(`${ok ? '✅' : '❌'} ${m}`); if (!ok) fail++; };

(async () => {
  console.log('=== AC-4 POST-VERIFY (apply 후) ===\n');
  // (a) 대상 2건 적재 회복
  const { data: rows } = await db.from('staff').select('id, name, role, user_id').in('id', PAIRS.map(p => p.staff_id));
  for (const p of PAIRS) {
    const r = (rows || []).find(s => s.id === p.staff_id);
    note(r && r.user_id === p.user_id, `${p.name} user_id == ${p.user_id.slice(0,8)}… (실측 ${r?.user_id ?? 'NULL'})`);
  }
  // (b) cross-contamination 0 — 채운 user_id 가 단일 staff 에만
  const { data: holders } = await db.from('staff').select('id, name, user_id').in('user_id', PAIRS.map(p => p.user_id));
  for (const p of PAIRS) {
    const h = (holders || []).filter(s => s.user_id === p.user_id);
    note(h.length === 1 && h[0].id === p.staff_id, `${p.name} user_id 점유 staff == 1 & 본인 (실측 ${h.length}건)`);
  }
  // 전체 1:1 불변식 (채운 값 범위에서 중복 0)
  const dup = (holders || []).reduce((a, s) => (a[s.user_id] = (a[s.user_id] || 0) + 1, a), {});
  note(Object.values(dup).every(v => v === 1), `1:1 무중복 불변식 유지`);
  console.log(`\n=== ${fail === 0 ? 'AC-4 ALL PASS' : fail + '건 FAIL'} ===`);
  process.exit(fail === 0 ? 0 : 2);
})();
