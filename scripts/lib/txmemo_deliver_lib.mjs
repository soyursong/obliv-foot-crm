/**
 * txmemo_deliver_lib.mjs — TXMEMO 경과분석 추출 계보 "배송 포맷" 공용 모듈 (재사용)
 *
 * 티켓: T-20260822-foot-TXMEMO-EXPORT-INDIVIDUAL-MD-NOZIP
 *   문지은 대표원장(U0ALGAAAJAV) 요청: "zip 말고 개별 마크다운저장도 가능하게
 *   (zip 풀린형태로 모든 마크다운 일괄다운)".
 *
 * 계보: T-20260820-foot-TXMEMO-3VISIT-...-5SEC-CLINITEXT(e93671c1) ·
 *       T-20260821-foot-TXMEMO-6MULTIPLE-PROGRESS-MD-ZIP(5d6b4dd3).
 *   두 계보 스크립트는 이미 환자별 5섹션 .md 를 MD_DIR 에 **개별 파일로 기록한 뒤**
 *   그 디렉토리를 단일 ZIP 으로 묶어 배송한다. 개별 .md 는 이미 disk 에 존재.
 *
 * ── 이 모듈의 델타 (배송 포맷 only · additive) ──
 *   · 단일 ZIP 배송 → 개별 .md 파일 "압축 안 푼 형태" 일괄 배송 옵션 추가.
 *   · ZIP 배송 능력 **존치**(additive). 두 포맷 모두 가능.
 *   · 추출 로직·5섹션 포맷·행정헤더·파일명 규칙(차트번호_이름.md)은 **무접촉**.
 *     이 모듈은 이미 materialize 된 MD_DIR 만 읽어 배송계획을 세운다(재가공 0·byte-exact).
 *
 * ── GATE (계보 승계) ──
 *   · read-only · script_only · DB write 0 · 외부 AI 0 → supervisor QA/GO-token 무대상.
 *   · PHI delivery firewall (da_decision_foot_txmemo_clinitext_extract_lineage_delivery_std_20260820,
 *     T3 self-export): 요청자=집도 custodian 본인(문지은 대표원장) 단독 · private thread ·
 *     no-broadcast · byte-exact · 외부 AI 미경유. 배송 포맷 shift 는 T3 §STANDARD §1
 *     "format/channel shift" 로 명시 acceptable(신규 disclosure 아님).
 *
 * ⚠ 이 모듈은 .md 내용을 **절대 수정하지 않는다**(byte-exact). 배송 형태만 결정한다.
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

// 슬랙 단일 메시지(스레드 1건)에 첨부 가능한 파일 수 상한.
// files.completeUploadExternal 은 호출당 최대 10개 파일을 1개 메시지로 게시.
// → 개별 .md 가 이 값을 넘으면 (A)안(단일 메시지 일괄 첨부) 비현실적 → (B)안 fallback.
export const SLACK_MSG_FILE_LIMIT = 10;

/**
 * MD_DIR 안의 개별 .md 파일을 열거(byte-exact·정렬). 내용 무수정.
 * _요약_INDEX.md 는 index 로 분리 태깅(개별 환자 파일과 구분).
 * @returns {{ files: Array<{name,path,bytes,isIndex}>, patientCount:number, indexCount:number, totalBytes:number }}
 */
