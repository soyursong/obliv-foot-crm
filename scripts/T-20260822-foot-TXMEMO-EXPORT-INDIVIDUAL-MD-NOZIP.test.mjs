// ============================================================================
// T-20260822-foot-TXMEMO-EXPORT-INDIVIDUAL-MD-NOZIP.test.mjs
//   개별 .md 일괄 배송(zip 미압축) 배송포맷 로직 단위 검증 (node --test)
// 실행: node --test scripts/T-20260822-foot-TXMEMO-EXPORT-INDIVIDUAL-MD-NOZIP.test.mjs
//
// GATE: read-only·script_only — 실 PHI 무접촉. tmp 픽스처 .md 로 배송포맷 분기만 검증.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  enumerateIndividualMds,
  planDelivery,
  buildManifest,
  firewallBanner,
  SLACK_MSG_FILE_LIMIT,
} from './lib/txmemo_deliver_lib.mjs';

function makeMdDir(n, { withIndex = true, bytes = 100 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'txmemo-md-'));
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(dir, `C-${1000 + i}_환자${i}.md`), 'x'.repeat(bytes), 'utf8');
  }
  if (withIndex) fs.writeFileSync(path.join(dir, '_요약_INDEX.md'), 'idx', 'utf8');
  return dir;
}

test('enumerate: 환자 파일/인덱스 분리 카운트 + byte-exact 무수정', () => {
  const dir = makeMdDir(3);
  const before = fs.readFileSync(path.join(dir, 'C-1000_환자0.md'), 'utf8');
  const r = enumerateIndividualMds(dir);
  assert.equal(r.patientCount, 3);
  assert.equal(r.indexCount, 1);
  assert.equal(r.files.length, 4);
  // 모듈이 내용 변경 안 함(byte-exact)
  assert.equal(fs.readFileSync(path.join(dir, 'C-1000_환자0.md'), 'utf8'), before);
});

test('enumerate: 빈 디렉토리/부재 → throw', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'txmemo-empty-'));
  assert.throws(() => enumerateIndividualMds(empty), /개별 \.md 0건/);
  assert.throws(() => enumerateIndividualMds('/nope/does/not/exist'), /없음/);
});

test('plan A안: 파일 수 ≤ 한도 → 단일메시지 일괄첨부', () => {
  const dir = makeMdDir(4); // 4 + index = 5 ≤ 10
  const r = enumerateIndividualMds(dir);
  const plan = planDelivery(r);
  assert.equal(plan.mode, 'A');
  assert.equal(plan.zipParallel, false);
  assert.equal(plan.batches, 1);
  assert.equal(plan.deliverable.length, 5);
});

test('plan B안: 파일 수 > 한도 → ZIP 병행 + 배치 분할 + confirm 필요', () => {
  const dir = makeMdDir(50); // 50 + index = 51 > 10
  const r = enumerateIndividualMds(dir);
  const plan = planDelivery(r);
  assert.equal(plan.mode, 'B');
  assert.equal(plan.zipParallel, true);
  assert.equal(plan.batches, Math.ceil(51 / SLACK_MSG_FILE_LIMIT)); // 6
  assert.match(plan.reason, /confirm/);
});

test('plan: --limit 커스텀 한도 반영', () => {
  const dir = makeMdDir(4); // 5 files
  const r = enumerateIndividualMds(dir);
  assert.equal(planDelivery(r, { fileLimit: 3 }).mode, 'B'); // 5 > 3
  assert.equal(planDelivery(r, { fileLimit: 5 }).mode, 'A'); // 5 <= 5
});

test('firewall 배너: T3 필수 조건 문구 포함', () => {
  const b = firewallBanner();
  assert.match(b, /단독/);
  assert.match(b, /no-broadcast/);
  assert.match(b, /byte-exact/);
  assert.match(b, /외부 AI 미경유/);
  assert.match(b, /U0ALGAAAJAV/);
});

test('manifest: 조용한 누락 금지 — 전 파일 열거 + 모드/사유 명시', () => {
  const dir = makeMdDir(2);
  const r = enumerateIndividualMds(dir);
  const plan = planDelivery(r);
  const m = buildManifest({ enumResult: r, plan, zipPath: null, ticket: 'T-TEST' });
  assert.match(m, /C-1000_환자0\.md/);
  assert.match(m, /C-1001_환자1\.md/);
  assert.match(m, /\[index\]/);
  assert.match(m, /배송 모드: A안/);
});
