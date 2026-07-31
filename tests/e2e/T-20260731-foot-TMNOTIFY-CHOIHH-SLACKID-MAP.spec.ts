/**
 * E2E spec — T-20260731-foot-TMNOTIFY-CHOIHH-SLACKID-MAP (P2, ADDITIVE, no-DDL)
 *
 * 현장(김주연 총괄, C0ATE5P6JTH thread 1785478080.706099):
 *   TM 상담대기 알림에서 최현희 실장이 이름 텍스트가 아닌 <@U0BKRDWDG9Z> @멘션으로 렌더되도록
 *   실장↔Slack ID 매핑에 최현희 추가.
 *
 * 배경(conflict 해소): 이전 제공 U0ATJ9SG4GY = 장쳰 봇 ID(오매핑) → blocked.
 *   총괄 재확인으로 최현희 실장 실제 멤버 ID = U0BKRDWDG9Z 확정(봇 ID·기존 6명 무충돌) → 진행.
 *
 * 양쪽 동기화 의무: FE SSOT(src/lib/siljangSlack.ts) + EF 복제표(send-consult-notify/index.ts).
 *   실 발송 해소 우선순위 = staff.slack_user_id → 이 상수(이름 매칭) → 이름 텍스트(멘션 없음).
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot slack-notify spec 동형.
 * 실 Slack @멘션 렌더(최현희 → <@U0BKRDWDG9Z>)는 supervisor 맥스튜디오 / 현장 실발송 단계 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const SILJANG = 'src/lib/siljangSlack.ts';
const EF = 'supabase/functions/send-consult-notify/index.ts';

const CHOIHH = { name: '최현희', id: 'U0BKRDWDG9Z' };
// 기존 6명 (무회귀 확인 대상)
const EXISTING = {
  엄경은: 'U0B4JFD5Z6V',
  송지현: 'U0B4BSU84E9',
  정연주: 'U0B49P7JB3P',
  강경민: 'U0BFYC35B0X',
  김지윤: 'U0B902NG8JF',
  김주연: 'U0ATDB587PV',
};
// 오매핑(장쳰 봇 ID) — 어느 소스에도 남아있으면 안 됨
const BOT_ID_MISMAP = 'U0ATJ9SG4GY';

test('① FE SSOT: SILJANG_SLACK_MAP 에 최현희 → U0BKRDWDG9Z 추가', () => {
  const src = read(SILJANG);
  expect(src).toContain(CHOIHH.name);
  expect(src).toContain(CHOIHH.id);
  // 최현희 키가 실제로 U0BKRDWDG9Z 로 매핑됐는지(키-값 인접 단언)
  expect(src).toMatch(/최현희:\s*'U0BKRDWDG9Z'/);
});

test('① EF 복제표: SILJANG_SLACK_MAP 에 최현희 → U0BKRDWDG9Z 동기화', () => {
  const src = read(EF);
  expect(src).toContain(CHOIHH.name);
  expect(src).toContain(CHOIHH.id);
  expect(src).toMatch(/"최현희":\s*"U0BKRDWDG9Z"/);
});

test('무회귀: 기존 6명 매핑 FE/EF 양쪽 그대로 보존', () => {
  const fe = read(SILJANG);
  const ef = read(EF);
  for (const [name, id] of Object.entries(EXISTING)) {
    expect(fe).toContain(name);
    expect(fe).toContain(id);
    expect(ef).toContain(name);
    expect(ef).toContain(id);
  }
});

test('conflict 해소: 오매핑(장쳰 봇 ID U0ATJ9SG4GY) 잔존 없음', () => {
  expect(read(SILJANG)).not.toContain(BOT_ID_MISMAP);
  expect(read(EF)).not.toContain(BOT_ID_MISMAP);
});

test('무충돌: U0BKRDWDG9Z 가 기존 6명 ID 와 겹치지 않음', () => {
  const existingIds = Object.values(EXISTING);
  expect(existingIds).not.toContain(CHOIHH.id);
});

test('FE↔EF 정합: 최현희 매핑 값이 두 소스에서 동일', () => {
  const feMatch = read(SILJANG).match(/최현희:\s*'([^']+)'/);
  const efMatch = read(EF).match(/"최현희":\s*"([^"]+)"/);
  expect(feMatch?.[1]).toBe(CHOIHH.id);
  expect(efMatch?.[1]).toBe(CHOIHH.id);
  expect(feMatch?.[1]).toBe(efMatch?.[1]);
});
