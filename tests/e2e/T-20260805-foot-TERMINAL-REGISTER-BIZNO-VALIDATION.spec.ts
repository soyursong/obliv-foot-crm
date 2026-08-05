/**
 * Spec — T-20260805-foot-TERMINAL-REGISTER-BIZNO-VALIDATION
 *
 * 목적: 단말 등록(AdminSettings ⑧ 카드 단말기 설정) 시 스태프가 910115 조회 화면에서 읽은
 *   사업자번호를 입력하면 능동 대조 → 구번호(511-60-00988)/불일치면 저장 confirm 게이트(soft-block).
 *   부모 REDPAY-INVISIBLE ④: 구 사업자번호로 등록된 단말 → RedPay 정산 조회 0건(전 기간 사각).
 *   자매 VERIFY-UX(정적 가이드 배너·TID축) 위에 사업자번호 값 대조 축을 추가한다(직교축).
 *
 * 계약(AC):
 *   AC-1: 스태프가 입력한 사업자번호를 기대값(457-23-00938)과 대조(classifyBizno 순수 로직).
 *   AC-2: 구번호/불일치 감지 → shouldBlock=true → 저장 confirm 게이트 + confirm-through 감사 로깅.
 *         ★hard-block 아님(현장 확인 게이트) — 명시 확인 체크 시 저장 진행.
 *   AC-3: 910115 조회 API 부재(census) → 스태프 수동 입력 기반 대조로 착지.
 *
 * ⚠ SectionTerminal 렌더는 supabase auth 밖 → 여기서는 순수 검증 모듈(classifyBizno/formatBizno/
 *   normalizeBizno) 계약 + AdminSettings 소스 정합(입력 앵커·confirm 게이트·로깅·무차단)을 검증한다.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  classifyBizno,
  formatBizno,
  normalizeBizno,
  EXPECTED_FOOT_BIZNO,
  STALE_FOOT_BIZNO,
} from '../../src/lib/cband/biznoValidation';

const ADMIN = 'src/pages/AdminSettings.tsx';
function readAdmin(): string {
  return fs.readFileSync(ADMIN, 'utf8');
}

// ─── 순수 대조 로직(AC-1·AC-2 핵심) ─────────────────────────────────────────────
test('AC-1: 기대 사업자번호(457-23-00938) 입력 → match', () => {
  expect(classifyBizno('457-23-00938').status).toBe('match');
  // 하이픈/공백 유무에 무관(정규화 후 대조).
  expect(classifyBizno('4572300938').status).toBe('match');
  expect(classifyBizno(' 457 23 00938 ').status).toBe('match');
});

test('AC-2: 구 사업자번호(511-60-00988) 입력 → stale + shouldBlock', () => {
  const v = classifyBizno('511-60-00988');
  expect(v.status).toBe('stale');
  expect(v.shouldBlock).toBe(true);
  expect(classifyBizno('5116000988').status).toBe('stale');
});

test('AC-2: 기대·구 어느 것도 아닌 번호 → mismatch + shouldBlock', () => {
  const v = classifyBizno('123-45-67890');
  expect(v.status).toBe('mismatch');
  expect(v.shouldBlock).toBe(true);
});

test('AC-2: 자리 미달/미입력 → empty(미판정, 저장 안 막음)', () => {
  expect(classifyBizno('').status).toBe('empty');
  expect(classifyBizno('457-23').status).toBe('empty');   // 10자리 미만
  expect(classifyBizno('').shouldBlock).toBe(false);
  expect(classifyBizno('457-23').shouldBlock).toBe(false);
});

test('normalizeBizno/formatBizno — 숫자 정규화 + 표준 표기', () => {
  expect(normalizeBizno('457-23-00938')).toBe('4572300938');
  expect(normalizeBizno(' 45 7a2300938 ')).toBe('4572300938');
  expect(normalizeBizno(null)).toBe('');
  expect(formatBizno('4572300938')).toBe('457-23-00938');
  expect(formatBizno('457')).toBe('457');
  expect(formatBizno('45723')).toBe('457-23');
  // 10자리 초과분은 절삭.
  expect(formatBizno('457230093899')).toBe('457-23-00938');
});

test('상수 SSOT — 기대/구 사업자번호가 모듈에 고정', () => {
  expect(EXPECTED_FOOT_BIZNO).toBe('457-23-00938');
  expect(STALE_FOOT_BIZNO).toBe('511-60-00988');
});

test('classifyBizno opts — 기대/구 값 주입 가능(문구 검수·재사용)', () => {
  const v = classifyBizno('999-99-99999', { expected: '999-99-99999' });
  expect(v.status).toBe('match');
});

// ─── AC-1·AC-2 소스 정합: 입력 UI · confirm 게이트 · 로깅 ──────────────────────────
test('AC-1: 단말 사업자번호 입력 칸이 있고 classifyBizno 로 대조한다', () => {
  const src = readAdmin();
  expect(src.includes('terminal-bizno-input')).toBe(true);
  expect(src).toMatch(/from '@\/lib\/cband\/biznoValidation'/);
  expect(src.includes('classifyBizno')).toBe(true);
});

test('AC-2: 구번호/불일치 상태별 경고 배너 + confirm 체크 앵커가 있다', () => {
  const src = readAdmin();
  expect(src.includes('terminal-bizno-stale')).toBe(true);
  expect(src.includes('terminal-bizno-mismatch')).toBe(true);
  expect(src.includes('terminal-bizno-match')).toBe(true);
  expect(src.includes('terminal-bizno-confirm-checkbox')).toBe(true);
});

test('AC-2: soft-block — shouldBlock && !confirm 이면 저장 보류(return), 확인 시 진행', () => {
  const src = readAdmin();
  const section = src.slice(src.indexOf('function SectionTerminal()'));
  const handleStart = section.indexOf('const handleSave');
  const handleBody = section.slice(handleStart, section.indexOf('return (', handleStart));
  // confirm 게이트: shouldBlock && !confirmStale 이면 return(저장 보류).
  expect(handleBody).toMatch(/biznoVerdict\.shouldBlock\s*&&\s*!confirmStale/);
  expect(handleBody.includes('return;')).toBe(true);
  // ★hard-block 아님 — 확인 체크(confirmStale) 시 아래 saveTerminalConfig 로 진행.
  expect(handleBody.includes('saveTerminalConfig')).toBe(true);
});

test('AC-2: confirm-through 감사 로깅(정산 사각 사후추적 흔적)', () => {
  const src = readAdmin();
  expect(src.includes('bizno_confirm_through')).toBe(true);
  expect(src.includes('CONFIRM-THROUGH')).toBe(true);
});

// ─── AC-3: 자동 취득 불가(910115 API 부재) → 스태프 수동 입력 착지 ────────────────
test('AC-3: 910115 수동 조회 입력 가이드 문구가 있다(자동 API 부재 census 착지)', () => {
  const src = readAdmin();
  expect(src).toMatch(/910115/);
  expect(src.includes('terminal-bizno-input')).toBe(true);
});
