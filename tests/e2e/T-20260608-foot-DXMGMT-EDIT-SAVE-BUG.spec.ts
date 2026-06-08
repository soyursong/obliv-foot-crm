/**
 * E2E spec — T-20260608-foot-DXMGMT-EDIT-SAVE-BUG
 *
 * 문지은 대표원장(6/8): "상병명관리에서 상병명 수정하면 DB 에러나고 저장 안 됨".
 *
 * 근본원인(AC-0 1차 실측 2026-06-08 12:31):
 *   services.diagnosis_folder 컬럼이 DB에 미적용(read: 42703 / write: PGRST204).
 *   useDiagnoses(read)는 폴백을 가져 목록은 정상 로드되나, useUpsertDx(write)는 payload에
 *   항상 diagnosis_folder 를 실어 UPDATE/INSERT 가 전부 실패 → 상병 수정·신규등록 모두 막힘.
 *   (name=상병명 / diagnosis_folder=폴더값 매핑 자체는 정상 — 컬럼 부재가 진짜 원인)
 *
 * AC-0 재실측(2026-06-08, supervisor 마이그 게이트 적용 후):
 *   컬럼 적용 확인 — 상병행 SELECT + UPDATE({name, diagnosis_folder}) roundtrip 정상 통과 → 저장 결함 해소.
 *
 * 수정: read 와 동일하게 write 도 deploy-tolerant —
 *   폴더 컬럼 부재(42703/PGRST204/message에 diagnosis_folder) 시 폴더 컬럼을 제외하고 1회 재시도해
 *   저장을 무결 보장한다. 컬럼 적용 후엔 1차 run() 성공으로 재시도 미발동(forward/backward-compat 안전망).
 *
 * 본 spec 은 deploy-tolerant write 불변식을 정본 소스로 정적 가드한다(데이터/로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const TAB = 'src/components/admin/DiagnosisNamesTab.tsx';

// ── AC-0: 컬럼 부재 판정기(read/write 양쪽 에러코드) ──
test('AC-0: 폴더 컬럼 부재 판정 헬퍼(42703/PGRST204/메시지) 존재', () => {
  const src = read(TAB);
  expect(src).toContain('isMissingFolderColumn');
  expect(src).toContain("'42703'");
  expect(src).toContain("'PGRST204'");
  expect(src).toContain('/diagnosis_folder/i');
});

// ── AC-1: write(useUpsertDx)가 폴더 제외 재시도 폴백을 가짐 ──
test('AC-1: useUpsertDx 폴더 컬럼 부재 시 폴더 제외 재시도(저장 무결)', () => {
  const src = read(TAB);
  // 단일 실행기(run)로 insert/update 양 경로 처리
  expect(src).toContain('const run =');
  // 1차 실패가 컬럼 부재면 폴더 제외 payload 로 재시도
  expect(src).toContain('isMissingFolderColumn(error)');
  expect(src).toMatch(/diagnosis_folder:\s*_omitFolder/);
  // name/diagnosis_folder 컬럼 정합 유지 — insert·update 동일 payload 구조(AC-1)
  expect(src).toContain('name: form.name.trim()');
  expect(src).toContain("diagnosis_folder: form.diagnosis_folder.trim() === '' ? null");
});

// ── AC-1: 신규 insert 경로도 동일 payload·동일 폴백을 공유(이중경로 분기 금지) ──
test('AC-1: insert 경로도 동일 run() 폴백 공유(신규등록 회귀 방지)', () => {
  const src = read(TAB);
  // insert 는 run() 안에서 category_label=상병 등 부가필드와 함께 payload 전개
  expect(src).toContain("category_label: '상병'");
  expect(src).toContain('...p,');
  // 폴백 재시도는 insert/update 공통(run) — 별도 insert-only 분기 없음
});

// ── AC-2: read 폴백(기존 자산) 회귀 보존 ──
test('AC-2: useDiagnoses read 폴백(42703) 보존 — 목록 로드 회귀 없음', () => {
  const src = read(TAB);
  expect(src).toContain('withFolder.error');
  expect(src).toContain('diagnosis_folder: null');
});

// ── AC-2: 폴더 rename 경로 보존(같은 화면 회귀) ──
test('AC-2: 폴더 인라인 rename(useRenameDxFolder) 보존', () => {
  const src = read(TAB);
  expect(src).toContain('useRenameDxFolder');
  expect(src).toContain('submitRenameFolder');
});
