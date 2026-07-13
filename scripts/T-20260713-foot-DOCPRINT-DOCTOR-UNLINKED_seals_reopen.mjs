/**
 * T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [REOPEN field-soak] —
 *   대표원장(문지은) 네모 도장 추가 + is_default(요양기관 대표) 지정.
 *
 * 배경(현장 라이브 재현): 치료테이블 미지정 + 복수 근무일이면 서류 진료의/대표자가 대표원장으로
 *   폴백된다(autoBindContext REOPEN 수정). 대표원장(문지은)에게 도장이 없어 붉은 인장이 안 찍히던
 *   근본원인을 해소한다. 3인(한동훈·김윤기·김상은)은 旣 apply 완료 — 여기선 대표원장 1인만 추가.
 *
 * 사용:
 *   node scripts/..._seals_reopen.mjs gen      # 문지은 PNG 생성(로컬)
 *   node scripts/..._seals_reopen.mjs apply    # gen + storage 업로드 + seal_image_url + is_default 세팅
 *   node scripts/..._seals_reopen.mjs verify    # 4행 seal_image_url + is_default + signed URL 확인
 *   node scripts/..._seals_reopen.mjs rollback  # 문지은 seal_image_url=NULL + is_default=false 복구
 *
 * db_change=false — seal_image_url·is_default 모두 旣존 컬럼(DDL 0). 도장↔원장 1:1(오매핑 0).
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

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const REP_NAME = '문지은'; // 대표원장 = 요양기관 대표(is_default)
const OUT_DIR = path.join(REPO, 'src/assets/forms/stamps');

/** 전통 붉은 네모 인장 HTML — 원본 seals.mjs와 동일 스타일(성함 위/印 아래) */
function sealHtml(name) {
  const nameSize = name.length >= 3 ? 74 : 92;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html,body { background:transparent; }
    #seal { width:360px; height:360px; background:transparent; display:flex; align-items:center; justify-content:center; }
    .frame { width:320px; height:320px; border:12px solid #C8102E; border-radius:10px; position:relative; display:flex; flex-direction:column; font-family:'AppleMyungjo','Nanum Myeongjo','Batang',serif; color:#C8102E; }
    .frame::after { content:''; position:absolute; inset:8px; border:3px solid #C8102E; border-radius:6px; }
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
  await page.setContent(sealHtml(REP_NAME));
  const el = await page.$('#seal');
  const file = path.join(OUT_DIR, `doctor-seal-${REP_NAME}.png`);
  await el.screenshot({ path: file, omitBackground: true });
  console.log(`  ✅ 생성: ${path.relative(REPO, file)} (${fs.statSync(file).size} bytes)`);
  await browser.close();
  return file;
}

async function resolveRep() {
  const { data, error } = await sb.from('clinic_doctors')
    .select('id,name,seal_image_url,is_default,active')
    .eq('clinic_id', CLINIC_ID).eq('name', REP_NAME).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`clinic_doctors에 '${REP_NAME}' 없음 — 중단`);
  return data;
}

async function apply() {
  const file = await generate();
  const rep = await resolveRep();
  const storagePath = `seals/${CLINIC_ID}/${rep.id}.png`;
  const buf = fs.readFileSync(file);
  const up = await sb.storage.from('documents').upload(storagePath, buf, { upsert: true, contentType: 'image/png' });
  if (up.error) throw new Error(`업로드 실패: ${up.error.message}`);
  const s = await sb.from('clinic_doctors').update({ seal_image_url: storagePath }).eq('id', rep.id);
  if (s.error) throw new Error(`seal_image_url 세팅 실패: ${s.error.message}`);
  // is_default 단일화: 대표원장만 true, 나머지 false (결정론적 폴백)
  const clr = await sb.from('clinic_doctors').update({ is_default: false }).eq('clinic_id', CLINIC_ID).neq('id', rep.id);
  if (clr.error) throw new Error(`is_default 초기화 실패: ${clr.error.message}`);
  const setDef = await sb.from('clinic_doctors').update({ is_default: true }).eq('id', rep.id);
  if (setDef.error) throw new Error(`is_default 세팅 실패: ${setDef.error.message}`);
  console.log(`  ✅ ${REP_NAME} (id=${rep.id}) → seal=${storagePath}, is_default=true`);
  await verify();
}

async function verify() {
  const { data } = await sb.from('clinic_doctors')
    .select('name,seal_image_url,is_default').eq('clinic_id', CLINIC_ID).order('sort_order');
  for (const d of data ?? []) {
    let signed = '(none)';
    if (d.seal_image_url) {
      const { data: s } = await sb.storage.from('documents').createSignedUrl(d.seal_image_url, 60);
      signed = s?.signedUrl ? 'signed OK' : 'signed FAIL';
    }
    console.log(`  ${d.name}: seal=${d.seal_image_url || 'NULL'} [${signed}] is_default=${d.is_default}`);
  }
}

async function rollback() {
  const rep = await resolveRep();
  await sb.from('clinic_doctors').update({ seal_image_url: null, is_default: false }).eq('id', rep.id);
  console.log(`  ↩ ${REP_NAME} seal_image_url=NULL, is_default=false`);
}

const cmd = process.argv[2] || 'gen';
console.log(`[seals-reopen] cmd=${cmd} clinic=${CLINIC_ID} rep=${REP_NAME}`);
if (cmd === 'gen') await generate();
else if (cmd === 'apply') await apply();
else if (cmd === 'verify') await verify();
else if (cmd === 'rollback') await rollback();
else { console.error('알 수 없는 cmd'); process.exit(1); }
console.log('[seals-reopen] done.');
