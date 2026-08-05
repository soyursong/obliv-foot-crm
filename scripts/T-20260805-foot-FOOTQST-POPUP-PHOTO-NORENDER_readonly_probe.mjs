/**
 * T-20260805-foot-FOOTQST-POPUP-PHOTO-NORENDER — READ-ONLY 진단 probe
 *
 * 목적: ResultCard 사진 렌더 흐름(HealthQResultsPanel.tsx 156~176)을 1:1 재현하여
 *   근본원인이 (A) health_q_photos 테이블 RLS / (B) foot-health-q-photos 버킷 policy /
 *   (C) 저장단계 미저장 / (D) createSignedUrl FE 로직 중 어디인지 판정.
 *
 * READ-ONLY: SELECT + createSignedUrl(비파괴 서명발급) 만. mutation 0.
 * 인증컨텍스트 2종 명시(Silent 0-Row Read 금지 표준 준수):
 *   - service_role: RLS 우회 → ground-truth (행 실재/경로/clinic).
 *   - authenticated(staff): RLS 적용 → FE 스태프 세션이 실제로 보는 값.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SVC  = env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = env.TEST_ADMIN_EMAIL || env.TEST_USER_EMAIL || env.TEST_EMAIL;
const PW    = env.TEST_ADMIN_PW || env.TEST_USER_PASSWORD || env.TEST_PASSWORD;
const BUCKET = 'foot-health-q-photos';

console.log('# probe target:', URL_);

const svc = createClient(URL_, SVC, { auth: { persistSession: false } });

// ── 1) service_role ground-truth: 행 실재 + 경로 + clinic ──────────────────
const { data: allRows, error: allErr, count } = await svc
  .from('health_q_photos')
  .select('id, result_id, clinic_id, storage_path, foot_side, sort_order, uploaded_at', { count: 'exact' })
  .order('uploaded_at', { ascending: false })
  .limit(8);
console.log('\n[1] service_role health_q_photos count =', count, 'err=', allErr?.message ?? null);
for (const r of allRows ?? []) {
  const parts = (r.storage_path || '').split('/');
  console.log('   -', r.id.slice(0, 8), 'clinic=', r.clinic_id?.slice(0, 8),
    'path[1]=', parts[1], 'match=', parts[1] === r.clinic_id, 'side=', r.foot_side, 'path=', r.storage_path);
}

if (!allRows?.length) {
  console.log('\n>>> 행 0건 → 저장단계 버그 가능성(AC5). 최근 result 확인.');
  const { data: recentRes } = await svc.from('health_q_results')
    .select('id, clinic_id, submitted_at').order('submitted_at', { ascending: false }).limit(3);
  console.log('   recent results:', recentRes);
}

// ── 2) service_role createSignedUrl (버킷/오브젝트 실재 확인, RLS 무관) ──────
if (allRows?.length) {
  const p = allRows[0];
  const { data: s, error: se } = await svc.storage.from(BUCKET).createSignedUrl(p.storage_path, 60);
  console.log('\n[2] service_role createSignedUrl:', se?.message ?? 'OK', 'url?', !!s?.signedUrl);
}

// ── 3) authenticated staff: RLS SELECT + createSignedUrl (FE 세션 1:1 재현) ──
const stf = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: auth, error: authErr } = await stf.auth.signInWithPassword({ email: EMAIL, password: PW });
console.log('\n[3] staff signIn:', authErr?.message ?? ('OK uid=' + auth?.user?.id?.slice(0, 8)));

if (auth?.user) {
  const { data: clinicRpc, error: cErr } = await stf.rpc('current_user_clinic_id');
  console.log('   current_user_clinic_id() =', clinicRpc, 'err=', cErr?.message ?? null);

  // 스태프가 보는 health_q_photos (RLS 적용)
  const { data: staffRows, error: staffErr, count: sc } = await stf
    .from('health_q_photos')
    .select('id, result_id, clinic_id, storage_path, foot_side', { count: 'exact' })
    .order('uploaded_at', { ascending: false })
    .limit(8);
  console.log('   [3a] staff RLS SELECT count =', sc, 'err=', staffErr?.message ?? null);

  // 스태프 세션으로 createSignedUrl (버킷 storage.objects RLS 적용)
  const testPath = staffRows?.[0]?.storage_path ?? allRows?.[0]?.storage_path;
  if (testPath) {
    const { data: ss, error: sse } = await stf.storage.from(BUCKET).createSignedUrl(testPath, 60 * 30);
    console.log('   [3b] staff createSignedUrl:', sse?.message ?? 'OK', 'url?', !!ss?.signedUrl,
      '(path=', testPath, ')');
  } else {
    console.log('   [3b] staff createSignedUrl SKIP (테스트 경로 없음)');
  }
}

console.log('\n# 판정 가이드:');
console.log('  [1]=0  → 저장단계 버그(AC5) → planner FOLLOWUP');
console.log('  [3a]<[1] 또는 err → 테이블 RLS 스태프 차단 → DB change → FOLLOWUP(리스크#1)');
console.log('  [3b] err/url없음 (but [2] OK) → 버킷 storage.objects policy 스태프 차단 → DB change → FOLLOWUP');
console.log('  [3a] OK & [3b] OK → FE-only (필터/렌더 로직) → FE 수정 진행');
process.exit(0);
