/**
 * T-20260803-foot-CBAND-TIDCOM-TERMINAL-NOSETUP — "TID·COM 입력했는데 단말 설정이 안됨" 진단 fix
 * ════════════════════════════════════════════════════════════════════════════
 * 부모 = T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD / POPUP-PLACEMENT(② 팝업 이관).
 *
 * ■ 진단(CRM-side legibility trap)
 *   결제 게이트 getTerminalConfig() 는 TID·MERNO·COM **3값 모두** 있어야 non-null(config.ts §41).
 *   그러나 결제 Dialog 안 팝업(CbandTerminalConfigInline)은 TID·COM **2필드만** 다루고
 *   MERNO 는 ⑧/env 계승(DELTA1 유지). → MERNO 미설정(env 없음 + ⑧ 미입력) PC 에서 팝업으로
 *   TID·COM 만 저장하면 요약줄은 '저장됨'처럼 보이나(hasSaved=TID·COM 2필드 기준) 결제요청 시
 *   getTerminalConfig()=null 로 차단된다("단말기 설정이 완료되지 않았습니다"). [변경]은 TID·COM 만
 *   다뤄 MERNO 를 못 채우는 dead-end → 현장 관점 "TID·COM 입력했는데 단말 설정이 안됨".
 *
 * ■ fix (순수 FE·db_change=false·결제/전문/dedup 로직 무접촉)
 *   은닉된 진짜 블로커(MERNO 미설정)를 명시적으로 노출한다. 팝업에 MERNO 입력칸을 추가하지 않고
 *   (DELTA1 2필드 유지), '어디서 고치는지(관리자 설정 ⑧)'만 안내한다.
 *
 * ★ 하네스: 배선/계약을 컴포넌트·모듈 소스 정본으로 읽어 잠근다(순수·정적, auth/server 불요).
 *   런타임 결제/전문/probe 로직은 부모 BUILD/POPUP-PLACEMENT spec 이 커버. 본 spec 은 legibility 계약 전용.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const ENTRY = () => read('src/components/CbandPayEntryButton.tsx');
const CONFIG = () => read('src/lib/cband/config.ts');

// ── AC1: 진단의 전제(3값 완비 요건)가 config.ts 에 여전히 존재 — 근본 원인축 고정 ─────────────
test('AC1 getTerminalConfig 는 TID·MERNO·COM 3값 완비 시에만 non-null(불변) — 팝업 2필드와의 gap 근거', () => {
  const src = CONFIG();
  expect(src).toMatch(/if \(!tid \|\| !merno \|\| !portRaw\) return null;/);
  // 팝업 프리필/계승용 raw 조회는 3값 완비 요건 없음(계약 유지)
  expect(src).toMatch(/return \{ tid, merno, catPort \}/);
});

// ── AC2: 팝업이 MERNO 미설정을 감지(mernoMissing = raw.merno === '') ────────────────────────
test('AC2 CbandTerminalConfigInline 은 MERNO 미설정을 raw.merno 로 감지한다', () => {
  const src = ENTRY();
  const fnIdx = src.indexOf('function CbandTerminalConfigInline');
  expect(fnIdx).toBeGreaterThan(-1);
  const fn = src.slice(fnIdx, fnIdx + 2600);
  expect(fn).toMatch(/const mernoMissing = raw\.merno === '';/);
});

// ── AC3: 저장됨 요약에서 MERNO 미설정 시 진짜 블로커를 명시 + 조치 위치(⑧) 안내 ──────────────
test('AC3 저장됨 요약(mernoMissing)일 때 MERNO 미설정 경고 + 관리자 설정 ⑧ 안내를 노출', () => {
  const src = ENTRY();
  // 전용 경고 컨테이너 testid
  expect(src).toMatch(/data-testid="cband-terminal-merno-missing"/);
  // 진짜 블로커(가맹점 번호/MERNO)를 명시하고 조치 위치(⑧ 카드 단말기 설정)를 지목
  expect(src).toContain('가맹점 번호(MERNO)가 아직 설정되지 않아');
  expect(src).toContain('⑧ 카드 단말기 설정');
  // 조건부 노출(mernoMissing 일 때만) — 상시 노출 아님(false-positive 방지: env/⑧ 로 채워지면 안 뜸)
  expect(src).toMatch(/\{mernoMissing && \(/);
});

// ── AC4: 결제요청 차단 사유가 MERNO 면 dead-end([변경]) 대신 정확한 위치(⑧)로 안내 ────────────
test('AC4 onApprove 는 미완 원인이 MERNO 면 관리자 설정 ⑧ 로 안내(TID·COM dead-end 회피)', () => {
  const src = ENTRY();
  const fnIdx = src.indexOf('async function onApprove()');
  expect(fnIdx).toBeGreaterThan(-1);
  const fn = src.slice(fnIdx, fnIdx + 1900);
  // getTerminalConfig()=null 시 원인축 분기
  expect(fn).toMatch(/const mernoMissing = !getTerminalConfigRaw\(\)\.merno;/);
  // MERNO 결핍 분기 = 가맹점 번호 + ⑧ 지목
  expect(fn).toContain('가맹점 번호(MERNO)가 설정되지 않아');
  expect(fn).toContain('⑧ 카드 단말기 설정');
  // 여전히 전송 차단(return) 유지 — 미완 상태로 과금 시도 0
  expect(fn).toMatch(/if \(!activeCfg\) \{[\s\S]*return;\s*\}/);
});

// ── AC5 (불변식 가드): 결제/전문/이중결제방지 로직 무접촉 — legibility 만 변경 ─────────────────
test('AC5 approve·protocol·dedup 계약 무접촉 + 팝업 2필드 유지(MERNO 입력칸 미추가)', () => {
  const src = ENTRY();
  // 팝업 저장은 여전히 merno 계승(재정의 X) — MERNO 물리 입력칸 신설 금지(DELTA1 2필드)
  expect(src).toMatch(/saveTerminalConfig\(\{ tid: t, merno: getTerminalConfigRaw\(\)\.merno, catPort: p \}\)/);
  expect(src).not.toMatch(/data-testid="cband-terminal-merno-input"/);
  // 편집 패널 입력칸은 여전히 정확히 2개(TID·COM)
  const editIdx = src.indexOf('data-testid="cband-terminal-config-edit"');
  const saveIdx = src.indexOf('data-testid="btn-cband-terminal-save"');
  const panel = src.slice(editIdx, saveIdx);
  expect((panel.match(/<Input\b/g) ?? []).length).toBe(2);
  // 승인 호출 시그니처(approve) 불변 — 전문/dedup 미변경
  expect(src).toMatch(/const r = await approve\(/);
  // paymentFlow/protocol 순수계층엔 이 티켓 변경 없음(legibility=FE 전용)
  const flow = read('src/lib/cband/paymentFlow.ts');
  expect(flow).not.toContain('mernoMissing');
  const proto = read('src/lib/cband/protocol.ts');
  expect(proto).not.toContain('mernoMissing');
});
