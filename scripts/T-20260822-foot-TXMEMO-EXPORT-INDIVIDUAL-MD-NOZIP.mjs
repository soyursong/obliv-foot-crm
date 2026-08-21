#!/usr/bin/env node
/**
 * T-20260822-foot-TXMEMO-EXPORT-INDIVIDUAL-MD-NOZIP
 *   경과분석 개별 마크다운 일괄 배송 (zip 미압축) — 배송 포맷 델타 CLI
 *
 * 문지은 대표원장(U0ALGAAAJAV·발톱채널 C0ATE5P6JTH) 요청:
 *   "zip 말고 개별 마크다운저장도 가능하게 (zip 풀린형태로 모든 마크다운 일괄다운)"
 *
 * ── 무엇을 하나 ──
 *   TXMEMO 경과분석 추출 계보(5SEC-CLINITEXT e93671c1 · 6MULTIPLE 5d6b4dd3)가
 *   이미 MD_DIR 에 기록한 **환자별 개별 .md** 를 읽어(byte-exact·재가공 0):
 *     1) 개별 .md 를 "압축 안 푼 형태" 로 일괄 배송할 계획을 세우고(A안),
 *     2) 파일 수가 슬랙 단일메시지 첨부한도(10)를 넘으면 대안(B안) 제시,
 *     3) ZIP 배송 능력은 존치(--zip · additive),
 *     4) PHI delivery firewall 배너 + 배송 manifest 를 출력한다(감사기록).
 *
 * ── 무엇을 안 하나 (계보 무접촉) ──
 *   · 추출 로직·5섹션 포맷·행정헤더·파일명 규칙 무접촉(이미 만들어진 .md 만 읽음).
 *   · DB 접근 0(read-only 넘어 DB 무접촉)·외부 AI 0·prod write/DDL 0.
 *   · .md 내용 무수정(byte-exact).
 *   · 실제 슬랙 업로드는 planner/responder(장쳰 봇) 경유 — 이 CLI 는 배송계획서만 산출.
 *
 * ── 사용법 ──
 *   node scripts/T-20260822-foot-TXMEMO-EXPORT-INDIVIDUAL-MD-NOZIP.mjs <MD_DIR> [--zip] [--limit N]
 *   예) node scripts/T-...-NOZIP.mjs _artifacts/T-20260821-foot-TXMEMO-6MULTIPLE-PROGRESS-MD-ZIP/foot_경과분석_6배수회차도래 --zip
 *
 *   <MD_DIR> 미지정 시 _artifacts/ 하위 계보 산출 MD_DIR 후보를 자동 탐색해 안내.
 *
 * GATE: read-only · script_only · DB write 0 · 외부 AI 0 → supervisor QA/GO-token 무대상.
 */
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  enumerateIndividualMds,
  planDelivery,
  packageZipAdditive,
  firewallBanner,
  buildManifest,
  SLACK_MSG_FILE_LIMIT,
} from './lib/txmemo_deliver_lib.mjs';

const TICKET = 'T-20260822-foot-TXMEMO-EXPORT-INDIVIDUAL-MD-NOZIP';
const ARTIFACT_ROOT = path.join(process.cwd(), '_artifacts');

function findCandidateMdDirs() {
  if (!existsSync(ARTIFACT_ROOT)) return [];
  const out = [];
  for (const t of readdirSync(ARTIFACT_ROOT)) {
    if (!/TXMEMO|PROGANALYSIS/i.test(t)) continue;
    const troot = path.join(ARTIFACT_ROOT, t);
    if (!statSync(troot).isDirectory()) continue;
    for (const sub of readdirSync(troot)) {
      const p = path.join(troot, sub);
      if (statSync(p).isDirectory() && readdirSync(p).some((f) => f.toLowerCase().endsWith('.md'))) {
        out.push(p);
      }
    }
  }
  return out;
}

