/**
 * T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP — DRY-RUN (READ-ONLY)
 *
 * 발건강 질문지 draft 미제출 사진 orphan 을 3-교집합 술어로 특정하고 **대상목록·건수만** 산출한다.
 * *** SELECT/LIST 만. Storage move/remove·DB write 없음. 순소실 0. ***
 *
 * ★정본 근거: DA Decision da_decision_foot_healthq_photo_retention_20260731.md §3 (CODIFY DONE).
 *   orphan = (1)health_q_tokens.expires_at < now()  AND  (2)대응 health_q_results 행 부재
 *            AND (3)대응 health_q_photos 행 부재   [+ freeze guard: used_at IS NULL(진짜 미제출)]
 *   단일 기준 blanket 삭제 금지. (A)제출완료(결과행/사진행 존재)=sweep 절대배제.
 *
 * 파괴 실행은 본 스크립트 범위 아님 — Archive-First SOP 봉투 + supervisor 코드리뷰/gated 실행에서만.
 *
 * 실행: node scripts/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_dryrun.mjs
 *   (repo 루트 .env 에 VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필요. macstudio 에서 실행.)
 *   결과 JSON → scripts/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_dryrun.out.json
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const BUCKET = 'foot-health-q-photos';
const ROOT_PREFIX = 'health-q';
const CHUNK = 200;

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const svc = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const chunk = (arr, n) => arr.reduce((a, _, i) => (i % n ? a : [...a, arr.slice(i, i + n)]), []);

/** Storage 재귀 walk (READ-ONLY list). folder entry 는 id===null. */
async function walk(prefix) {
  const out = [];
  let offset = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await svc.storage.from(BUCKET).list(prefix, {
      limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list(${prefix}) 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const e of data) {
      const full = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) out.push(...await walk(full));        // 폴더 → 재귀
      else out.push({ path: full, id: e.id, created_at: e.created_at ?? null });
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function main() {
  const now = new Date();
  console.log('===== DRY-RUN (READ-ONLY): health_q_photos orphan TTL sweep 대상 산정 =====');
  console.log(`bucket=${BUCKET} now=${now.toISOString()}`);

  // 1) Storage 오브젝트 전수 열거
  const objects = await walk(ROOT_PREFIX);
  console.log(`\n[1] Storage 오브젝트(파일) 총 ${objects.length}건`);
  if (objects.length === 0) { console.log('대상 없음 — 종료'); return; }

  // 2) path 파싱: health-q/{clinic}/{token}/{file}
  for (const o of objects) {
    const seg = o.path.split('/');
    o.seg_clinic = seg[1] ?? null;
    o.seg_token = seg[2] ?? null;
  }
  const tokens = [...new Set(objects.map((o) => o.seg_token).filter(Boolean))];

  // 3) 토큰 배치 조회 (expires_at, used_at)
  const tokMap = new Map();
  for (const c of chunk(tokens, CHUNK)) {
    const { data, error } = await svc
      .from('health_q_tokens')
      .select('id, token, expires_at, used_at, clinic_id')
      .in('token', c);
    if (error) throw new Error(`health_q_tokens 조회 실패: ${error.message}`);
    for (const t of data) tokMap.set(t.token, t);
  }

  // 4) 결과행 존재하는 token_id 집합 (c2: result 부재 판정)
  const tokenIds = [...tokMap.values()].map((t) => t.id);
  const resultTokenIds = new Set();
  for (const c of chunk(tokenIds, CHUNK)) {
    const { data, error } = await svc
      .from('health_q_results').select('token_id').in('token_id', c);
    if (error) throw new Error(`health_q_results 조회 실패: ${error.message}`);
    for (const r of data) if (r.token_id) resultTokenIds.add(r.token_id);
  }

  // 5) 사진 참조행 존재하는 storage_path 집합 (c3: photo 부재 판정)
  const allPaths = objects.map((o) => o.path);
  const photoPaths = new Set();
  for (const c of chunk(allPaths, CHUNK)) {
    const { data, error } = await svc
      .from('health_q_photos').select('storage_path').in('storage_path', c);
    if (error) throw new Error(`health_q_photos 조회 실패: ${error.message}`);
    for (const p of data) photoPaths.add(p.storage_path);
  }

  // 6) 분류 (3-교집합 + freeze guard)
  const classes = {};
  const eligible = [];
  for (const o of objects) {
    const t = tokMap.get(o.seg_token);
    const token_missing = !t;
    const c1_expired = !!t && new Date(t.expires_at) < now;
    const c2_result_absent = !!t && !resultTokenIds.has(t.id);
    const c3_photo_absent = !photoPaths.has(o.path);
    const g_never_submitted = !!t && t.used_at == null;

    let cls;
    if (token_missing) cls = 'UNCLASSIFIED_no_token_row';
    else if (!c2_result_absent || !c3_photo_absent) cls = 'A_submitted_protected';
    else if (!g_never_submitted) cls = 'RESIDUE_used_but_result_absent';
    else if (c1_expired && c2_result_absent && c3_photo_absent && g_never_submitted) cls = 'B_orphan_ELIGIBLE';
    else if (!c1_expired) cls = 'B_draft_not_yet_expired';
    else cls = 'OTHER_review';

    o.sweep_class = cls;
    classes[cls] = (classes[cls] ?? 0) + 1;
    if (cls === 'B_orphan_ELIGIBLE') {
      eligible.push({
        object_id: o.id, path: o.path, clinic_id: o.seg_clinic, token: o.seg_token,
        token_expires_at: t.expires_at, object_created_at: o.created_at,
      });
    }
  }

  // 7) 요약 + freeze-set 스냅샷 (판정근거 동봉)
  const summary = {
    ticket: 'T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP',
    mode: 'DRY-RUN (READ-ONLY, no mutation)',
    generated_at: now.toISOString(),
    bucket: BUCKET,
    predicate: '3-교집합: (1)token expired AND (2)result absent AND (3)photo absent [+ used_at IS NULL]',
    da_ssot: 'da_decision_foot_healthq_photo_retention_20260731.md §3',
    total_objects: objects.length,
    class_counts: classes,
    sweep_eligible_count: eligible.length,
    protected_note: 'A_submitted_protected / RESIDUE_* / UNCLASSIFIED_* 은 절대 삭제 대상 아님',
    freeze_set: eligible,
  };
  console.log('\n===== 분류 요약 =====');
  console.log(JSON.stringify(summary.class_counts, null, 2));
  console.log(`\nsweep 적격(B_orphan_ELIGIBLE): ${eligible.length}건`);
  console.log('보호(sweep 배제):',
    ['A_submitted_protected', 'RESIDUE_used_but_result_absent', 'UNCLASSIFIED_no_token_row', 'B_draft_not_yet_expired']
      .map((k) => `${k}=${classes[k] ?? 0}`).join(' / '));

  const outPath = new URL('./T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_dryrun.out.json', import.meta.url);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nfreeze-set 스냅샷 저장 → ${outPath.pathname}`);
  console.log('===== END DRY-RUN (파괴 실행 없음) =====');
}

main().catch((e) => { console.error('DRY-RUN ERROR:', e.message); process.exit(1); });
