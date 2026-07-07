/**
 * T-20260629-dopamine-FOOTCAL-DIRECT-WRITE — E2E 실 write prod 검증 (RPC DB-layer).
 * upsert_reservation_from_source (17-arg + guard#5 + memo-timeline, 020000 body) 를 service_role 로
 * 실제 호출 → prod reservations 1행 착지 확인 → 검증 후 test row 정리.
 * (gateway verify_jwt=false 은 별도 curl probe로 확인. 인증 ingest→row 는 dopamine-side secret 필요.)
 */
import { readFileSync } from 'fs';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL = env.VITE_SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) throw new Error('URL/SERVICE_ROLE_KEY required');

const EXT_ID = 'E2E-FOOTCAL-DIRECT-WRITE-20260707';   // 고정 멱등키 = 재실행/정리 안전
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };

async function rpc(name, argsObj) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(argsObj) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
async function rest(path, method = 'GET') {
  const r = await fetch(`${URL}/rest/v1/${path}`, { method, headers: { ...H, Prefer: 'return=representation' } });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}

console.log('══ E2E RPC 실 write prod 검증 ══\n');

// 1) RPC 호출 — 도파민 인입 시뮬(source_system=dopamine, external_id 고정 멱등키)
console.log('── 1) upsert_reservation_from_source 호출 (service_role) ──');
const call = await rpc('upsert_reservation_from_source', {
  p_source_system: 'dopamine',
  p_external_id: EXT_ID,
  p_clinic_slug: 'jongno-foot',
  p_customer_phone: '+821099990001',
  p_customer_name: 'E2E검증고객',
  p_reservation_date: '2026-07-08',
  p_reservation_time: '10:30:00',
  p_memo: 'FOOTCAL-DIRECT-WRITE E2E memo',
  p_status: 'confirmed',
  p_visit_type: 'new',
  p_created_via: 'dopamine',
});
console.log('  status:', call.status, '→ reservation_id:', JSON.stringify(call.body));
const rid = typeof call.body === 'string' ? call.body : (call.body?.id ?? call.body);
if (call.status >= 300 || !rid) { console.error('❌ RPC 호출 실패'); process.exit(1); }

// 2) prod 실재 확인 — 방금 착지한 행 read-back
console.log('\n── 2) 착지 행 read-back ──');
const rb = await rest(`reservations?source_system=eq.dopamine&external_id=eq.${encodeURIComponent(EXT_ID)}&select=id,customer_name,customer_phone,reservation_date,reservation_time,status,source_system,external_id,created_via,visit_type`);
console.log('  status:', rb.status, JSON.stringify(rb.body));
const row = Array.isArray(rb.body) ? rb.body[0] : null;
if (!row || row.id !== rid) { console.error('❌ 착지 행 read-back 실패'); process.exit(1); }
console.log('  ✅ prod reservations 1행 실재 착지 (id=' + row.id + ')');

// 3) 멱등 재호출(가드#2) — 동일 external_id 재푸시 = 동일 id, 스팸 0
console.log('\n── 3) 멱등 재호출(동일 external_id) ──');
const call2 = await rpc('upsert_reservation_from_source', {
  p_source_system: 'dopamine', p_external_id: EXT_ID, p_clinic_slug: 'jongno-foot',
  p_customer_phone: '+821099990001', p_customer_name: 'E2E검증고객',
  p_reservation_date: '2026-07-08', p_reservation_time: '11:00:00', p_status: 'confirmed', p_visit_type: 'new',
});
const rid2 = typeof call2.body === 'string' ? call2.body : call2.body?.id;
console.log('  재호출 id:', rid2, rid2 === rid ? '✅ 동일 id (멱등)' : '❌ id 불일치');

// 4) 정리 — test row 삭제
console.log('\n── 4) test row 정리 ──');
const del = await rest(`reservations?source_system=eq.dopamine&external_id=eq.${encodeURIComponent(EXT_ID)}`, 'DELETE');
console.log('  삭제 status:', del.status, JSON.stringify(del.body));
const chk = await rest(`reservations?source_system=eq.dopamine&external_id=eq.${encodeURIComponent(EXT_ID)}&select=id`);
const remain = Array.isArray(chk.body) ? chk.body.length : -1;
console.log(remain === 0 ? '  ✅ 정리 완료 (잔존 0행)' : `  ❌ 잔존 ${remain}행`);

// customers E2E 흔적도 정리 (신규 생성됐을 수 있음)
const delc = await rest(`customers?phone=eq.${encodeURIComponent('+821099990001')}&name=eq.${encodeURIComponent('E2E검증고객')}`, 'DELETE');
console.log('  customers 정리 status:', delc.status, Array.isArray(delc.body) ? `(${delc.body.length}행)` : '');

console.log('\n══ 결과:', (row.id === rid && rid2 === rid && remain === 0) ? '✅✅ GREEN — 실 write 착지 + 멱등 + 정리 완료' : '❌ 검토 필요', '══');
