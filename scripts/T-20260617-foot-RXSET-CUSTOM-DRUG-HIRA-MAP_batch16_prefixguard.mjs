/**
 * T-20260617 batch16 — HIRA-INSURANCE-BATCH prefix-guard 회귀검증 (§14 판정3 supervisor 통과조건)
 *
 * 검증 명제: HIRA-/LEGACY- prefix claim_code 는 hira_insurance_sync.mjs(약제급여목록표 EDI 동기화)에서
 *   bare-numeric EDI 코드로 오인·매칭되지 않는다 → 오청구 0. (DA §14: bare 표준코드 적재 NO_GO 의 방어선.)
 *
 * 가드 성격 = ★구조적(structural). 배치 매칭은 `claim_code = ANY($edi_codes::text[])` 정확 문자열 동치.
 *   bare-numeric EDI(예 '202401671')와 prefix 문자열('HIRA-202401671')은 절대 문자열 동치 불가 → 매칭 배제.
 *   즉 별도 가드 코드 추가 불요 — exact-match 자체가 가드. 본 스크립트는 그 불변식을 회귀로 고정한다.
 *
 * 검증:
 *   [S] 정적: 배치/lib 에 claim_code prefix-strip/substring/normalize 경로 부재(오염 시 fail).
 *   [L] 논리: 배치 병합 로직(exact-match ANY) 미러 시뮬레이션 — worst-case(품목기준코드 numeric 이
 *       타 약 EDI 로 존재) 에서도 우리 HIRA-/LEGACY- 코드 전건 unmatched(=미청구).
 *   [P] 산출: 본 배치 신규 claim_code 13건 전부 HIRA- prefix(bare 0).
 *
 * NO DB / NO xlsx 의존 — 순수 불변식 검증.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OFFICIALS, CUSTOMS, CLAIM } from './T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP_batch16_mapping.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
let fail = 0;
const ok = (b, msg) => { console.log(`  ${b ? '✅' : '❌'} ${msg}`); if (!b) fail++; };

console.log('# batch16 prefix-guard 회귀검증 (§14 판정3)');
console.log('');

// [S] 정적 — batch/lib 에 prefix-strip 경로 부재
console.log('[S] 정적: claim_code prefix-strip/substring/normalize 부재');
const batchSrc = readFileSync(join(REPO, 'scripts', 'hira_insurance_sync.mjs'), 'utf8');
const libSrc = readFileSync(join(REPO, 'src', 'lib', 'hiraInsurance.ts'), 'utf8');
// 배치 매칭 = 정확 동치 ANY() 인지
ok(/claim_code\s*=\s*ANY\(/.test(batchSrc), "배치 매칭 = `claim_code = ANY($::text[])` 정확 동치(부분/prefix 매칭 아님)");
// claim_code 에 대한 prefix 제거/치환 흔적 부재
const danger = /claim_code[^\n]*\.(replace|slice|substring|substr|split)\(|(replace|slice|substring)\([^)]*claim_code/;
ok(!danger.test(batchSrc), '배치에 claim_code prefix-strip/substring 부재');
ok(!/HIRA-|LEGACY-/.test(batchSrc) || !/replace\(\s*\/(HIRA|LEGACY)/.test(batchSrc), '배치에 HIRA-/LEGACY- prefix 제거 정규식 부재');
ok(!danger.test(libSrc), 'hiraInsurance.ts(canonical 병합)에 claim_code prefix-strip 부재');

// [L] 논리 — 배치 exact-match ANY 미러 시뮬레이션
console.log('');
console.log('[L] 논리: 배치 exact-match 미러 — worst-case 에서 우리 코드 전건 unmatched');
// 배치 미러: parsed(EDI codes) 와 prescription_codes.claim_code 를 정확 문자열로 교집합.
function batchMatch(ediCodes, claimCodes) {
  const ediSet = new Set(ediCodes.map((c) => String(c).trim()));
  return claimCodes.filter((cc) => ediSet.has(String(cc).trim())); // = 매칭(=급여동기화 대상)
}
const ourNewClaims = OFFICIALS.map(CLAIM);              // HIRA-{품목} 13건
const ourLegacy = CUSTOMS.map((c) => c.legacy);         // LEGACY- 19→16 custom
// worst-case EDI 세트: 우리 품목기준코드 numeric 이 '타 약 EDI 코드'로 목록표에 존재한다고 가정(최악)
const worstEdi = [
  ...OFFICIALS.map((o) => o.pumok),   // bare 품목기준코드 9자리(=타 약 EDI 로 가정)
  ...OFFICIALS.map((o) => o.std13),   // bare 표준코드 13자리
  '202401671', '198501225', '641601300', // 임의 bare EDI 샘플
];
const matchedNew = batchMatch(worstEdi, ourNewClaims);
const matchedLegacy = batchMatch(worstEdi, ourLegacy);
ok(matchedNew.length === 0, `신규 HIRA- 코드 13건: worst-case EDI(품목/표준 bare 포함)에도 매칭 0 (실제 ${matchedNew.length}) — 오청구 배제`);
ok(matchedLegacy.length === 0, `기존 LEGACY- 코드: worst-case EDI 에도 매칭 0 (실제 ${matchedLegacy.length})`);
// 대조군: bare 로 적재했다면 매칭됐을 것(가드 실효성 입증)
const ifBare = batchMatch(worstEdi, OFFICIALS.map((o) => o.pumok));
ok(ifBare.length === OFFICIALS.length, `대조군: bare 품목코드 적재 시 전건 매칭(${ifBare.length}/13) — ★prefix 가 정확히 이 오청구를 차단함`);

// [P] 산출물 — 신규 claim_code 전건 HIRA- prefix
console.log('');
console.log('[P] 산출물: 신규 claim_code 13건 전부 HIRA- prefix(bare 0)');
const bareNew = ourNewClaims.filter((c) => !/^HIRA-/.test(c));
ok(bareNew.length === 0, `bare(prefix 없는) 신규 claim_code = ${bareNew.length}건 (기대 0). 목록: ${ourNewClaims.join(', ')}`);

console.log('');
console.log(fail === 0
  ? '## 판정: ✅ prefix-guard PRESENT (구조적 exact-match) — 가드 추가 불요, Case2b 선행조건 충족'
  : `## 판정: ❌ ${fail}건 실패 — 가드 부재/오염, 가드 추가가 apply 선행`);
process.exit(fail === 0 ? 0 : 2);
