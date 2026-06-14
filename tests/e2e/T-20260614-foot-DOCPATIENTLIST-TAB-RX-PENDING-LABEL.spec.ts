/**
 * E2E spec — T-20260614-foot-DOCPATIENTLIST-TAB-RX-PENDING-LABEL
 * 진료환자목록(DoctorPatientList) 상단 탭 라벨 "임시" → "처방확인 대기" 텍스트 변경.
 * (문지은 대표원장 6/14: "'임시'는 의미가 불명확 → 치료사가 처방 입력 후 원장 확인을
 *  기다리는 상태임을 명확히 '처방확인 대기'로 변경")
 *
 * 변경 범위: pending 탭 라벨 텍스트만. 필터 key='pending'/카운트 로직 무변경.
 * 스타일: 컴포넌트가 auth/DB 의존이라 DoctorPatientList.tsx 정본을 직접 읽어
 *   탭 라벨 텍스트·괄호 카운트 포맷·필터 key 무변경을 회귀로 잡는다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname_, '../../src/components/doctor/DoctorPatientList.tsx');
const src = readFileSync(SRC, 'utf-8');

// 탭 정의 배열 영역(all/pending/confirmed)에서 pending 탭 라인 추출.
const pendingTabLine = src
  .split('\n')
  .find((l) => l.includes("key: 'pending'") && l.includes('label:'));

test.describe('시나리오1 — pending 탭 라벨 "처방확인 대기" 표시', () => {
  test('AC-1: pending 탭 라벨이 "처방확인 대기 (카운트)"로 변경됨', () => {
    expect(pendingTabLine).toBeTruthy();
    // 새 라벨 텍스트 + 괄호 카운트 포맷(${pendingCount}) 유지.
    expect(pendingTabLine!).toContain('처방확인 대기 (${pendingCount})');
  });

  test('AC-2: 기존 "임시 (${pendingCount})" 탭 라벨 잔존 0건', () => {
    expect(src).not.toContain('label: `임시 (${pendingCount})`');
  });
});

test.describe('시나리오2 — 회귀 가드 (동작·필터·카운트 무변경)', () => {
  test('필터 key="pending" 무변경 — 탭 동작/필터 로직 보존', () => {
    expect(pendingTabLine!).toContain("key: 'pending'");
  });

  test('다른 탭(전체/처방환자 목록) 라벨·카운트 무변경', () => {
    expect(src).toContain('전체 (${patients.length})');
    expect(src).toContain('처방환자 목록 (${confirmedCount})');
  });

  test('pendingCount 집계 로직 무변경 — 변수 참조 유지', () => {
    // 라벨/배지 등에서 pendingCount 참조가 유지되어 카운트 표기가 정상 동작.
    const hits = [...src.matchAll(/pendingCount/g)].length;
    expect(hits).toBeGreaterThanOrEqual(2);
  });
});
