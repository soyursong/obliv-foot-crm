/**
 * T-20260610-foot-DXBUNDLE-SAVE-FAIL — AC-1 분기 판정 (READ-ONLY, 추정금지)
 * prod(rxlomoozakkjesdqjtvd)에 diagnosis_sets / diagnosis_set_items 존재 여부 확정.
 * 존재 시 컬럼·RLS·인덱스까지 확인. prod write 절대 금지(SELECT only / 빈 probe).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function probe(table, cols) {
  const r = await sb.from(table).select(cols).limit(1);
  if (r.error) {
    const missing = r.error.code === '42P01' || /does not exist|schema cache/i.test(r.error.message || '');
    console.log(`  [${table}] code=${r.error.code} msg=${r.error.message}`);
    console.log(`  → 판정: ${missing ? '❌ 부재(또는 PostgREST 스키마캐시 미인지)' : '⚠️ 다른 에러'}`);
    return { exists: false, error: r.error };
  }
  console.log(`  [${table}] ✅ 존재. row probe ok (rows=${r.data?.length ?? 0})`);
  return { exists: true, sample: r.data };
}

console.log('=== AC-1 prod 테이블 존재 판정 (READ-ONLY) ===\n');

console.log('[1] diagnosis_sets — 마이그 정의 컬럼 전부 probe');
const a = await probe('diagnosis_sets', 'id, clinic_id, name, diagnosis_folder, is_active, sort_order, created_at, updated_at');

console.log('\n[2] diagnosis_set_items — 마이그 정의 컬럼 전부 probe');
const b = await probe('diagnosis_set_items', 'id, diagnosis_set_id, service_id, diagnosis_type, sort_order, created_at');

// is_favorite (후속 마이그 20260609) 도 확인 — 부분적용 탐지
console.log('\n[3] diagnosis_sets.is_favorite (후속 마이그 20260609120000) 컬럼 probe');
const c = await sb.from('diagnosis_sets').select('id, is_favorite').limit(1);
if (c.error) console.log(`  is_favorite: code=${c.error.code} msg=${c.error.message}`);
else console.log('  ✅ is_favorite 컬럼 존재');

console.log('\n=== 최종 판정 ===');
console.log(`diagnosis_sets        : ${a.exists ? '존재 O' : '부재 X'}`);
console.log(`diagnosis_set_items   : ${b.exists ? '존재 O' : '부재 X'}`);
console.log(`분기 → ${(a.exists && b.exists) ? 'AC-3 (코드/RLS/FK 점검)' : 'AC-2 (마이그 게이트 재투입)'}`);
