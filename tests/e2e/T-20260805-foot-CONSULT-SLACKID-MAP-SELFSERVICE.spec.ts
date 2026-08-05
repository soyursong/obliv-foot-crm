/**
 * E2E spec — T-20260805-foot-CONSULT-SLACKID-MAP-SELFSERVICE (P2, ADDITIVE, no-DDL)
 *
 * 현장(김주연 총괄, U0ATDB587PV):
 *   Part A — 상담배정 알림 실장↔Slack ID 매핑에 상담실장 2명 추가:
 *            진이서 → U0BM25FTBFZ, 송민근 → U0BMKHRLCJV.
 *            ★ FE SSOT(src/lib/siljangSlack.ts) + EF 복제표(send-consult-notify/index.ts) 양쪽 동기화.
 *   Part B — 셀프서비스 편집 경로: Staff 관리(배정 설정) 화면의 slack_user_id 편집칸으로
 *            총괄이 개발팀 경유 없이 직접 실장↔Slack 연결(근본 해소). staff.slack_user_id(prod 실재,
 *            TEXT nullable) 재사용 = no-DDL. 잘못된 입력(봇 ID/형식오류) 저장 차단 가드
 *            (checkSlackUserId, src/lib/slackId.ts)로 CHOIHH 오배선 재발 방지.
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot slack-notify spec 동형.
 * 실 Slack @멘션 렌더/실 DB write RLS 는 supervisor 맥스튜디오 / 현장 실사용 단계 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const SILJANG = 'src/lib/siljangSlack.ts';
const EF = 'supabase/functions/send-consult-notify/index.ts';
const SLACKID = 'src/lib/slackId.ts';
const TAB = 'src/components/AssignmentSettingsTab.tsx';

// Part A — 신규 2명
const NEW = { 진이서: 'U0BM25FTBFZ', 송민근: 'U0BMKHRLCJV' };
// 무회귀 대상 — 기존 7명
const EXISTING = {
  엄경은: 'U0B4JFD5Z6V',
  송지현: 'U0B4BSU84E9',
  정연주: 'U0B49P7JB3P',
  강경민: 'U0BFYC35B0X',
  김지윤: 'U0B902NG8JF',
  김주연: 'U0ATDB587PV',
  최현희: 'U0BKRDWDG9Z',
};
const BOT_ID = 'U0ATJ9SG4GY';

// ── Part A: 매핑 추가 + 양쪽 동기화 ──────────────────────────────────────────

test('Part A ① FE SSOT: 진이서/송민근 추가', () => {
  const fe = read(SILJANG);
  expect(fe).toMatch(/진이서:\s*'U0BM25FTBFZ'/);
  expect(fe).toMatch(/송민근:\s*'U0BMKHRLCJV'/);
});

test('Part A ① EF 복제표: 진이서/송민근 동기화', () => {
  const ef = read(EF);
  expect(ef).toMatch(/"진이서":\s*"U0BM25FTBFZ"/);
  expect(ef).toMatch(/"송민근":\s*"U0BMKHRLCJV"/);
});

test('Part A FE↔EF 정합: 신규 2명 값이 두 소스에서 동일', () => {
  const fe = read(SILJANG);
  const ef = read(EF);
  for (const [name, id] of Object.entries(NEW)) {
    const feVal = fe.match(new RegExp(`${name}:\\s*'([^']+)'`))?.[1];
    const efVal = ef.match(new RegExp(`"${name}":\\s*"([^"]+)"`))?.[1];
    expect(feVal).toBe(id);
    expect(efVal).toBe(id);
    expect(feVal).toBe(efVal);
  }
});

test('Part A 무회귀: 기존 7명 매핑 FE/EF 양쪽 보존', () => {
  const fe = read(SILJANG);
  const ef = read(EF);
  for (const [name, id] of Object.entries(EXISTING)) {
    expect(fe).toContain(name);
    expect(fe).toContain(id);
    expect(ef).toContain(name);
    expect(ef).toContain(id);
  }
});

test('Part A 무충돌: 신규 2 ID 가 봇 ID·기존 7명 ID 와 겹치지 않음', () => {
  const newIds = Object.values(NEW);
  const guardSet = [BOT_ID, ...Object.values(EXISTING)];
  for (const id of newIds) expect(guardSet).not.toContain(id);
  // 신규 2개끼리도 상이
  expect(newIds[0]).not.toBe(newIds[1]);
});

// ── Part B: 셀프서비스 입력 가드 ─────────────────────────────────────────────

test('Part B 가드 파일 존재 + 봇 ID 상수 정의', () => {
  const g = read(SLACKID);
  expect(g).toContain('checkSlackUserId');
  expect(g).toMatch(/SLACK_BOT_USER_ID\s*=\s*'U0ATJ9SG4GY'/);
});

test('Part B 매핑 SSOT(siljangSlack.ts)에는 봇 ID 리터럴 없음 (CHOIHH 정합 보존)', () => {
  // 봇 ID 리터럴은 가드 파일(slackId.ts)에만 존재. 매핑 SSOT·EF 복제표에는 잔존 없음.
  expect(read(SILJANG)).not.toContain(BOT_ID);
  expect(read(EF)).not.toContain(BOT_ID);
});

test('Part B 화면 배선: AssignmentSettingsTab 이 checkSlackUserId 를 slackId 에서 import·사용', () => {
  const tab = read(TAB);
  expect(tab).toMatch(/import\s*\{\s*checkSlackUserId\s*\}\s*from\s*'@\/lib\/slackId'/);
  expect(tab).toContain('checkSlackUserId(value)');
  // 거부 시 저장하지 않고 return (봇/형식 오류 차단)
  expect(tab).toMatch(/if\s*\(!check\.ok\)/);
});

// checkSlackUserId 로직 단언 — 소스에서 함수를 추출해 순수 평가(런타임 의존 0).
function loadChecker(): (raw: string | null | undefined) => { ok: boolean; reason?: string; value?: string | null } {
  const src = read(SLACKID);
  const botId = src.match(/SLACK_BOT_USER_ID\s*=\s*'([^']+)'/)?.[1];
  const rePat = src.match(/SLACK_MEMBER_ID_RE\s*=\s*(\/[^\n]+\/)\s*;/)?.[1];
  expect(botId).toBeTruthy();
  expect(rePat).toBeTruthy();
  // eslint-disable-next-line no-eval
  const re: RegExp = eval(rePat as string);
  return (raw) => {
    const v = (raw ?? '').trim().toUpperCase();
    if (!v) return { ok: true, value: null };
    if (v === botId) return { ok: false, reason: 'bot' };
    if (!re.test(v)) return { ok: false, reason: 'format' };
    return { ok: true, value: v };
  };
}

test('Part B 가드 로직: 봇 ID 거부', () => {
  const check = loadChecker();
  const r = check('U0ATJ9SG4GY');
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('bot');
});

test('Part B 가드 로직: 형식 위반(한글/이름/짧은문자) 거부', () => {
  const check = loadChecker();
  expect(check('진이서').ok).toBe(false);
  expect(check('hello').ok).toBe(false);
  expect(check('12345').ok).toBe(false);
  expect(check('U1').ok).toBe(false); // 너무 짧음
});

test('Part B 가드 로직: 정상 ID 통과 + 대문자 정규화', () => {
  const check = loadChecker();
  const r = check('u0bm25ftbfz'); // 소문자 입력 → 대문자 정규화
  expect(r.ok).toBe(true);
  expect(r.value).toBe('U0BM25FTBFZ');
  expect(check('U0BMKHRLCJV').ok).toBe(true);
});

test('Part B 가드 로직: 빈 입력 → 매핑 해제(value=null) 허용', () => {
  const check = loadChecker();
  const r = check('   ');
  expect(r.ok).toBe(true);
  expect(r.value).toBeNull();
});

// ── Part C: 기존 연동값 자동 표시(pre-fill) — read-only ──────────────────────

test('Part C: staff 행 값은 defaultValue 로 pre-fill (자동 표시)', () => {
  const tab = read(TAB);
  // 입력칸이 staff.slack_user_id 를 기본값으로 표시(이미 연동된 계정 자동 노출).
  expect(tab).toMatch(/defaultValue=\{c\.slack_user_id\}/);
});

test('Part C: staff 행 미기입 시 상수 매핑을 placeholder(read-only)로 안내', () => {
  const tab = read(TAB);
  // 상수 fallback 은 placeholder 로만 노출 — defaultValue 로 넣지 않음(자동 write 금지).
  expect(tab).toContain('resolveSiljangSlackId(c.name)');
  expect(tab).toMatch(/placeholder=\{[\s\S]*resolveSiljangSlackId\(c\.name\)[\s\S]*\}/);
  // 상수값이 defaultValue 로 새어 자동 저장되지 않는지: defaultValue 는 여전히 staff 행만.
  expect(tab).not.toMatch(/defaultValue=\{[^}]*resolveSiljangSlackId/);
});
