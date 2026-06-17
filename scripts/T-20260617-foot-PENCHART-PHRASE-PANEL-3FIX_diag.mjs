/**
 * T-20260617-foot-PENCHART-PHRASE-PANEL-3FIX — DIAGNOSTIC (read-only)
 *
 * 이슈1 RC 규명: 펜차트 캔버스 상용구 패널에 진료차트 상용구(처방·재진·초진)가 섞임.
 *   - 旣배포 split(T-20260615-PHRASE-MEDCHART-CLINICTAB-SPLIT)이 채택한 식별자=phrase_type
 *     (pen_chart / medical_chart), NULL 레거시 행은 pen_chart fallback.
 *   - BUG3(ec1ce6b6)가 캔버스 로드에 .eq('phrase_type','pen_chart') 추가했으나 현장 재발.
 *
 * 측정:
 *   (1) phrase_type 컬럼 실재 여부 + 전체 분포 (pen_chart / medical_chart / NULL / 기타)
 *   (2) is_active=true 한정 phrase_type 분포 (캔버스 로드 모집단)
 *   (3) 현장 이미지 카테고리(차팅/처방/원장님/일반)별 phrase_type 교차표
 *       — 진료성 카테고리(처방 등)에 pen_chart/NULL 로 라벨된 행이 있으면 그게 누수 RC
 *   (4) 캔버스 필터 .eq('phrase_type','pen_chart') 재현: 무엇이 노출되는가
 *
 * 어떤 쓰기도 하지 않음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 전체 phrase_templates 로드
const { data: all, error } = await sb.from('phrase_templates')
  .select('id, category, name, phrase_type, is_active, sort_order')
  .order('category');
if (error) { console.error('phrase_templates err:', error); process.exit(1); }
console.log('총 phrase_templates 행:', all.length);

// (1) phrase_type 컬럼 실재 + 분포
const hasCol = all.length === 0 || ('phrase_type' in all[0]);
console.log('\n=== (1) phrase_type 컬럼 존재 ===', hasCol);
const dist = {};
for (const r of all) {
  const k = r.phrase_type === null || r.phrase_type === undefined ? 'NULL' : r.phrase_type;
  dist[k] = (dist[k] || 0) + 1;
}
console.log('전체 phrase_type 분포:', JSON.stringify(dist));

// (2) is_active 한정 분포 (캔버스 로드 모집단)
const active = all.filter((r) => r.is_active === true);
const distA = {};
for (const r of active) {
  const k = r.phrase_type === null || r.phrase_type === undefined ? 'NULL' : r.phrase_type;
  distA[k] = (distA[k] || 0) + 1;
}
console.log('\n=== (2) is_active=true 한정 분포 (총', active.length, ') ===');
console.log(JSON.stringify(distA));

// (3) 카테고리 × phrase_type 교차표
console.log('\n=== (3) 카테고리 × phrase_type 교차표 (is_active=true) ===');
const cross = {};
for (const r of active) {
  const cat = r.category ?? '(null)';
  const pt = r.phrase_type ?? 'NULL';
  cross[cat] = cross[cat] || {};
  cross[cat][pt] = (cross[cat][pt] || 0) + 1;
}
for (const cat of Object.keys(cross).sort()) {
  console.log(`  ${cat}:`, JSON.stringify(cross[cat]));
}

// (4) 캔버스 필터 재현: .eq('phrase_type','pen_chart') strict
const { data: canvasShown } = await sb.from('phrase_templates')
  .select('id, category, name, phrase_type')
  .eq('is_active', true)
  .eq('phrase_type', 'pen_chart')
  .order('sort_order');
console.log('\n=== (4) 캔버스 strict 필터(.eq pen_chart) 노출 행수 ===', canvasShown?.length ?? 0);
const canvasCat = {};
for (const r of (canvasShown ?? [])) canvasCat[r.category ?? '(null)'] = (canvasCat[r.category ?? '(null)'] || 0) + 1;
console.log('  카테고리 분포:', JSON.stringify(canvasCat));

// (4b) 관리탭 분류 재현: (phrase_type ?? 'pen_chart')==='pen_chart' (NULL fallback 포함)
const mgmtPen = active.filter((r) => (r.phrase_type ?? 'pen_chart') === 'pen_chart');
const mgmtCat = {};
for (const r of mgmtPen) mgmtCat[r.category ?? '(null)'] = (mgmtCat[r.category ?? '(null)'] || 0) + 1;
console.log('\n=== (4b) 관리탭 분류(NULL→pen_chart fallback) pen_chart 노출 행수 ===', mgmtPen.length);
console.log('  카테고리 분포:', JSON.stringify(mgmtCat));

// (5) 진료성으로 보이는 카테고리 표본 (처방/재진/초진/원장님)
console.log('\n=== (5) 진료성 의심 카테고리 표본 (처방/재진/초진/원장 키워드) ===');
const medishLike = active.filter((r) => /처방|재진|초진|원장|진료|투약|처치/.test(r.category ?? '') || /처방|재진|초진/.test(r.name ?? ''));
for (const r of medishLike.slice(0, 30)) {
  console.log(`  [${r.id}] cat=${r.category} type=${r.phrase_type ?? 'NULL'} name=${r.name}`);
}
console.log('  (진료성 의심 행 총', medishLike.length, ')');

process.exit(0);