export function enumerateIndividualMds(mdDir) {
  if (!existsSync(mdDir) || !statSync(mdDir).isDirectory()) {
    throw new Error(`MD_DIR 없음/디렉토리 아님: ${mdDir}`);
  }
  const files = readdirSync(mdDir)
    .filter((n) => n.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .map((name) => {
      const p = path.join(mdDir, name);
      const bytes = statSync(p).size;
      // 요약 인덱스(계보 관례: '_요약_INDEX.md' / '_INDEX' 접두/'요약' 포함)
      const isIndex = /^_|index|요약/i.test(name);
      return { name, path: p, bytes, isIndex };
    });
  if (files.length === 0) throw new Error(`개별 .md 0건: ${mdDir}`);
  const patientCount = files.filter((f) => !f.isIndex).length;
  const indexCount = files.filter((f) => f.isIndex).length;
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
  return { files, patientCount, indexCount, totalBytes };
}

/**
 * 배송계획: 파일 수 대비 슬랙 첨부 한도로 (A)안/(B)안 결정.
 *  (A) 개별 .md 단일 스레드 메시지에 일괄 첨부 (file 수 ≤ limit).
 *  (B) file 수 > limit → 단일 메시지 일괄 첨부 비현실적:
 *      - ZIP 병행(계보 존치) + "압축 안 푼 형태로 바로 열람" 대안(폴더/다중 메시지 배치) 제시.
 *      - 원장 confirm 필요(발톱채널 §8 v4.1 억제창 준수 · planner 조율).
 * @returns {{ mode:'A'|'B', deliverable:string[], zipParallel:boolean, batches:number, reason:string }}
 */
export function planDelivery(enumResult, { fileLimit = SLACK_MSG_FILE_LIMIT } = {}) {
  const all = enumResult.files.map((f) => f.path);
  const n = all.length;
  if (n <= fileLimit) {
    return {
      mode: 'A',
      deliverable: all,
      zipParallel: false,
      batches: 1,
      reason: `개별 .md ${n}건 ≤ 슬랙 단일메시지 첨부한도(${fileLimit}) → 단일 스레드 메시지에 일괄 첨부(A안).`,
    };
  }
  return {
    mode: 'B',
    deliverable: all,
    zipParallel: true,
    batches: Math.ceil(n / fileLimit),
    reason:
      `개별 .md ${n}건 > 슬랙 단일메시지 첨부한도(${fileLimit}) → 단일메시지 일괄첨부 비현실적(B안). ` +
      `대안: ZIP 병행(계보 존치) + "압축 안 푼 개별 열람" 위해 ${Math.ceil(n / fileLimit)}개 배치(메시지당 ≤${fileLimit}건) 분할 첨부. ` +
      `원장 confirm 필요(planner 조율 · 발톱채널 §8 v4.1 억제창 준수).`,
  };
}

/**
 * ZIP 배송 능력 존치(additive). 계보 스크립트와 동일하게 MD_DIR 를 묶는다.
 * 내용 무수정 — 이미 기록된 .md 를 zip 만 함.
 * @returns {string} zip 절대경로
 */
export function packageZipAdditive(outRoot, mdDirName) {
  const zipPath = path.join(outRoot, `${mdDirName}.zip`);
  execSync(
    `cd ${JSON.stringify(outRoot)} && rm -f ${JSON.stringify(mdDirName + '.zip')} && ` +
      `zip -r -q ${JSON.stringify(mdDirName + '.zip')} ${JSON.stringify(mdDirName)}`,
    { stdio: 'inherit' }
  );
  return zipPath;
}

/**
 * PHI delivery firewall 배너(집행 리마인더). 배송 실행 주체(planner/responder)가
 * 반드시 준수해야 하는 T3 self-export 조건을 산출 로그에 명시(감사기록).
 */
export function firewallBanner({ recipientName = '문지은 대표원장', recipientId = 'U0ALGAAAJAV', channel = 'C0ATE5P6JTH' } = {}) {
  return [
    '─────────────────────────────────────────────────────────',
    '⚠ PHI DELIVERY FIREWALL (T3 self-export · 계보 승계 · MANDATORY)',
    `  · 수령자 단독      : ${recipientName} (${recipientId}) — 집도 임상 custodian 본인`,
    `  · 채널            : ${channel} 원장 단독 스레드 ONLY · no-broadcast · 공개 금지`,
    '  · byte-exact      : .md 내용 무수정(재가공 0) · 개별 파일 그대로 전달',
    '  · 외부 AI 미경유   : LLM/doAI 등 외부 반출 0',
    '  · 개별 md 다수 노출 시에도 firewall 불변 — 원장 단독 스레드에만 첨부',
    '─────────────────────────────────────────────────────────',
  ].join('\n');
}

/**
 * 배송 manifest(감사기록·조용한 누락 금지). 실제 슬랙 업로드는 planner/responder(장쳰 봇) 경유.
 * 이 함수는 "무엇을 어떤 포맷으로 배송할지" 계획서만 문자열로 생성한다.
 */
export function buildManifest({ enumResult, plan, zipPath = null, ticket }) {
  const L = [];
  L.push(`# 배송 manifest — ${ticket}`);
  L.push('');
  L.push('## 배송 포맷 (델타: 단일 ZIP → 개별 .md 일괄 · ZIP 존치 additive)');
  L.push(`- 배송 모드: ${plan.mode}안`);
  L.push(`- 사유: ${plan.reason}`);
  L.push(`- 개별 .md: 환자 ${enumResult.patientCount}건 + 인덱스 ${enumResult.indexCount}건 = 총 ${enumResult.files.length}건 (${(enumResult.totalBytes / 1024).toFixed(1)} KB)`);
  if (plan.mode === 'B') L.push(`- 분할 배치: ${plan.batches}개 (메시지당 ≤${SLACK_MSG_FILE_LIMIT}건)`);
  if (zipPath) L.push(`- ZIP(존치·병행): ${zipPath}`);
  L.push('');
  L.push('## 개별 .md 목록 (byte-exact · 내용 무수정)');
  for (const f of enumResult.files) L.push(`- ${f.isIndex ? '[index] ' : ''}${f.name} (${f.bytes} B)`);
  L.push('');
  L.push('## firewall');
  L.push('```');
  L.push(firewallBanner());
  L.push('```');
  return L.join('\n');
}
