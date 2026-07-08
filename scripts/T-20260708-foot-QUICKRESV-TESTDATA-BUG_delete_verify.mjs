/**
 * T-20260708-foot-QUICKRESV-TESTDATA-BUG — PHASE 2: SINGLE-ROW DELETE + POST-VERIFY
 * PHASE 1(freeze_archive) PASS 전제. 실행 직전 freeze 재조회 재검증(하드가드) 후에만 DELETE.
 *
 * DELETE 대상: reservations id=229caeff-24ed-4b04-a076-6c7a19fd3481 (orphan, customer_id=NULL)
 * customers 절대 무접촉. 접수테스트2(41c2852c/fd13ce8b) 절대 무접촉.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGET_ID = '229caeff-24ed-4b04-a076-6c7a19fd3481';
const PRESERVE_CUST_ID = '41c2852c-d647-474c-8777-bc17111ff7d1';
const PRESERVE_RESV_ID = 'fd13ce8b-e5fe-40f3-8997-f0e1cc6588b2';

function fail(msg, extra) { console.error('\n❌ ABORT:', msg); if (extra) console.error(JSON.stringify(extra, null, 2)); process.exit(2); }

// --- 하드가드: DELETE 직전 freeze 재검증 ---
console.log('=== PHASE 2: DELETE 직전 freeze 재검증 ===');
const { data: pre } = await sb.from('reservations').select('*').eq('id', TARGET_ID);
if (!pre || pre.length !== 1) fail(`대상 1건이어야 함 (실제 ${pre?.length ?? 0})`, pre);
const row = pre[0];
const phone = String(row.customer_phone ?? '');
const ok = row.customer_id == null && (row.customer_name === '접수테스트') && phone.endsWith('5557') && row.status === 'confirmed';
if (!ok) fail('freeze 불일치 — 추정 삭제 금지.', row);
console.log('✅ freeze 재검증 PASS (customer_id=NULL·접수테스트·5557·confirmed).');

// --- 단건 DELETE (id-pin) ---
console.log('\n=== 단건 DELETE 실행 ===');
const { data: del, error: de } = await sb.from('reservations').delete().eq('id', TARGET_ID).select('id, customer_name, customer_phone, customer_id, status');
if (de) fail('DELETE error', de);
console.log('DELETE 반환 행:', JSON.stringify(del, null, 2));
if ((del?.length ?? 0) !== 1) fail(`정확히 1건 삭제되어야 함 (실제 ${del?.length ?? 0})`, del);
console.log('✅ 1건 삭제 완료.');

// --- POST-VERIFY 1: 대상 0건 재조회 ---
console.log('\n=== POST-VERIFY 1: 대상 재조회 (0건 기대) ===');
const { data: after } = await sb.from('reservations').select('id').eq('id', TARGET_ID);
console.log(`대상 잔존: ${after?.length ?? 0}건`);
if ((after?.length ?? 0) !== 0) fail('삭제 후에도 대상 잔존 — 이상.', after);
console.log('✅ 대상 0건 확인.');

// --- POST-VERIFY 2: 보존 대상 무접촉 ---
console.log('\n=== POST-VERIFY 2: 접수테스트2 보존 무접촉 확인 ===');
const { data: pc } = await sb.from('customers').select('id, name, chart_number, phone').eq('id', PRESERVE_CUST_ID);
const { data: pr } = await sb.from('reservations').select('id, customer_name, status').eq('id', PRESERVE_RESV_ID);
console.log('보존 customers:', JSON.stringify(pc, null, 2));
console.log('보존 reservations:', JSON.stringify(pr, null, 2));
if ((pc?.length ?? 0) !== 1 || (pr?.length ?? 0) !== 1) fail('보존 대상 소실/변경 — 사고.', { pc, pr });
console.log('✅ 접수테스트2(41c2852c/F-4510 + fd13ce8b) 잔존·무접촉 확인.');

console.log('\n=== PHASE 2 DONE — 순소실: 대상 1건만 삭제, 보존 대상 무손실. ===');
