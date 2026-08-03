/**
 * T-20260803-foot-CBAND-TIDCOM-POPUP-PLACEMENT — 단말기 TID/COM 팝업을 코밴 결제 Dialog 안으로
 * ════════════════════════════════════════════════════════════════════════════
 * 부모 = T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD / T-20260803-...-5FIX(② carve-out).
 *
 * 확정스펙(총괄 15:18, approved · screenshot_gate LIFTED):
 *  · 위치 = 코밴 결제 Dialog(카드결제 버튼 클릭 시 창) 안. 저장여부 무관 모든 PC에서 항상 표시.
 *  · 입력란 `단말기 TID`·`COM 포트` + [저장] 버튼 1개. localStorage `cband.terminal.config` 있으면
 *    자동채움, 없으면 빈칸.
 *  · 저장됨: `단말기 {TID} · COM {n} [변경]` 한 줄 읽기전용. [변경] 클릭 시 입력모드.
 *  · 빈값 전송 차단(pre-daemon): TID 비면 결제 시 "단말기 번호를 먼저 입력해 주세요" 안내+전송 차단.
 *  · 규칙 계승(재정의 X): zero-pad·baud 38400·빈값차단 = TERMINAL 티켓(config/protocol). merno = ⑧/env 계승.
 *
 * CONFLICT#1 reconcile(§8): PAYBTN-DISABLED-TOOLTIP 의 버튼 disable 중 'TID 미등록'만 enabled 로 분리
 *  (Dialog 열려 창 안 입력 가능, chicken-egg 방지). 'daemon 미연결·권한차단' disable 은 유지.
 *
 * ⑧ 별도 설정화면(AdminSettings SectionTerminal): 무단 제거 금지 — 존치 유지.
 *
 * ★ 하네스: 배선/계약을 컴포넌트·모듈 소스 정본으로 읽어 잠근다(순수·정적, auth/server 불요).
 *   런타임 결제/전문/probe 로직은 부모 BUILD/TOOLTIP spec 이 커버. 본 spec 은 ② placement 계약 회귀 전용.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const ENTRY = () => read('src/components/CbandPayEntryButton.tsx');
const CONFIG = () => read('src/lib/cband/config.ts');

// ── AC1: config.ts 에 프리필/부분표시용 getTerminalConfigRaw(3값 완비 요건 없음) 존재 ───────
test('AC1 config.ts 에 getTerminalConfigRaw(LS>env, 완비요건 없음) + 기존 계약 유지', () => {
  const src = CONFIG();
  expect(src).toMatch(/export function getTerminalConfigRaw/);
  // LS_KEY(localStorage) 계약은 그대로 재사용(신규 저장소 없음)
  expect(src).toMatch(/const LS_KEY\s*=\s*'cband\.terminal\.config'/);
  // 3값(tid/merno/catPort)을 그대로 반환(완비 요건 없이) — 팝업 프리필·merno 계승용
  expect(src).toMatch(/return \{ tid, merno, catPort \}/);
  // 기존 getTerminalConfig(3값 완비 시에만 non-null)은 불변
  expect(src).toMatch(/if \(!tid \|\| !merno \|\| !portRaw\) return null;/);
});

// ── AC2: 코밴 결제 Dialog 안에 단말기 설정 인라인 패널이 '항상' 렌더 ─────────────────────
test('AC2 결제 Dialog 의 입력/전송(idle|sending) 블록 안에 CbandTerminalConfigInline 이 렌더된다', () => {
  const src = ENTRY();
  // 패널 컴포넌트 정의
  expect(src).toMatch(/function CbandTerminalConfigInline/);
  // Dialog(cband-pay-dialog) 안에서 사용
  const dlgIdx = src.indexOf('data-testid="cband-pay-dialog"');
  expect(dlgIdx).toBeGreaterThan(-1);
  const dlg = src.slice(dlgIdx);
  expect(dlg).toContain('<CbandTerminalConfigInline onSaved={onTerminalSaved} />');
  // 저장여부 무관 항상 표시: idle/sending 입력 블록 안에 위치(결과 상태가 아님)
  const idleIdx = src.indexOf("{(ui === 'idle' || ui === 'sending') && (");
  const panelIdx = src.indexOf('<CbandTerminalConfigInline');
  expect(idleIdx).toBeGreaterThan(-1);
  expect(panelIdx).toBeGreaterThan(idleIdx);
});

// ── AC3: 입력란 = 단말기 TID·COM 포트(2필드) + [저장] 1개 + 저장됨 요약 한 줄 + [변경] ────
test('AC3 TID·COM 입력칸 + 저장 버튼 + 저장됨 요약(단말기 {TID} · COM {n}) + [변경] testid 존재', () => {
  const src = ENTRY();
  expect(src).toMatch(/data-testid="cband-terminal-tid-input"/);
  expect(src).toMatch(/data-testid="cband-terminal-comport-input"/);
  expect(src).toMatch(/data-testid="btn-cband-terminal-save"/);
  // 저장됨 요약 한 줄 + [변경]
  expect(src).toMatch(/data-testid="cband-terminal-config-summary"/);
  expect(src).toMatch(/data-testid="btn-cband-terminal-edit"/);
  // 요약 문구 형식: 단말기 {TID} · COM {n}
  expect(src).toMatch(/단말기 \{savedTid\} · COM \{savedPort\}/);
  // 입력칸은 정확히 2개(TID/COM) — MERNO 입력칸은 팝업에 없음(⑧에서만)
  expect(src).not.toMatch(/data-testid="cband-terminal-merno-input"/);
});

// ── AC4: 프리필 + 저장됨 판정(TID·COM 2필드) + merno 계승(재정의 X) ──────────────────
test('AC4 프리필=getTerminalConfigRaw, 저장됨 판정=TID·COM, 저장 시 merno 계승', () => {
  const src = ENTRY();
  // 프리필/판정에 getTerminalConfigRaw 사용
  expect(src).toMatch(/const raw = getTerminalConfigRaw\(\);/);
  // 저장됨(요약) 판정은 팝업 2필드(TID·COM) 기준
  expect(src).toMatch(/const hasSaved = savedTid !== '' && savedPort !== '';/);
  // 저장 시 merno 는 ⑧/env 값 계승(재정의 X)
  expect(src).toMatch(/saveTerminalConfig\(\{ tid: t, merno: getTerminalConfigRaw\(\)\.merno, catPort: p \}\)/);
  // 빈값차단(TERMINAL 계승): 저장 버튼도 TID·COM 필수
  expect(src).toContain('단말기 번호(TID)를 입력해 주세요.');
  expect(src).toContain('COM 포트 번호를 입력해 주세요.');
});

// ── AC5: 빈값(TID) 전송 차단(pre-daemon) — 결제 요청 시 정지 + 안내 ─────────────────
test('AC5 onApprove 는 TID 빈값이면 전문 전송 이전에 정지하고 안내 문구를 노출', () => {
  const src = ENTRY();
  const fnIdx = src.indexOf('async function onApprove()');
  expect(fnIdx).toBeGreaterThan(-1);
  const fn = src.slice(fnIdx, fnIdx + 900);
  // pre-daemon: getTerminalConfigRaw 로 TID 확인 → 빈값이면 안내 + return(전송 차단)
  expect(fn).toMatch(/const rawCfg = getTerminalConfigRaw\(\);/);
  expect(fn).toMatch(/if \(!rawCfg\.tid\) \{ setPayBlock\('단말기 번호를 먼저 입력해 주세요\.'\); return; \}/);
  // 안내는 approve(전문 전송) 호출 이전에 위치
  const blockIdx = fn.indexOf('단말기 번호를 먼저 입력해 주세요');
  const approveIdx = fn.indexOf('await approve(');
  expect(blockIdx).toBeGreaterThan(-1);
  expect(approveIdx).toBeGreaterThan(blockIdx);
  // 차단 안내가 Dialog 에 렌더됨
  expect(src).toMatch(/data-testid="cband-payblock"/);
});

// ── AC6: CONFLICT#1 reconcile — TID 미등록만 활성 분리, daemon 상태 disable 유지 ──────
test('AC6 !hasCfg(TID 미등록)는 활성 진입+Dialog / probing·awaiting·blocked 는 비활성 게이트 유지', () => {
  const src = ENTRY();
  // TID 미등록 → 활성 진입+Dialog(entryAndDialog)
  expect(src).toMatch(/if \(!hasCfg\) return entryAndDialog;/);
  // 비활성 tid-missing 게이트 dispatch 는 없음(활성 분리)
  expect(src).not.toContain('kind="tid-missing"');
  // daemon 상태(탐지중/권한대기/연결실패)는 비활성 게이트 유지
  expect(src).toMatch(/if \(probe === null\) return <CbandGateButton kind="probing"/);
  expect(src).toMatch(/if \(probe === 'awaiting'\) return <CbandGateButton kind="awaiting"/);
  expect(src).toMatch(/if \(probe === 'blocked'\) return <CbandGateButton kind="blocked"/);
});

// ── AC7: 신규 npm 의존성 없음 + DB 무변경(순수 FE + localStorage) ──────────────────
test('AC7 신규 툴팁/모달 외부 라이브러리 미도입, 저장은 기존 localStorage 계약 재사용', () => {
  const src = ENTRY();
  expect(src).not.toContain('@radix-ui/react-tooltip');
  expect(src).not.toMatch(/from ['"]react-tooltip['"]/);
  // 저장·조회는 기존 config 모듈만 사용(신규 저장소·DB 없음)
  expect(src).toMatch(/from '@\/lib\/cband\/config'/);
  expect(src).toMatch(/import \{ getTerminalConfig, getTerminalConfigRaw, saveTerminalConfig \}/);
});

// ── AC8: ⑧ 별도 설정화면(AdminSettings SectionTerminal) 존치(무단 제거 금지) ──────────
test('AC8 AdminSettings 의 ⑧ 카드 단말기 설정 섹션은 존치(무단 제거 금지)', () => {
  const admin = read('src/pages/AdminSettings.tsx');
  expect(admin).toMatch(/id:\s*'8_terminal'/);
  expect(admin).toMatch(/activeSection === '8_terminal'/);
  expect(admin).toMatch(/<SectionTerminal\s*\/>/);
  expect(admin).toMatch(/data-testid="terminal-config-section"/);
});

// ── AC9 (DELTA 1): 통신속도(baud/COM speed) 입력 칸 미노출 — 팝업 입력 필드는 TID·COM 2칸만 ──
//   현장 확정(총괄 MSG-151826): baud=38400 고정, 화면에 통신속도 입력 칸 두지 말 것. 3칸(TID/COM/통신속도)
//   금지. baud 는 값 계승만(config/protocol)이고 UI 노출은 제거.
test('AC9 팝업 편집 패널은 입력칸이 정확히 2개(TID·COM)뿐 — 통신속도/baud 입력칸 없음', () => {
  const src = ENTRY();
  // 편집 패널 슬라이스(cband-terminal-config-edit ~ 저장 버튼) 안의 <Input> 은 정확히 2개
  const editIdx = src.indexOf('data-testid="cband-terminal-config-edit"');
  const saveIdx = src.indexOf('data-testid="btn-cband-terminal-save"');
  expect(editIdx).toBeGreaterThan(-1);
  expect(saveIdx).toBeGreaterThan(editIdx);
  const panel = src.slice(editIdx, saveIdx);
  const inputCount = (panel.match(/<Input\b/g) ?? []).length;
  expect(inputCount).toBe(2);
  // 그리드는 2열(TID·COM) — 3필드 그리드 금지
  expect(panel).toContain('grid grid-cols-2');
  // 통신속도/baud 입력 필드·라벨·testid 미존재(렌더 패널 슬라이스 기준 — 헤더 주석의 금지명시는 제외)
  expect(src).not.toMatch(/data-testid="cband-terminal-baud-input"/);
  expect(src).not.toMatch(/data-testid="cband-terminal-comspeed-input"/);
  expect(panel).not.toContain('통신속도');
  // ⑧ 별도 설정화면에도 통신속도 입력칸이 없어야(baud 노출 금지 일관) — SectionTerminal 렌더 슬라이스 기준
  const admin = read('src/pages/AdminSettings.tsx');
  const secIdx = admin.indexOf('function SectionTerminal()');
  const secPanel = admin.slice(secIdx, secIdx + 4000);
  expect(secPanel).not.toContain('통신속도');
  expect(admin).not.toMatch(/data-testid="terminal-baud-input"/);
});

// ── AC10 (DELTA 2): TID 자동획득(auto-fetch) 경로 없음 — 사람이 직접 입력하는 수동입력만 ────
//   현장 전수확인(응답 26필드×51건) 결과 데몬 응답 어디에도 TID 없음(MERNO=가맹점번호만). 데몬 응답을
//   파싱해 TID 를 자동 세팅하는 경로 신설 금지. saveTerminalConfig 호출은 사람이 누른 저장 핸들러뿐.
test('AC10 데몬 응답→TID 자동세팅 경로 없음(수동입력만) — probe/결제 계층은 config write 안 함', () => {
  // saveTerminalConfig(TID 영속) 는 사람이 입력하는 화면(팝업/⑧)에서만 호출 — probe/결제/전문 계층 금지
  const savers = ['src/lib/cband/catClient.ts', 'src/lib/cband/paymentFlow.ts', 'src/lib/cband/protocol.ts']
    .map((f) => read(f));
  for (const src of savers) {
    expect(src).not.toContain('saveTerminalConfig');
  }
  // 팝업 컴포넌트에서 TID 저장은 사람의 저장 핸들러(handleSave)에서만 — 응답 파싱 setTid 자동경로 없음
  const entry = ENTRY();
  // setTid 호출은 (a)초기 state (b)[변경] 클릭 (c)입력 onChange 뿐. probe/approve 응답 기반 setTid 금지.
  const onApproveIdx = entry.indexOf('async function onApprove()');
  const onApprove = entry.slice(onApproveIdx, onApproveIdx + 1600);
  expect(onApprove).not.toContain('saveTerminalConfig');
  expect(onApprove).not.toContain('setTid');
  // catClient probe 결과(ProbeResult)는 'ok|awaiting|blocked' 뿐 — TID 를 실어오지 않음(자동획득 불가 확정)
  const cat = read('src/lib/cband/catClient.ts');
  expect(cat).not.toMatch(/tid\s*[:=]\s*(resp|response|data|payload|parsed)/i);
});
