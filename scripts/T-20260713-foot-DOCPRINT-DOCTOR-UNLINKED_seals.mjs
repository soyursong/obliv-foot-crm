/**
 * T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED ❷ — 원장 3인 네모 도장(성함+印) 에셋 생성·업로드·세팅
 *
 * 대표 설계 스펙(F0BGR7XAPDZ 예시 기준): 붉은 네모 인장, 전통 인장 스타일.
 *   네모 테두리 + 세로 2단(성함 위 / 印 아래). 진료의 record와 1:1(오매핑 0 — 법적 정확성 최우선).
 *
 * 사용:
 *   node scripts/T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED_seals.mjs gen     # PNG만 생성(로컬)
 *   node scripts/T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED_seals.mjs dry     # gen + upload/DB 계획 출력(무변경)
 *   node scripts/T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED_seals.mjs apply   # gen + storage 업로드 + seal_image_url 세팅
 *   node scripts/T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED_seals.mjs verify  # 현재 3행 seal_image_url + signed URL 확인
 *   node scripts/T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED_seals.mjs rollback # 3행 seal_image_url=NULL 복구(에셋은 storage 잔존)
 *
 * 매핑 정확성: clinic_doctors.id(=치료테이블 treating_doctor_id FK) 기준 1:1. 이름은 검증용으로만 대조.
 */
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.+)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const URL = process.env.VITE_SUPABASE_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('❌ SUPABASE_SERVICE_ROLE_KEY 필요'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot (오블리브의원 서울 오리진점)
// AC-4 대상 3인. id는 apply 직전 DB에서 이름으로 재조회해 확정(하드코딩 id 방지).
const TARGET_NAMES = ['한동훈', '김윤기', '김상은'];
const OUT_DIR = path.join(REPO, 'src/assets/forms/stamps');

/** 전통 붉은 네모 인장 HTML — 네모 테두리 + 세로 2단(성함 위/印 아래) */
function sealHtml(name) {
  // 성함 글자 크기: 2~3자 대응(3자는 약간 축소해 한 줄 유지).
  const nameSize = name.length >= 3 ? 74 : 92;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html,body { background:transparent; }
    #seal {
      width:360px; height:360px; background:transparent;
      display:flex; align-items:center; justify-content:center;
    }
    .frame {
      width:320px; height:320px; border:12px solid #C8102E; border-radius:10px;
      position:relative; display:flex; flex-direction:column;
      font-family:'AppleMyungjo','Nanum Myeongjo','Batang',serif; color:#C8102E;
    }
    .frame::after { /* 이중 테두리(전통 인장 느낌) */
      content:''; position:absolute; inset:8px; border:3px solid #C8102E; border-radius:6px;
    }
    .tier-name { flex:1.35; display:flex; align-items:center; justify-content:center; }
    .tier-name .chars { font-weight:800; font-size:${nameSize}px; letter-spacing:6px; line-height:1; }
    .divider { height:0; border-top:3px solid #C8102E; margin:0 26px; }
    .tier-mark { flex:1; display:flex; align-items:center; justify-content:center; }
    .tier-mark .mark { font-weight:800; font-size:118px; line-height:1; }
  </style></head><body>
    <div id="seal"><div class="frame">
      <div class="tier-name"><div class="chars">${name}</div></div>
      <div class="divider"></div>
      <div class="tier-mark"><div class="mark">印</div></div>
    </div></div>
  </body></html>`;
}

async function generate() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 360, height: 360 }, deviceScaleFactor: 2 });
  const files = {};
  for (const name of TARGET_NAMES) {
    await page.setContent(sealHtml(name));
    const el = await page.$('#seal');
    const file = path.join(OUT_DIR, `doctor-seal-${name}.png`);
    await el.screenshot({ path: file, omitBackground: true });
    files[name] = file;
    console.log(`  ✅ 생성: ${path.relative(REPO, file)} (${fs.statSync(file).size} bytes)`);
  }
  await browser.close();
  return files;
}

async function resolveDoctors() {
  const { data, error } = await sb.from('clinic_doctors')
    .select('id,name,seal_image_url,active')
    .eq('clinic_id', CLINIC_ID).in('name', TARGET_NAMES);
  if (error) throw new Error(error.message);
  const byName = Object.fromEntries((data || []).map((d) => [d.name, d]));
  for (const n of TARGET_NAMES) {
    if (!byName[n]) throw new Error(`clinic_doctors에 '${n}' 없음 — 매핑 불가(중단)`);
  }
  return byName;
}

async function upload(files, byName) {
  for (const name of TARGET_NAMES) {
    const d = byName[name];
    const storagePath = `seals/${CLINIC_ID}/${d.id}.png`;
    const buf = fs.readFileSync(files[name]);
    const { error } = await sb.storage.from('documents').upload(storagePath, buf, { upsert: true, contentType: 'image/png' });
    if (error) throw new Error(`업로드 실패(${name}): ${error.message}`);
    const { error: uerr } = await sb.from('clinic_doctors').update({ seal_image_url: storagePath }).eq('id', d.id);
    if (uerr) throw new Error(`seal_image_url 세팅 실패(${name}): ${uerr.message}`);
    console.log(`  ✅ ${name} (id=${d.id}) → seal_image_url=${storagePath}`);
  }
}

async function verify() {
  const byName = await resolveDoctors();
  for (const name of TARGET_NAMES) {
    const d = byName[name];
    let signed = '(none)';
    if (d.seal_image_url) {
      const { data } = await sb.storage.from('documents').createSignedUrl(d.seal_image_url, 60);
      signed = data?.signedUrl ? 'signed OK' : 'signed FAIL';
    }
    console.log(`  ${name}: seal_image_url=${d.seal_image_url || 'NULL'} [${signed}]`);
  }
}

async function rollback() {
  const byName = await resolveDoctors();
  for (const name of TARGET_NAMES) {
    const { error } = await sb.from('clinic_doctors').update({ seal_image_url: null }).eq('id', byName[name].id);
    if (error) throw new Error(`rollback 실패(${name}): ${error.message}`);
    console.log(`  ↩ ${name} (id=${byName[name].id}) seal_image_url=NULL`);
  }
}

const cmd = process.argv[2] || 'gen';
console.log(`[seals] cmd=${cmd} clinic=${CLINIC_ID} targets=${TARGET_NAMES.join(',')}`);
if (cmd === 'gen') { await generate(); }
else if (cmd === 'dry') {
  const files = await generate();
  const byName = await resolveDoctors();
  console.log('  [dry-run] 계획 (무변경):');
  for (const name of TARGET_NAMES) console.log(`    ${name} id=${byName[name].id} → upload seals/${CLINIC_ID}/${byName[name].id}.png + set seal_image_url. 현재=${byName[name].seal_image_url || 'NULL'}`);
}
else if (cmd === 'apply') {
  const files = await generate();
  const byName = await resolveDoctors();
  await upload(files, byName);
  console.log('  --- 사후 검증 ---');
  await verify();
}
else if (cmd === 'verify') { await verify(); }
else if (cmd === 'rollback') { await rollback(); }
else { console.error('알 수 없는 cmd'); process.exit(1); }
console.log('[seals] done.');
