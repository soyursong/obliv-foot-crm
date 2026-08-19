/**
 * T-20260819-foot-CHART-CTRL-S-SAVE-SHORTCUT (P2)
 * 고객 차트(치료메모·기록) 화면 Ctrl+S 저장 단축키 — 저장 storm 방어 하드닝 검증
 *
 * 배경: 본 기능의 1차 구현은 형제 티켓 T-20260819-foot-CUSTCHART-CTRLS-SAVE-SHORTCUT
 *   (commit c68162fc)에서 이미 머지됨(Textarea onKeyDown · handleSave 재사용 · preventDefault ·
 *   dirty-gate · 포커스 스코프). 본 티켓은 그 위에 CHARTSAVE-STORM 장애 맥락에서 요구된
 *   저장 storm 방어(자동반복·연타 증폭 차단)를 하드닝한다:
 *     (a) e.repeat 가드 — 키 홀드 자동반복 keydown 무시
 *     (b) 동기 inflightRef 락 — 비동기 saving prop 의 레이스 윈도우 봉합
 *
 * ─ 검증 범위 (티켓 3종 시나리오 + storm 계약) ──────────────────────
 *   시나리오1(정상): Ctrl/Cmd+S = 기존 저장(handleSave) 재사용 + preventDefault
 *   시나리오2(dirty=false): 빈 입력이면 handleSave 내부 early-return → 저장 미발생
 *   시나리오3(모달 가드): Textarea onKeyDown 스코프(입력창 포커스 시에만 발화)
 *   STORM: e.repeat 가드 + 동기 inflightRef 이중 락(연타/자동반복 증폭 차단)
 *
 * NOTE: 본 레포 치료메모 E2E 관례(T-20260520-foot-MEMO-HISTORY / CUSTCHART-CTRLS 등)를 따라
 *       소스-가드(정적 계약) 방식으로 결정론 검증한다. db_change=false, FE-only.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMPOSER_PATH = path.resolve(
  __dirname,
  '../../src/components/TreatmentMemoComposer.tsx',
);

function readComposer(): string {
  return fs.readFileSync(COMPOSER_PATH, 'utf-8');
}

// 컴포넌트별(composer/editor) handleKeyDown 블록을 분리 추출 — 두 곳 모두 하드닝됐는지 검사.
function keyDownBlocks(src: string): string[] {
  return src
    .split('const handleKeyDown = useCallback')
    .slice(1)
    .map((seg) => seg.slice(0, seg.indexOf('}, [handleSave, saving]);')));
}

// ── 시나리오1: 정상 동선 — 기존 저장 핸들러 재사용 + preventDefault ──

test('S1: Ctrl/Cmd+S 감지 헬퍼 존재 (ctrl|meta + s/S)', () => {
  const src = readComposer();
  expect(src).toContain('function isCtrlS');
  expect(src).toContain('(e.ctrlKey || e.metaKey)');
  expect(src).toMatch(/e\.key === 's' \|\| e\.key === 'S'/);
});

test('S1: composer/editor 모두 기존 handleSave 재사용 (신규 저장 로직 없음)', () => {
  const src = readComposer();
  const calls = (src.match(/void handleSave\(\);/g) ?? []).length;
  expect(calls).toBeGreaterThanOrEqual(2); // composer + editor
  // 단축키 경로가 DB write 를 직접 호출하지 않음(기존 경로 재사용)
  expect(src).not.toContain('supabase');
});

test('S1: 단축키 keydown 은 preventDefault() 로 브라우저 기본 저장 차단', () => {
  const blocks = keyDownBlocks(readComposer());
  expect(blocks.length).toBeGreaterThanOrEqual(2);
  for (const b of blocks) {
    expect(b).toContain('e.preventDefault();');
  }
});

// ── 시나리오2: dirty=false → 저장 미발생 ───────────────────────────

test('S2: handleSave 는 빈 입력(dirty=false)에서 early-return (불필요 저장 방지)', () => {
  const src = readComposer();
  // trim 후 비면 반환 — composer/editor 양쪽
  const guards = (src.match(/const trimmed = text\.trim\(\);\s*\n\s*if \(!trimmed\) return;/g) ?? []).length;
  expect(guards).toBeGreaterThanOrEqual(2);
});

// ── 시나리오3: 모달 가드 — 입력창 포커스 스코프 ────────────────────

test('S3: 전역 document 리스너 미도입 — Textarea onKeyDown 스코프만 사용', () => {
  const src = readComposer();
  // 전역 keydown 리스너(document/window addEventListener)로 확장하지 않음 → 모달/팝업 오작동 방지
  expect(src).not.toMatch(/addEventListener\(\s*['"]keydown['"]/);
  // 두 Textarea 모두 onKeyDown 바인딩
  const bindings = (src.match(/onKeyDown=\{handleKeyDown\}/g) ?? []).length;
  expect(bindings).toBeGreaterThanOrEqual(2);
});

// ── STORM: 자동반복·연타 저장 증폭 차단 (본 티켓 핵심) ──────────────

test('STORM(a): keydown 은 e.repeat(키 홀드 자동반복) 을 무시', () => {
  const blocks = keyDownBlocks(readComposer());
  expect(blocks.length).toBeGreaterThanOrEqual(2);
  for (const b of blocks) {
    expect(b).toContain('if (e.repeat) return;');
  }
});

test('STORM(a): saving prop 가드도 유지(버튼 disabled 미러)', () => {
  const blocks = keyDownBlocks(readComposer());
  for (const b of blocks) {
    expect(b).toContain('if (saving) return;');
  }
});

test('STORM(b): 동기 inflightRef 락 — composer/editor 양쪽 존재', () => {
  const src = readComposer();
  // useRef 로 선언된 inflight 락 2개(composer + editor)
  const decls = (src.match(/const inflightRef = useRef\(false\);/g) ?? []).length;
  expect(decls).toBe(2);
});

test('STORM(b): handleSave 진입 시 inflight 재진입 차단 + finally 해제', () => {
  const src = readComposer();
  // 진행 중 재진입 차단
  const reentryGuards = (src.match(/if \(inflightRef\.current\) return;/g) ?? []).length;
  expect(reentryGuards).toBe(2);
  // 락 set / finally 해제
  expect((src.match(/inflightRef\.current = true;/g) ?? []).length).toBe(2);
  expect((src.match(/inflightRef\.current = false;/g) ?? []).length).toBe(2);
  // 해제는 finally 블록에서 보장
  expect(src).toContain('} finally {');
});

// ── 회귀: 기존 UX 계약 보존 ────────────────────────────────────────

test('REG: 저장 버튼(메모 추가/수정 저장) 계약 유지 — onClick={handleSave}', () => {
  const src = readComposer();
  const clicks = (src.match(/onClick=\{handleSave\}/g) ?? []).length;
  expect(clicks).toBeGreaterThanOrEqual(2);
  expect(src).toContain('메모 추가');
  expect(src).toContain('수정 저장');
});
