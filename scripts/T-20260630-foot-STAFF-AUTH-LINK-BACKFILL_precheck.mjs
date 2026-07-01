/**
 * T-20260630-foot-STAFF-AUTH-LINK-BACKFILL — APPLY PRECHECK (READ-ONLY, prod write 0)
 *
 * 감독형 신원 정합(supervised identity reconciliation) — bulk backfill 아님.
 * DA CONSULT-REPLY(MSG-20260701-034334-qxef): auto backfill 0 확정, 현장확인 증거 동반 targeted 단건만 허용.
 * 현장확인 증거(field_confirm): 김주연 총괄, ts 1782859741.988249 (thread 1782810022.833979 / C0ATE5P6JTH)
 *   - 박민석(활성 coordinator) = 직원명부=로그인계정 동일인 confirm → 링크 GO
 *   - 문지은(대표원장·director) = 동일인 confirm + 총괄 갈음(director급 인지) → 링크 GO
 *
 * 매핑 (staff.id → user_profiles.id):
 *   박민석: staff fd54a977-d203-44f6-91cb-0f1fce47dd97 → user_profiles dad7dc00-dc99-41af-b5fc-42aa77a0bd9b
 *   문지은: staff b46abc6d-4a24-4776-b807-751b62f60fe3 → user_profiles d343769a-493a-49c9-b718-4c92c6f5db9a
 *
 * 안전: 오직 SELECT (service_role REST). prod write 0.
 * apply 직전 supervisor DB 게이트 핸드오프 전, 기대 정확 2행 · 무결성 · OCCUPIED 무충돌을 read-only 재확인.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function env(k) {
  if (process.env[k]) return process.env[k];
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = l.match(new RegExp(`^${k}=(.*)$`));
      if (m) return m[1].trim();
    }
  }
  return null;
}
const URL = env('VITE_SUPABASE_URL');
const SRK = env('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !SRK) { console.error('❌ missing URL/SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

// 현장확인 증거 기반 확정 매핑 (2건 targeted 단건, 룰 일괄 금지)
const MAP = [
  { name: '박민석', role: 'coordinator', staff_id: 'fd54a977-d203-44f6-91cb-0f1fce47dd97', up_id: 'dad7dc00-dc99-41af-b5fc-42aa77a0bd9b' },
  { name: '문지은', role: 'director',    staff_id: 'b46abc6d-4a24-4776-b807-751b62f60fe3', up_id: 'd343769a-493a-49c9-b718-4c92c6f5db9a' },
];
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot

let fail = 0;
const ok  = (m) => console.log('  ✅', m);
const bad = (m) => { console.log('  ❌', m); fail++; };

async function main() {
  console.log('=== T-20260630-foot-STAFF-AUTH-LINK-BACKFILL PRECHECK (read-only) ===\n');

  for (const t of MAP) {
    console.log(`── [${t.name}] staff ${t.staff_id} → user_profiles ${t.up_id} ──`);

    // (A) staff 행: 존재 · active · user_id IS NULL · role · clinic
    const { data: st, error: se } = await db.from('staff')
      .select('id,name,role,user_id,active,clinic_id').eq('id', t.staff_id).maybeSingle();
    if (se) { bad(`staff 조회 오류: ${se.message}`); continue; }
    if (!st) { bad(`staff 미존재: ${t.staff_id}`); continue; }
    if (st.name !== t.name) bad(`staff.name 불일치: 기대 ${t.name}, 실제 ${st.name}`);
    if (st.role !== t.role) bad(`staff.role 불일치: 기대 ${t.role}, 실제 ${st.role}`);
    if (st.active !== true) bad(`staff.active=false — 비활성행 링크 금지(dedup 트랙)`);
    if (st.user_id !== null) bad(`staff.user_id 이미 채워짐(${st.user_id}) — WHERE 가드(IS NULL) 위반, apply 중단`);
    else ok(`staff OK: name=${st.name} role=${st.role} active=${st.active} user_id=NULL clinic=${st.clinic_id}`);

    // (B) user_profiles 행: 존재 · active · approved · role · name · clinic 일치
    const { data: up, error: ue } = await db.from('user_profiles')
      .select('id,name,role,email,active,approved,clinic_id').eq('id', t.up_id).maybeSingle();
    if (ue) { bad(`user_profiles 조회 오류: ${ue.message}`); continue; }
    if (!up) { bad(`user_profiles 미존재: ${t.up_id}`); continue; }
    if (up.name !== t.name) bad(`up.name 불일치: 기대 ${t.name}, 실제 ${up.name}`);
    if (up.role !== t.role) bad(`up.role 불일치: 기대 ${t.role}, 실제 ${up.role}`);
    if (up.active !== true) bad(`up.active=false`);
    if (up.approved !== true) bad(`up.approved=false — 미승인 계정 링크 보류 검토`);
    else ok(`user_profiles OK: name=${up.name} role=${up.role} email=${up.email} active=${up.active} approved=${up.approved} clinic=${up.clinic_id}`);

    // (C) OCCUPIED 무충돌: 이 user_profiles.id 를 이미 다른 staff 가 점유하지 않을 것
    const { data: occ, error: oe } = await db.from('staff')
      .select('id,name,role,active').eq('user_id', t.up_id);
    if (oe) { bad(`OCCUPIED 조회 오류: ${oe.message}`); }
    else if ((occ || []).length > 0) {
      bad(`OCCUPIED 충돌: user_profiles ${t.up_id} 를 이미 staff [${occ.map(o => `${o.name}/${o.id}/active=${o.active}`).join(', ')}] 가 점유 — 링크 금지(dedup 트랙)`);
    } else ok(`OCCUPIED 무충돌: user_profiles ${t.up_id} 미점유`);
    console.log('');
  }

  // (D) 기대 영향행수 = 정확 2 (WHERE staff.user_id IS NULL + id IN(2건))
  const ids = MAP.map(t => t.staff_id);
  const { data: guarded, error: ge } = await db.from('staff')
    .select('id,name,user_id').in('id', ids).is('user_id', null);
  if (ge) { bad(`기대행수 조회 오류: ${ge.message}`); }
  else if (guarded.length !== 2) { bad(`기대 영향행 2, 실제 ${guarded.length} — apply 중단 사유`); }
  else ok(`[D] WHERE 가드 기대 영향행수 정확 2행: ${guarded.map(g => g.name).join(', ')}`);

  // (E) carve-out 무회귀: 그 외 staff.user_id IS NULL 은 본 apply 대상 아님(건드리지 않음)
  const { data: allNull } = await db.from('staff').select('id,name,role,active').is('user_id', null);
  const others = (allNull || []).filter(s => !ids.includes(s.id));
  ok(`[E] carve-out: staff.user_id IS NULL 총 ${(allNull || []).length}건 중 본 apply 대상 2건, 잔여 ${others.length}건은 미변경(NONPERSON/OCCUPIED/NO_MATCH/dedup 트랙)`);

  console.log('\n── 결과 ──');
  if (fail === 0) {
    console.log('✅ PRECHECK PASS — supervisor DB 게이트 핸드오프 가능. apply 기대 정확 2행(박민석·문지은).');
    console.log('   현장확인 증거: 김주연 총괄 ts 1782859741.988249. auto backfill 0, targeted 단건 2건만.');
  } else {
    console.log(`❌ PRECHECK FAIL — ${fail}건. apply 보류.`);
    process.exit(2);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
