/** 기능 검증(격리): AC-1/AC-2/AC-6 + 시나리오5 멱등+편집 재push. 전체 ROLLBACK(미반영). */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }) });
  const b = await r.json(); if (!r.ok) { console.error('SQL ERR:', JSON.stringify(b)); process.exit(1); } return b;
}
const slug = (await q(`SELECT slug FROM clinics LIMIT 1;`))[0].slug;
const ext = 'FUNCTEST-MEMO-' + '20260701';
// 단일 트랜잭션 내에서 시퀀스 실행 후 ROLLBACK → 미반영
const sql = `
DO $$
DECLARE v_rid uuid; v_dn int; v_dc text; v_hn int; v_mis int; v_report text;
BEGIN
  -- S1: 메모A push
  v_rid := public.upsert_reservation_from_source('dopamine','${ext}','${slug}','01099998888','펑크테스트',
    CURRENT_DATE,'10:00','메모A','confirmed','new','dopamine');

  -- S6(AC-6 멱등): 동일 메모 재push 2회
  PERFORM public.upsert_reservation_from_source('dopamine','${ext}','${slug}','01099998888','펑크테스트',
    CURRENT_DATE,'10:00','메모A','confirmed','new','dopamine');
  PERFORM public.upsert_reservation_from_source('dopamine','${ext}','${slug}','01099998888','펑크테스트',
    CURRENT_DATE,'10:00','메모A','confirmed','new','dopamine');

  -- S5(편집 재push): 메모B
  PERFORM public.upsert_reservation_from_source('dopamine','${ext}','${slug}','01099998888','펑크테스트',
    CURRENT_DATE,'10:00','메모B','confirmed','new','dopamine');

  -- S3(AC-2 빈값 재push = no-op, 보존)
  PERFORM public.upsert_reservation_from_source('dopamine','${ext}','${slug}','01099998888','펑크테스트',
    CURRENT_DATE,'10:00','','confirmed','new','dopamine');

  SELECT count(*), max(content) INTO v_dn, v_dc FROM reservation_memo_history
    WHERE reservation_id=v_rid AND source_system='dopamine';

  -- 사람 행(source NULL) append-only 불변: 동일 reservation에 사람메모 2건 직접 insert
  INSERT INTO reservation_memo_history (reservation_id, clinic_id, content, created_by_name)
    SELECT v_rid, clinic_id, '사람메모1', '직원' FROM reservations WHERE id=v_rid;
  INSERT INTO reservation_memo_history (reservation_id, clinic_id, content, created_by_name)
    SELECT v_rid, clinic_id, '사람메모2', '직원' FROM reservations WHERE id=v_rid;
  SELECT count(*) INTO v_hn FROM reservation_memo_history WHERE reservation_id=v_rid AND source_system IS NULL;

  -- clinic_id 결선: timeline 행 clinic_id == reservation clinic_id
  SELECT count(*) INTO v_mis FROM reservation_memo_history h JOIN reservations r ON r.id=h.reservation_id
    WHERE h.reservation_id=v_rid AND h.clinic_id <> r.clinic_id;

  v_report := format('RESULT|| dopamine행수=%s (expect 1) | dopamine내용=%s (expect 메모B) | 사람행수=%s (expect 2) | clinic불일치=%s (expect 0)',
    v_dn, v_dc, v_hn, v_mis);
  RAISE EXCEPTION '%', v_report;  -- 값 회수 + 강제 롤백(미반영)
END $$;
`;
const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ query: sql }) });
const b = await r.json();
// NOTICE 는 message 본문/에러에 안 담길 수 있음 → 에러가 ROLLBACK_TEST_DONE 이면 성공
const txt = JSON.stringify(b);
const m = txt.match(/RESULT\|\|[^"\\]*/);
if (m) { console.log('✅ 기능 검증(강제 롤백, 미반영):'); console.log('  ', m[0].replace('RESULT|| ', '')); }
else { console.log('Status', r.status, txt); }
