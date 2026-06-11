/**
 * T-20260612-foot-PHRASE-BROKEN-REGRESS — AC-0 DIAGNOSTIC (READ-ONLY, NO WRITE)
 *
 * 목적: '상용구(// 슬래시 자동완성) 06-11 하루종일 안 됨' 회귀의 끊긴 1지점 특정.
 *   특히 AC-0 step2 '목록 미로딩'(데이터/RLS/role 회귀) 가설을 DB 증거로 확정/반증.
 *   *** SELECT 만. write 없음. ***
 *
 * 점검:
 *   A. service_role(RLS bypass)로 phrase_templates / super_phrases 활성 행 count + 분포
 *   B. anon key 로 동일 조회 → service vs anon 괴리 = RLS 가시성 회귀 신호
 *   C. updated_at 최근값 — 06-11 경 is_active 플립/마스터 변동 흔적
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const svc = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

async function probe(label, client) {
  console.log(`\n===== [${label}] =====`);
  // phrase_templates (앱 쿼리와 동일 컬럼/필터)
  const pt = await client
    .from('phrase_templates')
    .select('id,category,name,content,shortcut_key,is_active,phrase_type,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (pt.error) {
    console.log(`phrase_templates ERROR: ${pt.error.code} ${pt.error.message}`);
  } else {
    const rows = pt.data || [];
    const withShortcut = rows.filter((r) => r.shortcut_key != null && r.shortcut_key !== '').length;
    const byType = rows.reduce((a, r) => ((a[r.phrase_type ?? 'null'] = (a[r.phrase_type ?? 'null'] || 0) + 1), a), {});
    console.log(`phrase_templates(is_active=true): ${rows.length}건  shortcut_key보유=${withShortcut}  type분포=${JSON.stringify(byType)}`);
    console.log('  sample:', rows.slice(0, 3).map((r) => ({ id: r.id, name: r.name, sc: r.shortcut_key })));
  }
  // super_phrases
  const sp = await client
    .from('super_phrases')
    .select('id,name,diagnosis,clinical_progress,rx_items,is_active,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (sp.error) {
    console.log(`super_phrases ERROR: ${sp.error.code} ${sp.error.message}`);
  } else {
    console.log(`super_phrases(is_active=true): ${(sp.data || []).length}건`);
    console.log('  sample:', (sp.data || []).slice(0, 3).map((r) => ({ id: r.id, name: r.name })));
  }
}

async function recency() {
  console.log('\n===== [C] phrase_templates 최근 변동 (service_role, is_active 무관) =====');
  // updated_at 컬럼이 있으면 최근순, 없으면 graceful
  const probe1 = await svc.from('phrase_templates').select('id,name,is_active,updated_at').order('updated_at', { ascending: false }).limit(8);
  if (probe1.error) {
    console.log(`updated_at 조회 불가(${probe1.error.code}: ${probe1.error.message}) → created_at 시도`);
    const probe2 = await svc.from('phrase_templates').select('id,name,is_active,created_at').order('created_at', { ascending: false }).limit(8);
    if (probe2.error) console.log(`created_at 도 불가: ${probe2.error.message}`);
    else console.log(probe2.data);
  } else {
    console.log(probe1.data);
  }
  // 전체 vs 활성 카운트
  const all = await svc.from('phrase_templates').select('id', { count: 'exact', head: true });
  const act = await svc.from('phrase_templates').select('id', { count: 'exact', head: true }).eq('is_active', true);
  console.log(`phrase_templates 전체=${all.count} / 활성=${act.count} / 비활성=${(all.count ?? 0) - (act.count ?? 0)}`);
}

console.log('URL:', env.VITE_SUPABASE_URL);
await probe('A. service_role (RLS bypass)', svc);
await probe('B. anon (public RLS view)', anon);
await recency();
console.log('\n=== DONE (read-only) ===');
