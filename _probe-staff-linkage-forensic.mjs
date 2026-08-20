// T-20260820-foot-STAFF-LINKAGE-CORRUPTION-RECURRENCE-GUARD — READ-ONLY prod forensic probe.
// 목적: 최현희 staff 행(9172beb7)이 왜 linkage 조건(user_id/active/deleted_at)을 이탈했는지
//       created_at/updated_at 타임라인 vs STAFF-DEACTIVATE-DELETE-SPLIT 배포(8/14~17) 교차대조.
//       SELECT-only. 데이터/스키마 변경 0. prod 무접촉(읽기).
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CHOI_STAFF_ID = '9172beb7';           // 최현희 staff.id prefix (parent RC)
const DEPLOY_WINDOW = ['2026-08-14', '2026-08-17']; // STAFF-DEACTIVATE-DELETE-SPLIT 배포창

async function main() {
  // 1) 최현희 staff 행 전체 컬럼 introspection (id uuid → 이름 매칭 + prefix 필터)
  const { data: allChoi, error: cErr } = await sb
    .from('staff')
    .select('*')
    .ilike('name', '%최현희%');
  if (cErr) { console.log('choi query error:', cErr.message); }
  const choi = (allChoi ?? []).filter(r => String(r.id).startsWith(CHOI_STAFF_ID) || true);
  console.log('=== 최현희 staff 행 (9172beb7) ===');
  for (const r of choi ?? []) {
    console.log(JSON.stringify({
      id: r.id, name: r.name, role: r.role, user_id: r.user_id,
      active: r.active, deleted_at: r.deleted_at,
      created_at: r.created_at, updated_at: r.updated_at, clinic_id: r.clinic_id,
    }, null, 2));
    // 타임라인 판정
    const created = r.created_at ? new Date(r.created_at) : null;
    const updated = r.updated_at ? new Date(r.updated_at) : null;
    if (created && updated) {
      const dtMs = updated.getTime() - created.getTime();
      const inWindow = (d) => d && d >= new Date(DEPLOY_WINDOW[0]) && d < new Date(DEPLOY_WINDOW[1] + 'T23:59:59');
      console.log('  → created_at:', created.toISOString());
      console.log('  → updated_at:', updated.toISOString());
      console.log('  → updated≈created (Δ<60s)?', Math.abs(dtMs) < 60000, `(Δ=${Math.round(dtMs/1000)}s)`);
      console.log('  → updated_at in 배포창(8/14~17)?', inWindow(updated));
      console.log('  → created_at BEFORE 배포창(8/14)?', created < new Date(DEPLOY_WINDOW[0]));
    }
  }

  // 2) staff 테이블 스키마: user_id/deleted_at 컬럼 존재 + 최현희 clinic 판별용
  //    (schema introspection via 1 row)
  const { data: sample } = await sb.from('staff').select('*').limit(1);
  console.log('\n=== staff 컬럼 목록 (schema introspection) ===');
  console.log(sample?.[0] ? Object.keys(sample[0]).join(', ') : '(no rows)');

  // 3) jongno-foot active staff 中 user_id NULL 전수 (census 연계 corroboration)
  //    clinic 판별
  const { data: clinics } = await sb.from('clinics').select('id, name, slug');
  console.log('\n=== all foot clinics ===');
  for (const c of clinics ?? []) console.log(`  ${c.id.slice(0,8)} ${c.slug} ${c.name}`);
  // jongno-foot = 74967aea (parent RC), fallback slug match
  const foot = clinics?.find(c => String(c.id).startsWith('74967aea'))
    ?? clinics?.find(c => /jongno.*foot|foot.*jongno|종로/i.test(`${c.slug} ${c.name}`))
    ?? clinics?.[0];
  console.log('=== selected clinic (jongno-foot) ===', foot?.id, foot?.slug, foot?.name);

  const { data: nullLink } = await sb
    .from('staff')
    .select('id, name, role, user_id, active, deleted_at, created_at, updated_at')
    .eq('clinic_id', foot.id)
    .eq('active', true)
    .is('deleted_at', null)
    .is('user_id', null);
  console.log('\n=== active(=true) & deleted_at NULL & user_id NULL 전수 ===');
  console.log('count:', (nullLink ?? []).length);
  for (const r of nullLink ?? []) {
    const created = r.created_at ? new Date(r.created_at).toISOString().slice(0,10) : '?';
    const updated = r.updated_at ? new Date(r.updated_at).toISOString().slice(0,10) : '?';
    console.log(`  ${r.role.padEnd(11)} ${(r.name||'').padEnd(10)} created=${created} updated=${updated} id=${r.id.slice(0,8)}`);
  }

  // 4) deleted_at NOT NULL (soft-deleted) 행 中 user_id 상태 — deactivate/delete가 user_id를 건드렸는지 검증
  const { data: softDel } = await sb
    .from('staff')
    .select('id, name, role, user_id, active, deleted_at')
    .eq('clinic_id', foot.id)
    .not('deleted_at', 'is', null);
  console.log('\n=== soft-deleted(deleted_at NOT NULL) 행: user_id 보존 여부 검증 ===');
  console.log('count:', (softDel ?? []).length);
  let userIdPreserved = 0, userIdNulled = 0;
  for (const r of softDel ?? []) {
    if (r.user_id) userIdPreserved++; else userIdNulled++;
  }
  console.log(`  user_id 보존(NOT NULL): ${userIdPreserved} · user_id NULL: ${userIdNulled}`);
  console.log('  → soft-delete가 user_id를 NULL로 만들었다면 userIdNulled가 나타남(단, 원래 NULL이었던 행 구분 불가 — 코드가 SSOT).');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
