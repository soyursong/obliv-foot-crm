/**
 * T-20260701-foot-STAFF-ROSTER-DEDUP — APPLY RESOLVE (READ-ONLY, prod write 0)
 *
 * AC-3 현장 confirm(2026-07-02T16:44 김주연 총괄) + #6 reconcile(BOTH필수) 반영.
 * confirm 은 canonical 을 **이메일**로 지정 → 본 스크립트가 email → staff.id 로 read-only 바인딩하여
 * supervisor DB 게이트 입력(DUP 폐기 id / CANON 정본 id / 재귀속 기대행수)을 산출.
 *
 * 안전(§3.1 면제 아님 — PHI 귀속 경로):
 *  - 오직 SELECT / head-count (service_role REST). UPDATE/INSERT/DELETE **없음**. prod write 0.
 *  - 바인딩·집행은 supervisor DB 게이트. 본 스크립트는 "gate 입력값 resolve"만.
 *  - staff.user_id → user_profiles.id, email 은 user_profiles.email.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function env(k){ if(process.env[k])return process.env[k]; for(const f of ['.env.local','.env']){ if(!fs.existsSync(f))continue; for(const l of fs.readFileSync(f,'utf8').split('\n')){ const m=l.match(new RegExp(`^${k}=(.*)$`)); if(m)return m[1].trim(); } } return null; }
const URL=env('VITE_SUPABASE_URL'), SRK=env('SUPABASE_SERVICE_ROLE_KEY');
if(!URL||!SRK){ console.error('❌ missing URL/SERVICE_ROLE_KEY'); process.exit(1); }
const db=createClient(URL,SRK,{auth:{persistSession:false}});

// ── AC-3 confirm (2026-07-02T16:44, 김주연 총괄) canonical = email ──
// #6 정혜인은 AC-3 5계정 밖 — reconcile 게이트(PASS)로 별도 처분: CANON=정연주(fallback).
const CONFIRM = [
  { n: 1, name: '박소예', dup: '5c17e4bc-e948-4dc4-a8cf-37904873edeb', canon_email: 'yoonha62@gmail.com', mode: 'email' },
  { n: 2, name: '장예지', dup: 'a8ffcea8-bbfc-46e7-841b-8192d1d8a3cd', canon_email: 'jangyeji1242@naver.com', mode: 'email' },
  { n: 3, name: '김지혜', dup: '5f741eba-7397-46ac-979b-11c31fc72eb4', canon_email: 'wlgp3907@naver.com', mode: 'email' },
  { n: 4, name: '서은정', dup: '42ca1057-06c8-4183-91ab-b9ab5a7c3a26', canon_email: 'bonny_31@naver.com', mode: 'email' },
  { n: 5, name: '김민경', dup: '3d881cff-40e1-4a1a-9310-5f1482cdd1b8', canon_email: 'alsrud102938@naver.com', mode: 'email' },
  { n: 6, name: '정혜인', dup: '5f141f76-7f72-4560-8a67-bbcdf4938cad', canon_id: 'c851fbb1-31ce-4714-b91c-03e9cb8af566', canon_label: '정연주(joo4442@naver.com)', mode: 'reconcile' },
];

// 재귀속 대상 FK 컬럼 (DA 런북 + reconcile 실측)
const FK = [
  { table: 'duty_roster',      col: 'doctor_id' },
  { table: 'package_sessions', col: 'performed_by' },
  { table: 'room_assignments', col: 'staff_id' },
  { table: 'customers',        col: 'assigned_staff_id' },
];

async function countRefs(dupId){
  const out = {}; let total = 0;
  for (const { table, col } of FK) {
    const { count, error } = await db.from(table).select(col, { count: 'exact', head: true }).eq(col, dupId);
    if (error) { out[`${table}.${col}`] = `ERR:${error.message}`; continue; }
    out[`${table}.${col}`] = count || 0; total += (count || 0);
  }
  return { by: out, total };
}

async function staffRowsByName(name){
  const { data, error } = await db.from('staff').select('id,name,role,active,user_id,clinic_id').eq('name', name);
  if (error) { console.error(name, 'staff err', error.message); return []; }
  // enrich with up email
  for (const r of data) {
    if (r.user_id) {
      const { data: up } = await db.from('user_profiles').select('email,active,name').eq('id', r.user_id).maybeSingle();
      r.up_email = up?.email || null; r.up_active = up?.active ?? null; r.up_name = up?.name || null;
    } else { r.up_email = null; r.up_active = null; r.up_name = null; }
  }
  return data;
}

const results = [];
for (const c of CONFIRM) {
  const rows = await staffRowsByName(c.name);
  let canonId = null, canonMeta = null, resolveNote = '';

  if (c.mode === 'reconcile') {
    canonId = c.canon_id; canonMeta = { label: c.canon_label };
    resolveNote = 'reconcile 게이트 확정 CANON(정연주). AC-3 5계정 밖 — p6_reconcile_gate PASS.';
  } else {
    // email → staff.id : staff 중 linked up.email == canon_email
    const match = rows.filter(r => (r.up_email || '').toLowerCase() === c.canon_email.toLowerCase());
    if (match.length === 1) {
      canonId = match[0].id; canonMeta = match[0];
      resolveNote = `email→staff.id 정확히 1행 매칭 (active=${match[0].active}).`;
    } else if (match.length === 0) {
      resolveNote = `⚠ email ${c.canon_email} 매칭 staff 0행 — supervisor 바인딩 시 auth/up 직접 확인 필요.`;
    } else {
      resolveNote = `⚠ email ${c.canon_email} 매칭 staff ${match.length}행 — 모호, 수기 확인.`;
    }
  }

  const dupRefs = await countRefs(c.dup);
  const canonRefs = canonId ? await countRefs(canonId) : null;

  // dup 자기행 상태
  const { data: dupRow } = await db.from('staff').select('id,name,role,active,user_id').eq('id', c.dup).maybeSingle();

  results.push({
    n: c.n, name: c.name,
    dup_id: c.dup, dup_active: dupRow?.active ?? null, dup_user_id: dupRow?.user_id ?? null,
    canon_id: canonId, canon_active: canonMeta?.active ?? null, canon_email: c.canon_email || c.canon_label,
    resolve_note: resolveNote,
    reattribution_expected: dupRefs,       // DUP 에 매달린 inbound (= 재귀속 대상)
    canon_current_refs: canonRefs?.total ?? null,
    all_staff_rows_for_name: rows.map(r => ({ id: r.id, active: r.active, role: r.role, up_email: r.up_email, up_active: r.up_active })),
    dup_eq_canon: canonId === c.dup ? '⛔ DUP==CANON 충돌' : 'ok',
  });
}

const outObj = {
  ticket: 'T-20260701-foot-STAFF-ROSTER-DEDUP',
  generated_note: 'AC-3 PASS + #6 reconcile PASS 반영 apply-resolve (READ-ONLY)',
  prod_writes: 0,
  gate_input: results,
};
console.log(JSON.stringify(outObj, null, 2));
fs.writeFileSync('scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_apply_resolve.out.json', JSON.stringify(outObj, null, 2));
console.error('\n✅ wrote scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_apply_resolve.out.json (prod write 0)');