(function main() {
  const args = process.argv.slice(2);
  const doZip = args.includes('--zip');
  const limIdx = args.indexOf('--limit');
  const fileLimit = limIdx >= 0 ? Number(args[limIdx + 1]) : SLACK_MSG_FILE_LIMIT;
  const mdDirArg = args.find((a) => !a.startsWith('--') && a !== String(fileLimit));

  console.log(`=== ${TICKET} — 개별 .md 일괄 배송 계획 (zip 미압축) ===\n`);

  let mdDir = mdDirArg;
  if (!mdDir) {
    const cands = findCandidateMdDirs();
    if (cands.length === 0) {
      console.error('MD_DIR 미지정 & _artifacts/ 에서 계보 산출 MD_DIR 후보를 못 찾음.');
      console.error('먼저 계보 추출 스크립트를 실행해 개별 .md 를 생성한 뒤, 그 MD_DIR 경로를 인자로 주세요.');
      console.error('예) node scripts/T-20260821-foot-TXMEMO-6MULTIPLE-PROGRESS-MD-ZIP.mjs');
      process.exit(1);
    }
    console.log('MD_DIR 미지정 — _artifacts/ 계보 산출 후보:');
    cands.forEach((c, i) => console.log(`  [${i}] ${path.relative(process.cwd(), c)}`));
    mdDir = cands[cands.length - 1]; // 가장 최근 티켓(정렬상 마지막) 자동 선택
    console.log(`\n→ 자동 선택: ${path.relative(process.cwd(), mdDir)} (명시하려면 인자로 경로 지정)\n`);
  }
  mdDir = path.resolve(mdDir);

  const enumResult = enumerateIndividualMds(mdDir);
  const plan = planDelivery(enumResult, { fileLimit });

  console.log(firewallBanner());
  console.log('');
  console.log(`MD_DIR            : ${mdDir}`);
  console.log(`개별 .md          : 환자 ${enumResult.patientCount}건 + 인덱스 ${enumResult.indexCount}건 = 총 ${enumResult.files.length}건`);
  console.log(`합계 용량         : ${(enumResult.totalBytes / 1024).toFixed(1)} KB`);
  console.log(`슬랙 첨부 한도     : ${fileLimit} (단일 메시지)`);
  console.log(`배송 모드         : ${plan.mode}안`);
  console.log(`사유              : ${plan.reason}`);
  console.log('');

  let zipPath = null;
  if (doZip || plan.mode === 'B') {
    // (A) --zip 명시 시 존치 배송 / (B) 파일 수 초과 시 ZIP 병행(계보 존치)
    const outRoot = path.dirname(mdDir);
    zipPath = packageZipAdditive(outRoot, path.basename(mdDir));
    console.log(`ZIP(존치·병행)     : ${zipPath}`);
    console.log('');
  }

  const manifest = buildManifest({ enumResult, plan, zipPath, ticket: TICKET });
  const manifestPath = path.join(path.dirname(mdDir), '_배송_manifest.md');
  writeFileSync(manifestPath, manifest, 'utf8');
  console.log(`배송 manifest      : ${manifestPath}`);
  console.log('');

  console.log('=== 배송 실행 안내 (planner/responder·장쳰 봇 경유) ===');
  if (plan.mode === 'A') {
    console.log(`· A안: 아래 개별 .md ${enumResult.files.length}건을 원장 단독 스레드 1개 메시지에 일괄 첨부.`);
    enumResult.files.forEach((f) => console.log(`    - ${f.path}`));
  } else {
    console.log(`· B안: 개별 .md ${enumResult.files.length}건 > 한도 ${fileLimit} → 단일메시지 일괄첨부 비현실적.`);
    console.log(`    권장: (1) ZIP 병행 배송(위 zip) + (2) 개별 .md 를 ${plan.batches}개 배치(메시지당 ≤${fileLimit}건)로 순차 첨부.`);
    console.log('    → 어느 방식을 원장이 선호하는지 planner 조율로 confirm 후 배송(발톱채널 §8 v4.1 억제창 준수).');
  }
  console.log('\n⚠ 실제 배송은 원장 단독 스레드에만 · no-broadcast · byte-exact · 외부 AI 미경유.');
})();
