/**
 * T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [REOPEN2] — 현장 확정 도장 3종 asset-swap.
 * 김주연 총괄 "맨처음에 보냈던 시안으로 반영" 지시 → 한동훈/김윤기/김상은 storage seal을
 * 현장 확정 소스(~/file_inbox/20260714/seal-{name}.png)로 결정론적 재기록.
 * seal_image_url 스토리지 경로 무변경(upsert 동일 path) — 위치·경로 무변경, DDL 0, 컬럼값 불변.
 * 대표원장(문지은) is_default seal은 무변경(AC-6 폴백 유지).
 *
 * 사용:
 *   node ..._seal_fieldswap.mjs dry       # 대상·경로·소스해시 검사만(무영속)
 *   node ..._seal_fieldswap.mjs apply     # backup → upsert 현장PNG → verify
 *   node ..._seal_fieldswap.mjs verify    # 3행 storage 바이트 == 현장 소스 대조
 *   node ..._seal_fieldswap.mjs rollback  # backup 원복
 * db_change=false — storage object write only(seal_image_url 컬럼값 불변).
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.+)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const SRC_DIR = path.join(process.env.HOME, 'file_inbox/20260714');
const BK_DIR = path.join(REPO, 'evidence/seal-swap/backup');
const NAMES = ['한동훈', '김윤기', '김상은'];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function rows() {
  const { data, error } = await sb.from('clinic_doctors').select('id,name,seal_image_url').eq('clinic_id', CLINIC).in('name', NAMES);
  if (error) throw new Error(error.message);
  return data;
}
async function dry() {
  for (const name of NAMES) {
    const src = path.join(SRC_DIR, `seal-${name}.png`);
    const ok = fs.existsSync(src);
    const h = ok ? sha(fs.readFileSync(src)).slice(0, 12) : 'MISSING';
    const r = (await rows()).find(x => x.name === name);
    console.log(`  ${name}: src=${ok ? h : 'MISSING'} storagePath=${r?.seal_image_url || 'NULL'}`);
  }
}
async function apply() {
  fs.mkdirSync(BK_DIR, { recursive: true });
  for (const r of await rows()) {
    const src = path.join(SRC_DIR, `seal-${r.name}.png`);
    if (!fs.existsSync(src)) throw new Error(`현장 소스 없음: ${src}`);
    // backup 현행 storage object
    const { data: cur, error: dErr } = await sb.storage.from('documents').download(r.seal_image_url);
    if (!dErr && cur) fs.writeFileSync(path.join(BK_DIR, `${r.name}.png`), Buffer.from(await cur.arrayBuffer()));
    const buf = fs.readFileSync(src);
    const up = await sb.storage.from('documents').upload(r.seal_image_url, buf, { upsert: true, contentType: 'image/png' });
    if (up.error) throw new Error(`${r.name} upsert 실패: ${up.error.message}`);
    console.log(`  ✅ ${r.name} → ${r.seal_image_url} (src ${sha(buf).slice(0, 12)}, ${buf.length}b)`);
  }
  await verify();
}
async function verify() {
  let fail = 0;
  for (const r of await rows()) {
    const { data: blob, error } = await sb.storage.from('documents').download(r.seal_image_url);
    if (error) { console.log(`  ❌ ${r.name} download: ${error.message}`); fail++; continue; }
    const storageH = sha(Buffer.from(await blob.arrayBuffer()));
    const srcH = sha(fs.readFileSync(path.join(SRC_DIR, `seal-${r.name}.png`)));
    const { data: signed } = await sb.storage.from('documents').createSignedUrl(r.seal_image_url, 60);
    const match = storageH === srcH, sok = !!signed?.signedUrl;
    console.log(`  ${match && sok ? '✅' : '❌'} ${r.name}: storage==field=${match} signed=${sok ? 'OK' : 'FAIL'}`);
    if (!(match && sok)) fail++;
  }
  console.log(fail ? `\n❌ verify FAIL ${fail}` : '\n✅ 3/3 storage == 현장 확정 소스 + signed URL OK');
  if (fail) process.exit(1);
}
async function rollback() {
  for (const r of await rows()) {
    const bk = path.join(BK_DIR, `${r.name}.png`);
    if (!fs.existsSync(bk)) { console.log(`  ⚠ ${r.name} backup 없음 — skip`); continue; }
    await sb.storage.from('documents').upload(r.seal_image_url, fs.readFileSync(bk), { upsert: true, contentType: 'image/png' });
    console.log(`  ↩ ${r.name} backup 원복`);
  }
}
const cmd = process.argv[2] || 'dry';
console.log(`[seal-fieldswap] cmd=${cmd}`);
if (cmd === 'dry') await dry();
else if (cmd === 'apply') await apply();
else if (cmd === 'verify') await verify();
else if (cmd === 'rollback') await rollback();
else { console.error('unknown cmd'); process.exit(1); }
