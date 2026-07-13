/**
 * T-20260713-foot-DOCPRINT-STAMP-FONT-HANJEON —
 *   원장 3인 네모 도장(성함+印) 폰트만 한전서체(HJ한전서A/B)로 교체 재제작.
 *
 * 승인 시안(F0BGR7XAPDZ) 기준 — 폰트 1축만 변경. 유지 사항:
 *   · 형태: 붉은 네모 이중 테두리
 *   · 배치: 세로 2단(성함 위 / 印 아래) + 가로 divider
 *   · 색: #C8102E (붉은 인장 톤)
 *   · 크기: 360×360 @2x = 720px 소스 → 서류 삽입 시 ≈88×86px
 *   · 진료의↔도장 1:1 매핑(clinic_doctors.id 기준), seal_image_url 컬럼·렌더 경로 무변경
 * 변경 사항: font-family 만 'AppleMyungjo',... → 한전서체.
 *
 * 폰트 조달: HJ한전서A/B는 상용 폰트(로컬 미설치). 폰트 파일(.ttf/.otf)을 받아
 *   @font-face(base64 임베드)로 굽는다 — 시스템 설치 불필요, 런타임 외부 의존 없음(정적 PNG).
 *   FONT_A_FILE / FONT_B_FILE 환경변수(또는 --a= / --b= 인자)로 파일 경로 지정.
 *
 * 사용:
 *   FONT_A_FILE=/path/HJhanjeonA.ttf FONT_B_FILE=/path/HJhanjeonB.ttf \
 *     node scripts/..._seals.mjs gen           # A·B 후보 3종씩 로컬 PNG 생성(시안용, 무DB변경)
 *   FONT_A_FILE=... node scripts/..._seals.mjs gen A     # A 후보만
 *   FONT_A_FILE=... node scripts/..._seals.mjs apply A   # 확정 후보(A)로 storage 재업로드 + seal_image_url 재세팅
 *   node scripts/..._seals.mjs verify          # 3행 seal_image_url + signed URL 라이브 확인
 *
 * db_change=false — seal_image_url 旣존 컬럼 재세팅(DDL 0, 3행 data-write). 도장↔원장 1:1(오매핑 0).
 * apply 전 반드시 gen 시안 → slack thread(1783936723.351989) confirm 받을 것.
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

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot
const TARGET_NAMES = ['한동훈', '김윤기', '김상은']; // AC-4 대상 3인 (문지은 대표원장은 본 티켓 대상 아님)
const OUT_DIR = path.join(REPO, 'src/assets/forms/stamps');

// --- 폰트 파일 경로 해석 (env 또는 --a=/--b= 인자) ---
function argVal(flag) {
  const hit = process.argv.find((a) => a.startsWith(flag));
  return hit ? hit.slice(flag.length) : undefined;
}
const FONT_FILES = {
  A: process.env.FONT_A_FILE || argVal('--a='),
  B: process.env.FONT_B_FILE || argVal('--b='),
};

/** 폰트 파일 → @font-face base64 임베드 CSS 조각. 없으면 시스템 세리프 폴백(경고). */
function fontFace(cand) {
  const fp = FONT_FILES[cand];
  if (!fp) return { css: '', family: "'AppleMyungjo','Nanum Myeongjo','Batang',serif", missing: true };
  if (!fs.existsSync(fp)) throw new Error(`폰트 파일 없음(${cand}): ${fp}`);
  const ext = path.extname(fp).toLowerCase();
  const fmt = ext === '.otf' ? 'opentype' : ext === '.woff2' ? 'woff2' : ext === '.woff' ? 'woff' : 'truetype';
  const b64 = fs.readFileSync(fp).toString('base64');
  const family = `HJhanjeon${cand}`;
  return {
    css: `@font-face{font-family:'${family}';src:url(data:font/${ext.slice(1)};base64,${b64}) format('${fmt}');}`,
    family: `'${family}',serif`,
    missing: false,
  };
}

