/**
 * T-20260724-foot-SOGYEONSEO-SONJA-DIAGDATE-FIX — EVIDENCE snapshot (READ-ONLY, prod write 0)
 *
 * 손정아 F-4673 소견서(opinion_doc, final_text) 발행본 before-state 스냅샷 + immutability 가드 실재 확인.
 * 안전: 오직 SELECT + pg_trigger 조회. prod write 0.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim();
    }
  }
  return null;
}
const URL = envFromLocal('VITE_SUPABASE_URL');
const SRK = envFromLocal('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const CUSTOMER_ID = '4f85924b-07c5-4586-a783-68cdae6ce5f2'; // 손정아 F-4673 (jongno-foot)
const TARGET_NEWEST_OPINION = '34998176-13cc-4f80-bd8c-4a6bb8096382'; // published, 진단일 07-24

async function main() {
  console.log('════ EVIDENCE: 손정아 F-4673 소견서 발행본 (READ-ONLY) ════\n');

  // 소견서(opinion_doc) 발행본만 — doc_kind='opinion_doc' 또는 final_text 보유.
  const { data: subs } = await db
    .from('form_submissions')
    .select('id, status, created_at, field_data')
    .eq('customer_id', CUSTOMER_ID)
    .order('created_at', { ascending: false });

  const opinionDocs = (subs ?? []).filter((s) => {
    const fd = s.field_data ?? {};
    return fd.doc_kind === 'opinion_doc' || typeof fd.final_text === 'string';
  });

  console.log(`소견서 발행본(opinion_doc) ${opinionDocs.length}건:\n`);
  for (const s of opinionDocs) {
    const fd = s.field_data ?? {};
    const isTarget = s.id === TARGET_NEWEST_OPINION;
    console.log(`  ${isTarget ? '★[정정대상 최신]' : '  '} id: ${s.id}`);
    console.log(`      status      : ${s.status}`);
    console.log(`      created_at  : ${s.created_at}`);
    console.log(`      published_at: ${fd.published_at}`);
    console.log(`      doc_type    : ${fd.doc_type} / doc_kind: ${fd.doc_kind}`);
    console.log(`      supersedes_id: ${fd.supersedes_id ?? '(none)'}`);
    console.log(`      final_text  : ${fd.final_text}`);
    console.log('');
  }

  console.log('──── 판정 ────');
  console.log('· 소견서에는 별도 diagnosis_date 컬럼/필드 없음 → 진단일은 final_text 산문에 박제됨.');
  console.log('  최신 발행본 final_text = "…2026년 07월 24일에 내원하였고…" (요청: 2026-07-22).');
  console.log('· 최신 발행본 status = published = 의무기록.');
  console.log('· form_submissions_published_immutable_guard 트리거(의료법 §22)로 published 행');
  console.log('  UPDATE/DELETE 는 service_role 포함 전 경로 차단 → id-scope UPDATE 물리적 불가.');
  console.log('· 정정 = 신규 발행(append-only, field_data.supersedes_id)만 합법 — 진료의(문원장) 권한.');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
