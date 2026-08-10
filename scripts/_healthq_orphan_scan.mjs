/**
 * _healthq_orphan_scan.mjs — 발건강 질문지 사진 orphan 판정 SHARED MODULE (READ-ONLY 스캔·분류)
 *
 * ★단일 술어 SSOT: dry-run 러너와 archive-first sweep 실행기가 **동일한** 3-교집합 분류 로직을 쓰도록
 *   여기 한 곳에만 술어를 둔다. 술어 drift = PHI 오삭제 위험이므로 절대 복제하지 않는다.
 *
 * 정본 근거: DA Decision da_decision_foot_healthq_photo_retention_20260731.md §3 (CODIFY DONE).
 *   orphan(B_orphan_ELIGIBLE) = (1)health_q_tokens.expires_at < now()
 *                               AND (2)대응 health_q_results 행 부재
 *                               AND (3)대응 health_q_photos 행 부재
 *                               AND (g)health_q_tokens.used_at IS NULL   [freeze guard=진짜 미제출]
 *   단일 기준 blanket 삭제 금지. (A)제출완료(결과행/사진행 존재)=sweep 절대배제.
 *
 * 이 모듈은 SELECT/LIST 만 한다. Storage move/remove·DB write 없음.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BUCKET = 'foot-health-q-photos';
export const ROOT_PREFIX = 'health-q';
export const ARCHIVE_PREFIX = '_archive/health-q-orphans'; // 아카이브 대상(스캔 walk 는 ROOT_PREFIX 만 → 재스캔 안 됨)
const CHUNK = 200;

/** repo 루트 .env 우선, 없으면 .env.local 폴백(macstudio 개발머신엔 service_role 이 .env.local 에 위치). */
export function loadEnv() {
  const candidates = ['../.env', '../.env.local'];
  for (const rel of candidates) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (!existsSync(p)) continue;
    const parsed = Object.fromEntries(
      readFileSync(p, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
    );
    if (parsed.VITE_SUPABASE_URL && parsed.SUPABASE_SERVICE_ROLE_KEY) {
      console.log(`[env] loaded from ${rel}`);
      return parsed;
    }
  }
  throw new Error('VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 를 담은 .env 또는 .env.local 이 repo 루트에 필요합니다.');
}

export function makeServiceClient(env) {
  return createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

const chunk = (arr, n) => arr.reduce((a, _, i) => (i % n ? a : [...a, arr.slice(i, i + n)]), []);

/** Storage 재귀 walk (READ-ONLY list). folder entry 는 id===null. */
export async function walk(svc, prefix) {
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
      if (e.id === null) out.push(...await walk(svc, full)); // 폴더 → 재귀
      else out.push({ path: full, id: e.id, created_at: e.created_at ?? null });
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

/**
 * Storage 전수 스캔 + 3-교집합 분류.
 * @returns {{ generated_at, total_objects, class_counts, eligible[], objects[] }}
 *   eligible = B_orphan_ELIGIBLE freeze-set (파괴 실행 시 archive 대상 후보).
 *   objects  = 전 오브젝트(sweep_class 라벨 포함).
 */
export async function scanAndClassify(svc, now = new Date()) {
  // 1) Storage 오브젝트 전수 열거 (ROOT_PREFIX 만 — _archive 는 제외)
  const objects = await walk(svc, ROOT_PREFIX);
  if (objects.length === 0) {
    return { generated_at: now.toISOString(), total_objects: 0, class_counts: {}, eligible: [], objects: [] };
  }

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

  // 6) 분류 (3-교집합 + freeze guard) — ★ 단일 술어 SSOT
  const class_counts = {};
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
    class_counts[cls] = (class_counts[cls] ?? 0) + 1;
    if (cls === 'B_orphan_ELIGIBLE') {
      eligible.push({
        object_id: o.id, path: o.path, clinic_id: o.seg_clinic, token: o.seg_token,
        token_expires_at: t.expires_at, object_created_at: o.created_at,
      });
    }
  }

  return { generated_at: now.toISOString(), total_objects: objects.length, class_counts, eligible, objects };
}
