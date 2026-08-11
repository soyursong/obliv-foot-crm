/**
 * T-20260811-foot-SONGDO-FORM-DOWNLOAD — 경과분석 대상자 날짜별 치료이력 txt 다운로드 (pure-logic E2E)
 *
 * 검증 대상 = txt 계약의 결정론적 핵심(소스 A '예약/접수메모 그대로 출력'):
 *   1. 파일명 = {차트번호}_{환자명}_경과분석_{YYYYMMDD} (누락 시 미발번/무명 폴백 · 위험문자 치환).
 *   2. txt 골격 = 차트번호 + 환자명 + 날짜별(예약일시/담당자/룸/메모·시술내용).
 *   3. 메모 '그대로' 나열 — 라벨 붙이되 원문 보존, 빈 메모는 '(기록 없음)'.
 *   4. 방문 순서 = 호출부 정렬(예약일시 오름차순)을 그대로 반영.
 *   5. 방문 0건 = 안내 문구(붕괴 없음).
 *
 * 왜 pure-logic: 파일명·골격·원문보존이 임상 오독/파일붕괴의 실질 리스크. UI 게이팅(admin/manager)·
 *   supabase 조회 조립은 컴포넌트 통합(별도 수동 QA)로 확인. 본 spec 은 값 정확성을 못박는다.
 */
import { test, expect } from '@playwright/test';
import {
  progressTxtFilename,
  buildProgressTxt,
  type ProgressTxtVisit,
} from '../../src/lib/progressTreatmentTxt';

const mkVisit = (o: Partial<ProgressTxtVisit>): ProgressTxtVisit => ({
  date: '2026-08-11',
  time: '14:00',
  registrarName: null,
  room: null,
  memoLines: [],
  ...o,
});

test.describe('SONGDO-FORM-DOWNLOAD · 파일명', () => {
  test('파일명 = {차트번호}_{환자명}_경과분석_YYYYMMDD', () => {
    expect(progressTxtFilename('F-4696', '허유희', new Date('2026-08-11T09:00:00'))).toBe(
      'F-4696_허유희_경과분석_20260811',
    );
    expect(progressTxtFilename('C1', '홍길동', new Date('2026-01-05T09:00:00'))).toBe(
      'C1_홍길동_경과분석_20260105',
    );
  });

  test('차트번호/환자명 누락 → 미발번/무명 폴백(파일명 붕괴 방지)', () => {
    expect(progressTxtFilename(null, null, new Date('2026-08-11T09:00:00'))).toBe(
      '미발번_무명_경과분석_20260811',
    );
    expect(progressTxtFilename('', '', new Date('2026-08-11T09:00:00'))).toBe(
      '미발번_무명_경과분석_20260811',
    );
  });

  test('파일명 위험문자(경로구분자 등)는 _ 치환, 한글/숫자 보존', () => {
    const fn = progressTxtFilename('F/46:96', '허유희', new Date('2026-08-11T09:00:00'));
    expect(fn).not.toMatch(/[\\/:*?"<>|]/);
    expect(fn).toContain('허유희');
    expect(fn.endsWith('_경과분석_20260811')).toBe(true);
  });
});

test.describe('SONGDO-FORM-DOWNLOAD · txt 골격', () => {
  test('헤더에 차트번호·환자명·생성일·방문건수 포함', () => {
    const txt = buildProgressTxt(
      { chartNumber: 'F-4696', name: '허유희' },
      [mkVisit({})],
      new Date('2026-08-11T09:00:00'),
    );
    expect(txt).toContain('경과분석 치료이력');
    expect(txt).toContain('차트번호: F-4696');
    expect(txt).toContain('환자명: 허유희');
    expect(txt).toContain('생성일: 2026-08-11');
    expect(txt).toContain('방문 건수: 1건');
  });

  test('날짜별 블록 = 예약일시/담당자/룸/메모 노출', () => {
    const txt = buildProgressTxt(
      { chartNumber: 'F-4696', name: '허유희' },
      [
        mkVisit({
          date: '2026-05-01',
          time: '10:30',
          registrarName: '홍길동',
          room: '레이저룸',
          memoLines: ['예약메모: 내성발톱 5회차', '접수메모: 레이저 비가열 10분'],
        }),
      ],
      new Date('2026-08-11T09:00:00'),
    );
    expect(txt).toContain('2026-05-01 (금) 10:30');
    expect(txt).toContain('담당자: @홍길동');
    expect(txt).toContain('룸: 레이저룸');
    expect(txt).toContain('메모/시술내용:');
    // 메모는 원문 그대로 보존(라벨 포함).
    expect(txt).toContain('- 예약메모: 내성발톱 5회차');
    expect(txt).toContain('- 접수메모: 레이저 비가열 10분');
  });

  test('담당자/룸 누락 → — 폴백, 메모 0건 → (기록 없음)', () => {
    const txt = buildProgressTxt(
      { chartNumber: 'F-4696', name: '허유희' },
      [mkVisit({ registrarName: null, room: null, memoLines: [] })],
      new Date('2026-08-11T09:00:00'),
    );
    expect(txt).toContain('담당자: —');
    expect(txt).toContain('룸: —');
    expect(txt).toContain('메모/시술내용: (기록 없음)');
  });

  test('방문 순서 = 입력(호출부 정렬)을 그대로 반영', () => {
    const txt = buildProgressTxt(
      { chartNumber: 'F-4696', name: '허유희' },
      [
        mkVisit({ date: '2026-05-01', time: '10:00', memoLines: ['메모: 1회차'] }),
        mkVisit({ date: '2026-06-01', time: '11:00', memoLines: ['메모: 3회차'] }),
        mkVisit({ date: '2026-08-01', time: '09:00', memoLines: ['메모: 5회차'] }),
      ],
      new Date('2026-08-11T09:00:00'),
    );
    const i1 = txt.indexOf('[1]');
    const i2 = txt.indexOf('[2]');
    const i3 = txt.indexOf('[3]');
    expect(i1).toBeGreaterThan(-1);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    expect(txt).toContain('[3] 2026-08-01 (토) 09:00');
  });

  test('방문 0건 → 안내 문구(붕괴 없음)', () => {
    const txt = buildProgressTxt(
      { chartNumber: 'F-4696', name: '허유희' },
      [],
      new Date('2026-08-11T09:00:00'),
    );
    expect(txt).toContain('방문 건수: 0건');
    expect(txt).toContain('치료이력이 없습니다.');
  });
});
