/**
 * T-20260630-foot-STAFF-AUTH-LINK-BACKFILL — APPLY DRY-RUN (READ-ONLY, prod write 0)
 *
 * 게이트 해소: 김주연 총괄 현장확인 수신(thread 1782859741.988249, "맞아") → human_pending 해소.
 * DA CONSULT(AC-2) ✅ 부분-GO. 본 스크립트 = supervisor DB 게이트 진입 직전 최종 dry-run.
 *
 * 대상 = targeted 단건 2건만 (룰 일괄 금지):
 *   1) 박민석  staff fd54a977-d203-44f6-91cb-0f1fce47dd97 (coordinator) → user_profiles dad7dc00-dc99-41af-b5fc-42aa77a0bd9b
 *   2) 문지은  staff b46abc6d-4a24-4776-b807-751b62f60fe3 (director)    → user_profiles d343769a-493a-49c9-b718-4c92c6f5db9a
 *
 * 검증 (write 0):
 *   A. WHERE 삼중가드 (id IN(2) + user_id IS NULL + role) 매칭 행수 == 기대 2
 *   B. 제안 user_profiles.id 가 이미 다른 staff.user_id 로 점유되지 않음 (cross-contamination 0)
 *   C. 제안 user_profiles row 가 실존 + name/role/clinic 정합
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
const URL = envFromLocal('VITE_SUPABASE_URL');
const SRK = envFromLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !SRK) { console.error('❌ missing URL/SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const PAIRS = [
  { name: '박민석', staff_id: 'fd54a977-d203-44f6-91cb-0f1fce47dd97', role: 'coordinator', user_id: 'dad7dc00-dc99-41af-b5fc-42aa77a0bd9b' },
  { name: '문지은', staff_id: 'b46abc6d-4a24-4776-b807-751b62f60fe3', role: 'director',    user_id: 'd343769a-493a-49c9-b718-4c92c6f5db9a' },
];

let fail = 0;
const note = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) fail++; };

(async () => {
  console.log('=== T-20260630-foot-STAFF-AUTH-LINK-BACKFILL — APPLY DRY-RUN (read-only) ===\n');

  // A. WHERE 삼중가드 매칭 — 대상 staff 현재 상태
  const staffIds = PAIRS.map(p => p.staff_id);
  const { data: staffRows, error: e1 } = await db
    .from('staff')
    .select('id, name, role, active, user_id, clinic_id')
    .in('id', staffIds);
  if (e1) { console.error('staff query error', e1); process.exit(1); }

  console.log('--- A. 대상 staff 현재 상태 ---');
  let guardMatch = 0;
  for (const p of PAIRS) {
    const r = staffRows.find(s => s.id === p.staff_id);
    if (!r) { note(false, `${p.name} staff_id ${p.staff_id} 미존재`); continue; }
    const guardOk = r.user_id === null && r.role === p.role && r.active === true;
    if (guardOk) guardMatch++;
    note(guardOk, `${p.name} (${r.role}, active=${r.active}, user_id=${r.user_id ?? 'NULL'}) — 삼중가드 ${guardOk ? 'PASS' : 'FAIL'}`);
  }
  note(guardMatch === 2, `기대행수 COUNT == 2  (실측 ${guardMatch})`);

  // B. cross-contamination — 제안 user_id 가 이미 다른 staff 에 점유?
  console.log('\n--- B. cross-contamination 검사 (제안 user_id 점유 여부) ---');
  const proposedUserIds = PAIRS.map(p => p.user_id);
  const { data: occ, error: e2 } = await db
    .from('staff')
    .select('id, name, role, user_id')
    .in('user_id', proposedUserIds);
  if (e2) { console.error('occupancy query error', e2); process.exit(1); }
  for (const p of PAIRS) {
    const holders = (occ || []).filter(s => s.user_id === p.user_id && s.id !== p.staff_id);
    note(holders.length === 0, `${p.name} 제안 user_id ${p.user_id.slice(0,8)}… 점유 staff ${holders.length}건 (0이어야 함)` + (holders.length ? ` → ${JSON.stringify(holders)}` : ''));
  }

  // C. 제안 user_profiles 실존 + 정합
  console.log('\n--- C. 제안 user_profiles 정합 ---');
  const { data: profs, error: e3 } = await db
    .from('user_profiles')
    .select('id, name, role, clinic_id')
    .in('id', proposedUserIds);
  if (e3) { console.error('user_profiles query error', e3); process.exit(1); }
  for (const p of PAIRS) {
    const pr = (profs || []).find(x => x.id === p.user_id);
    const sr = staffRows.find(s => s.id === p.staff_id);
    if (!pr) { note(false, `${p.name} user_profiles ${p.user_id} 미존재`); continue; }
    const nameOk = String(pr.name || '').replace(/\s/g,'') === p.name;
    const clinicOk = !sr || pr.clinic_id === sr.clinic_id;
    note(nameOk, `${p.name} user_profiles.name 일치 (=${pr.name})`);
    note(clinicOk, `${p.name} clinic_id 정합 (profiles=${pr.clinic_id})`);
  }

  console.log(`\n=== RESULT: ${fail === 0 ? 'ALL PASS — supervisor DB 게이트 진입 가능' : fail + '건 FAIL — apply 보류'} ===`);
  process.exit(fail === 0 ? 0 : 2);
})();
