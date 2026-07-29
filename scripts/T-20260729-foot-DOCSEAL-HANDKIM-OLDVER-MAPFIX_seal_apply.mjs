/**
 * T-20260729-foot-DOCSEAL-HANDKIM-OLDVER-MAPFIX — 한동훈·김윤기 원장 직인 신규 통일 asset 매핑 (data-only, DDL 0).
 *
 * 배경: 7/28 ATTENDINGDR-DOC-ATTRIB(deployed)로 실제 진료의 명의·도장 발행이 켜지며 두 원장 seal이
 *   서류에 렌더되기 시작 → 두 seal_image_url 이 통일 前 구 asset(2026-07-13 업로드)을 가리킴이 노출.
 *   SEAL 결선 회귀 아님, seal_image_url '값' 문제.
 *
 * 조치(문지은 T-20260716-DOCFEE-NONPAY-SEAL 선례 동일 패턴):
 *   신규 통일 도장 = 7/15 현장 전달 clean asset batch(BODYPORT).
 *   'documents' bucket seals/{clinic_id}/{uuid}.png 로 업로드 + clinic_doctors.seal_image_url 갱신.
 *   신규 컬럼/테이블/enum 0 → db_change=false 유지.
 *
 * asset SSOT: T-20260715-foot-RECEIPT-REPNAME-SEAL-BODYPORT/foot_seal_{한동훈|김윤기}.png
 *   (문지은 sibling foot_seal_문지은.png 는 7/16 이미 적용되어 prod stored file(97915B)과 byte-identical =
 *    이 batch 가 채택된 통일 seal SSOT 임을 입증. 동일 batch 의 두 원장 asset 을 그대로 적용.)
 *
 * idempotent: seal_image_url 이 이미 신규 asset(SHA256 일치) 파일을 가리키면 no-op.
 * rollback: --rollback → seal_image_url 을 스냅샷된 이전(구 asset) 경로로 복원.
 * dry-run:  --dry → 변경 없이 freeze 스냅샷만 출력.
 *
 * usage:
 *   node scripts/T-20260729-foot-DOCSEAL-HANDKIM-OLDVER-MAPFIX_seal_apply.mjs --dry
 *   node scripts/T-20260729-foot-DOCSEAL-HANDKIM-OLDVER-MAPFIX_seal_apply.mjs           # apply
 *   node scripts/T-20260729-foot-DOCSEAL-HANDKIM-OLDVER-MAPFIX_seal_apply.mjs --rollback
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID, createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const MODE = process.argv.includes('--rollback') ? 'rollback'
  : process.argv.includes('--dry') ? 'dry' : 'apply';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const CLINIC_SLUG = 'jongno-foot';
const BUCKET = 'documents';
const ASSET_DIR = path.join(os.homedir(),
  'claude-sync/memory/_handoff/ticket_assets/T-20260715-foot-RECEIPT-REPNAME-SEAL-BODYPORT');
const TARGETS = [
  { name: '한동훈', asset: path.join(ASSET_DIR, 'foot_seal_한동훈.png') },
  { name: '김윤기', asset: path.join(ASSET_DIR, 'foot_seal_김윤기.png') },
];
// rollback ledger: 적용 전 seal_image_url 을 스냅샷 파일로 기록.
const LEDGER = path.join(os.homedir(),
  'claude-sync/memory/_handoff/ticket_assets/T-20260729-foot-DOCSEAL-HANDKIM-OLDVER-MAPFIX_rollback_ledger.json');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function fetchStoredHash(objPath) {
  if (!objPath) return { size: null, sha256: null, reachable: false };
  const { data, error } = await sb.storage.from(BUCKET).download(objPath);
  if (error || !data) return { size: null, sha256: null, reachable: false, err: error?.message };
  const buf = Buffer.from(await data.arrayBuffer());
  return { size: buf.length, sha256: sha(buf), reachable: true };
}

const { data: clinic } = await sb.from('clinics').select('id,slug,name').eq('slug', CLINIC_SLUG).single();
console.log(`[MODE=${MODE}] clinic=${clinic.slug}(${clinic.id})`);

// ---------- freeze snapshot (BEFORE) ----------
const snapshot = [];
for (const t of TARGETS) {
  const { data: doc } = await sb.from('clinic_doctors')
    .select('id,name,is_default,seal_image_url').eq('clinic_id', clinic.id).eq('name', t.name).single();
  const stored = await fetchStoredHash(doc.seal_image_url);
  const assetBuf = fs.readFileSync(t.asset);
  const assetHash = sha(assetBuf);
  snapshot.push({ ...t, doc, stored, assetSize: assetBuf.length, assetHash });
  console.log(`\n[freeze] ${doc.name} id=${doc.id} is_default=${doc.is_default}`);
  console.log(`  current seal_image_url = ${doc.seal_image_url}`);
  console.log(`  current stored file    = size=${stored.size} sha256=${stored.sha256} reachable=${stored.reachable}`);
  console.log(`  new unified asset      = size=${assetBuf.length} sha256=${assetHash}`);
  console.log(`  differs (old≠new)      = ${stored.sha256 !== assetHash}`);
}

if (MODE === 'dry') { console.log('\n[dry] no change. freeze snapshot above.'); process.exit(0); }

if (MODE === 'rollback') {
  if (!fs.existsSync(LEDGER)) { console.error('[rollback] ledger 없음 — 복원 불가:', LEDGER); process.exit(1); }
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  for (const entry of ledger.targets) {
    const { error } = await sb.from('clinic_doctors')
      .update({ seal_image_url: entry.before_seal_image_url }).eq('id', entry.doc_id);
    if (error) throw error;
    console.log(`[rollback] ${entry.name}.seal_image_url → ${entry.before_seal_image_url}`);
  }
  process.exit(0);
}

// ---------- apply ----------
const ledger = { ticket: 'T-20260729-foot-DOCSEAL-HANDKIM-OLDVER-MAPFIX', clinic_id: clinic.id, targets: [] };
const evidence = { ticket: ledger.ticket, clinic: { id: clinic.id, slug: clinic.slug }, mode: 'apply', targets: [] };

for (const s of snapshot) {
  const { doc } = s;
  // idempotent guard: 이미 신규 asset(SHA 일치) 파일을 가리키면 skip
  if (doc.seal_image_url && s.stored.sha256 === s.assetHash) {
    console.log(`\n[skip] ${doc.name}: 이미 신규 통일 asset 매핑됨 (sha 일치) ${doc.seal_image_url}`);
    ledger.targets.push({ name: doc.name, doc_id: doc.id, before_seal_image_url: doc.seal_image_url, skipped: true });
    evidence.targets.push({ name: doc.name, doc_id: doc.id, action: 'skip', seal_image_url: doc.seal_image_url,
      before_stored: s.stored, new_asset: { size: s.assetSize, sha256: s.assetHash } });
    continue;
  }
  const bytes = fs.readFileSync(s.asset);
  const objPath = `seals/${clinic.id}/${randomUUID()}.png`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(objPath, bytes, { contentType: 'image/png', upsert: false });
  if (upErr) throw upErr;
  console.log(`\n[upload] ${doc.name}: ${s.asset} (${bytes.length}B) → ${BUCKET}/${objPath}`);

  const { error: updErr } = await sb.from('clinic_doctors').update({ seal_image_url: objPath }).eq('id', doc.id);
  if (updErr) throw updErr;

  // verify AFTER
  const { data: v } = await sb.from('clinic_doctors').select('name,seal_image_url').eq('id', doc.id).single();
  const after = await fetchStoredHash(v.seal_image_url);
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(v.seal_image_url, 60);
  console.log(`[verify] ${v.name}.seal_image_url = ${v.seal_image_url}`);
  console.log(`  after stored sha256=${after.sha256} size=${after.size} match-asset=${after.sha256 === s.assetHash} signed=${signed?.signedUrl ? 'YES' : 'NO'}`);

  ledger.targets.push({ name: doc.name, doc_id: doc.id, before_seal_image_url: s.doc.seal_image_url, after_seal_image_url: objPath, skipped: false });
  evidence.targets.push({
    name: doc.name, doc_id: doc.id, action: 'update',
    before: { seal_image_url: s.doc.seal_image_url, stored: s.stored },
    after: { seal_image_url: objPath, stored: after, signed_reachable: !!signed?.signedUrl },
    new_asset: { source: s.asset, size: s.assetSize, sha256: s.assetHash },
    asset_match: after.sha256 === s.assetHash,
  });
}

fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
console.log(`\n[ledger] rollback ledger → ${LEDGER}`);
console.log(`[rollback cmd] node scripts/T-20260729-foot-DOCSEAL-HANDKIM-OLDVER-MAPFIX_seal_apply.mjs --rollback`);

// emit evidence to repo evidence dir
const EVID_DIR = path.join(process.cwd(), 'evidence', 'T-20260729-foot-DOCSEAL-HANDKIM-OLDVER-MAPFIX');
fs.mkdirSync(EVID_DIR, { recursive: true });
const evidPath = path.join(EVID_DIR, 'apply-freeze-verify.json');
fs.writeFileSync(evidPath, JSON.stringify(evidence, null, 2));
console.log(`[evidence] ${evidPath}`);
