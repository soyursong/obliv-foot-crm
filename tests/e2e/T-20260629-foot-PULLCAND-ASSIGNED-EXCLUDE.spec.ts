/**
 * T-20260629-foot-PULLCAND-ASSIGNED-EXCLUDE
 * 배정 현황판(/admin/assignments) 당김 후보 — 담당자 배정(수동·자동·토스 무관) 시 즉시 후보에서 제외.
 *
 * 버그: eligible = unassigned || waitMin >= PULL_THRESHOLD_MIN 이라 배정됐어도 10분+ 대기면 잔존
 *      (강혜인 07:03 수동배정 후 "962분 대기"로 후보 잔존, F0BEP81S3H6).
 * 수정: 당김 후보 자격 = '미배정(assigned IS NULL)'만. waitMin 은 미배정 대기시간 amber 표시용으로만 유지.
 *
 * AC1 배정(수동·자동·토스 무관) 시 즉시 당김 후보 제외
 * AC2 당김 후보 = 미배정 케이스만 (source 필터 단계 배제)
 * AC3 수동 배정 직후 목록 재조회(load) 시점에 빠짐 — stale 캐시 X
 * AC4 자동/토스 배정 건 회귀 없음 (동일 로직으로 제외)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGE_CODE = stripComments(read('src/pages/Assignments.tsx'));

test.describe('AC1·AC2 — 당김 후보 자격 = 미배정만', () => {
  test('eligible = unassigned (배정 건은 후보 아님)', () => {
    expect(PAGE_CODE).toMatch(/const eligible = unassigned;/);
  });

  test('옛 규칙 제거 — unassigned || waitMin>=THRESHOLD 잔존 안 함', () => {
    expect(PAGE_CODE).not.toMatch(/eligible = unassigned \|\| waitMin >= PULL_THRESHOLD_MIN/);
  });

  test('source 필터 단계 배제 — pullCandidates useMemo 가 eligible 로 필터', () => {
    expect(PAGE_CODE).toMatch(/\.filter\(\(x\) => x\.eligible && x\.role === activeTab\)/);
  });

  test('unassigned = 역할별 배정 id 부재(consultant_id/therapist_id)', () => {
    expect(PAGE_CODE).toMatch(/const assignedId = role === 'consult' \? ci\.consultant_id : ci\.therapist_id;/);
    expect(PAGE_CODE).toMatch(/const unassigned = !assignedId;/);
  });
});

test.describe('AC3 — 배정 직후 재조회로 즉시 제외(stale 캐시 X)', () => {
  test('pullCandidates 는 checkIns 의존 useMemo — 재조회 시 재계산', () => {
    expect(PAGE_CODE).toMatch(/const pullCandidates = useMemo\(\(\) => \{[\s\S]*?\}, \[checkIns, slotEnter, activeTab\]\);/);
  });

  test('수동 배정 성공 시 load() 재조회 호출', () => {
    expect(PAGE_CODE).toMatch(/const doManual = async[\s\S]*?if \(res\.ok\) \{[\s\S]*?void load\(\);/);
  });
});

test.describe('AC4 — 자동/토스 배정 회귀 없음(동일 로직으로 제외)', () => {
  test('토스 성공 시에도 load() 재조회 → 배정된 건 후보에서 빠짐', () => {
    expect(PAGE_CODE).toMatch(/const confirmToss = async[\s\S]*?if \(res\.ok\) \{[\s\S]*?void load\(\);/);
  });

  test('일괄 자동배정 후 load() 재조회', () => {
    expect(PAGE_CODE).toMatch(/const doBatchAutoAssign = async[\s\S]*?void load\(\);/);
  });

  test('PULL_THRESHOLD_MIN 은 amber 강조 표시용으로만 잔존(자격 판정 아님)', () => {
    expect(PAGE_CODE).toContain('PULL_THRESHOLD_MIN = 10');
    expect(PAGE_CODE).toMatch(/waitMin >= PULL_THRESHOLD_MIN \? 'font-semibold text-amber-600'/);
  });
});
