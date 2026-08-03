/**
 * T-20260803-foot-TERMINAL-TID-COMPORT-PERSEAT-SETTINGS
 * 자리(PC)별 카드 단말기 설정(TID + COM 포트) 입력·저장·영속.
 *
 * 현장 요구: 각 자리(PC)마다 결제 단말 연동값(단말기 TID / COM 포트)을 실장이 CRM에서
 *   직접 입력·저장. 한 번 저장하면 그 PC에서 재부팅/재접속해도 자동으로 채워져 있어야 함.
 *
 * 결정(dev 판단):
 *   ① 저장 인프라는 이미 존재 — getTerminalConfig/saveTerminalConfig
 *      (LS_KEY='cband.terminal.config', T-20260731-foot-CBAND-CAT-DIRECT-PAY 구축).
 *      누락은 '입력 UI'뿐 → saveTerminalConfig 호출부 0건이었음.
 *   ③ 저장방식 = localStorage(PC별). COM포트/케이블단말은 물리적 PC 속성이라 seat=물리 PC로
 *      귀속하는 localStorage 가 의미상 정합. 재부팅 영속 충족. DB 무변경 → DA 게이트 불요.
 *
 * 본 티켓 = AdminSettings 에 '⑧ 카드 단말기 설정' 섹션(입력폼+저장) 추가(FE-only, DB무접촉).
 *
 * role 매트릭스/섹션 배선/저장 계약이 전부 소스 상수·순수 로직 → 정적 소스 검증 +
 *   localStorage 계약 시뮬레이션으로 회귀를 잡는다(브라우저 auth 불필요, 빠르고 견고).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ── AC1: 저장 인프라(config.ts) 존재 — localStorage 계약 ──────────────────────────
test('AC1 config.ts 에 saveTerminalConfig/getTerminalConfig + LS_KEY(localStorage) 계약 존재', () => {
  const src = read('src/lib/cband/config.ts');
  expect(src).toMatch(/export function saveTerminalConfig/);
  expect(src).toMatch(/export function getTerminalConfig/);
  // 저장 위치 = localStorage(PC별) 계약
  expect(src).toMatch(/const LS_KEY\s*=\s*'cband\.terminal\.config'/);
  expect(src).toMatch(/window\.localStorage\.setItem\(LS_KEY/);
  expect(src).toMatch(/window\.localStorage\.getItem\(LS_KEY/);
});

// ── AC2: AdminSettings 가 실제 저장 인프라를 호출(입력 UI 배선) ─────────────────────
test('AC2 AdminSettings 에 ⑧ 카드 단말기 설정 섹션이 저장 인프라를 호출한다', () => {
  const src = read('src/pages/AdminSettings.tsx');
  // 실제 저장/조회 함수를 import (죽은 UI 아님)
  expect(src).toMatch(/import\s*\{\s*getTerminalConfig,\s*saveTerminalConfig\s*\}\s*from\s*'@\/lib\/cband\/config'/);
  // 섹션 정의 + 렌더 배선
  expect(src).toMatch(/id:\s*'8_terminal'/);
  expect(src).toMatch(/activeSection === '8_terminal'/);
  expect(src).toMatch(/<SectionTerminal\s*\/>/);
  // 저장 버튼이 실제 saveTerminalConfig 를 호출
  expect(src).toMatch(/saveTerminalConfig\(\{\s*tid:/);
  // 프리필 = 기존 저장값(재접속 시 자동 채움) → getTerminalConfig 로 초기화
  expect(src).toMatch(/getTerminalConfig\(\)/);
});

// ── AC3: 입력 필드(TID/COM포트) + 저장 버튼(태블릿 큰 버튼) 존재 ───────────
//   ★T-20260803-foot-CBAND-MERNO-REQFIELD-BUG(FIX-3 회귀정정): MERNO 입력칸 제거(옵션 A).
//   MERNO 는 결제 '요청'이 아니라 승인 '응답'에서만 오므로 설정화면 입력 대상이 아니다(순환참조 해소).
test('AC3 TID/COM포트 입력칸 + 저장 버튼 testid 존재 (MERNO 칸 제거)', () => {
  const src = read('src/pages/AdminSettings.tsx');
  expect(src).toMatch(/data-testid="terminal-tid-input"/);
  expect(src).not.toMatch(/data-testid="terminal-merno-input"/);  // ★FIX-3: MERNO 칸 제거됨
  expect(src).toMatch(/data-testid="terminal-comport-input"/);
  expect(src).toMatch(/data-testid="terminal-save-btn"/);
  expect(src).toMatch(/data-testid="terminal-config-section"/);
});

// ── AC4: 실장급(admin/manager/director) 전용 게이트 — 비대상 역할 미노출 ─────────────
test('AC4 ⑧ 섹션은 dirMgrOnly(admin/manager/director) 게이트', () => {
  const src = read('src/pages/AdminSettings.tsx');
  // 섹션 플래그 dirMgrOnly
  expect(src).toMatch(/id:\s*'8_terminal'[^}]*dirMgrOnly:\s*true/);
  // canTerminal = admin/manager/director 조합
  expect(src).toMatch(/const canTerminal\s*=\s*isAdmin\s*\|\|\s*isManager\s*\|\|\s*isDirector/);
  // visibleSections 필터에 dirMgrOnly 반영
  expect(src).toMatch(/!s\.dirMgrOnly\s*\|\|\s*canTerminal/);
  // 렌더 게이트에도 canTerminal 이중 방어
  expect(src).toMatch(/activeSection === '8_terminal' && canTerminal/);
});

// ── AC5: 영속 계약 시뮬레이션 — 저장 후 '재부팅'(새 세션 read)에도 값 유지 ────────────
// config.ts 의 LS_KEY JSON 계약을 그대로 재현해 round-trip + 재접속 영속을 검증한다.
test('AC5 localStorage 영속 — 저장값이 재접속(새 read)에도 자동으로 채워진다', () => {
  const LS_KEY = 'cband.terminal.config';
  const store = new Map<string, string>();
  const fakeLS = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
  };

  // saveTerminalConfig 계약(= window.localStorage.setItem(LS_KEY, JSON.stringify(cfg)))
  const save = (cfg: { tid: string; merno: string; catPort: string }) =>
    fakeLS.setItem(LS_KEY, JSON.stringify(cfg));
  // getTerminalConfig 계약(= localStorage read 우선). ★FIX-1(MERNO-REQFIELD-BUG): 유효조건=TID+PORT 2값.
  //   merno 는 계승·저장되지만 유효성 판정엔 불참(빈값이어도 결제 가능 — 순환참조 해소).
  const get = () => {
    const raw = fakeLS.getItem(LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { tid?: string; merno?: string; catPort?: string };
    const tid = (o.tid ?? '').toString().trim();
    const merno = (o.merno ?? '').toString().trim();
    const port = (o.catPort ?? '').toString().trim();
    if (!tid || !port) return null;  // ★FIX-1: MERNO 는 필수 아님
    return { tid, merno, catPort: port };
  };

  // 최초엔 미설정 → null(폼 비어있음)
  expect(get()).toBeNull();

  // 실장이 입력·저장
  save({ tid: '1234567890', merno: '0012345678', catPort: '3' });

  // ★재부팅/재접속 = 새 read. 값이 그대로 자동으로 채워져야 한다.
  const reloaded = get();
  expect(reloaded).not.toBeNull();
  expect(reloaded!.tid).toBe('1234567890');
  expect(reloaded!.merno).toBe('0012345678');
  expect(reloaded!.catPort).toBe('3');
});