/** 전통 붉은 네모 인장 HTML — 승인 시안과 형태/배치/색/크기 동일, font-family 만 주입 */
function sealHtml(name, fontCss, fontFamily) {
  const nameSize = name.length >= 3 ? 74 : 92;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${fontCss}
    * { margin:0; padding:0; box-sizing:border-box; }
    html,body { background:transparent; }
    #seal { width:360px; height:360px; background:transparent; display:flex; align-items:center; justify-content:center; }
    .frame { width:320px; height:320px; border:12px solid #C8102E; border-radius:10px; position:relative; display:flex; flex-direction:column; font-family:${fontFamily}; color:#C8102E; }
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

/** cands = ['A'] | ['B'] | ['A','B'] */
async function generate(cands) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 360, height: 360 }, deviceScaleFactor: 2 });
  const files = {};
  for (const cand of cands) {
    const { css, family, missing } = fontFace(cand);
    if (missing) {
      console.warn(`  ⚠️ 후보 ${cand}: 폰트 파일 미지정 → 시스템 세리프 폴백으로 굽습니다(시안 부적합, 최종용 아님).`);
    }
    for (const name of TARGET_NAMES) {
      await page.setContent(sealHtml(name, css, family));
      await page.evaluate(() => document.fonts.ready);
      const el = await page.$('#seal');
      // 시안(gen): 후보 접미사로 구분. 최종(apply): 접미사 없는 정본 파일명.
      const suffix = cands.length > 1 || process.argv[2] === 'gen' ? `-${cand}` : '';
      const file = path.join(OUT_DIR, `doctor-seal-${name}${suffix}.png`);
      await el.screenshot({ path: file, omitBackground: true });
      files[`${cand}:${name}`] = file;
      console.log(`  ✅ 후보 ${cand} / ${name}: ${path.relative(REPO, file)} (${fs.statSync(file).size} bytes)`);
    }
  }
  await browser.close();
  return files;
}

function sb() {
  if (!KEY) { console.error('❌ SUPABASE_SERVICE_ROLE_KEY 필요'); process.exit(1); }
  return createClient(URL, KEY, { auth: { persistSession: false } });
}

async function resolveDoctors(client) {
  const { data, error } = await client.from('clinic_doctors')
    .select('id,name,seal_image_url,active')
    .eq('clinic_id', CLINIC_ID).in('name', TARGET_NAMES);
  if (error) throw new Error(error.message);
  const byName = Object.fromEntries((data || []).map((d) => [d.name, d]));
  for (const n of TARGET_NAMES) if (!byName[n]) throw new Error(`clinic_doctors에 '${n}' 없음 — 매핑 불가(중단)`);
  return byName;
}

async function apply(cand) {
  if (!cand) throw new Error('apply 는 확정 후보(A|B) 인자 필수. 예: apply A');
  if (FONT_FILES[cand] == null) throw new Error(`후보 ${cand} 폰트 파일 미지정 — apply 불가(현장 confirm된 폰트로 재실행)`);
  // 정본 파일명(접미사 없음)으로 재렌더
  const client = sb();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 360, height: 360 }, deviceScaleFactor: 2 });
  const { css, family } = fontFace(cand);
  const byName = await resolveDoctors(client);
  for (const name of TARGET_NAMES) {
    const d = byName[name];
    await page.setContent(sealHtml(name, css, family));
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(OUT_DIR, `doctor-seal-${name}.png`);
    await (await page.$('#seal')).screenshot({ path: file, omitBackground: true });
    const storagePath = `seals/${CLINIC_ID}/${d.id}.png`;
    const buf = fs.readFileSync(file);
    const up = await client.storage.from('documents').upload(storagePath, buf, { upsert: true, contentType: 'image/png' });
    if (up.error) throw new Error(`업로드 실패(${name}): ${up.error.message}`);
    const s = await client.from('clinic_doctors').update({ seal_image_url: storagePath }).eq('id', d.id);
    if (s.error) throw new Error(`seal_image_url 세팅 실패(${name}): ${s.error.message}`);
    console.log(`  ✅ ${name} (id=${d.id}) → seal_image_url=${storagePath} [폰트 후보 ${cand}]`);
  }
  await browser.close();
  console.log('  --- 사후 라이브 검증 ---');
  await verify();
}

async function verify() {
  const client = sb();
  const byName = await resolveDoctors(client);
  for (const name of TARGET_NAMES) {
    const d = byName[name];
    let signed = '(none)';
    if (d.seal_image_url) {
      const { data } = await client.storage.from('documents').createSignedUrl(d.seal_image_url, 60);
      signed = data?.signedUrl ? 'signed OK' : 'signed FAIL';
    }
    console.log(`  ${name}: id=${d.id} seal_image_url=${d.seal_image_url || 'NULL'} [${signed}]`);
  }
}

const cmd = process.argv[2] || 'gen';
const candArg = (process.argv[3] || '').toUpperCase();
console.log(`[hanjeon-seals] cmd=${cmd} cand=${candArg || '(A,B)'} clinic=${CLINIC_ID} targets=${TARGET_NAMES.join(',')}`);
console.log(`[hanjeon-seals] font A=${FONT_FILES.A || '(미지정)'} B=${FONT_FILES.B || '(미지정)'}`);
if (cmd === 'gen') { await generate(candArg ? [candArg] : ['A', 'B']); }
else if (cmd === 'apply') { await apply(candArg); }
else if (cmd === 'verify') { await verify(); }
else { console.error('알 수 없는 cmd (gen|apply|verify)'); process.exit(1); }
console.log('[hanjeon-seals] done.');
