/**
 * T-20260817-foot-TREATHIST-DOWNLOAD-MISSING-FIELDS — 치료이력 txt 다운로드 신규 필드 (pure-logic E2E)
 *
 * 배경: 치료테이블 > 경과분석 > '치료이력 다운로드'(txt, handleTxtExport) 산출물에 중요 필드 누락.
 *   총괄 요구 = (1) 날짜별 치료종류(비가열/가열/포돌로게 구분), (2) PC(프리컨디셔닝) 유무 추가.
 *   소스 = 펜차트 자동기록 필드(package_sessions.session_type + check_ins.preconditioning_done). 신규 스키마 0.
 *
 * 검증 대상 = 신규 파생 순수 함수 treatmentTypeMemoLines 의 결정론적 계약:
 *   1. 치료종류 = PC 제외 session_type → 한글 라벨(비가열/가열/포돌로게 등), 중복 제거, ', ' 결합.
 *   2. PC 유무 = session_type='preconditioning' OR preconditioning_done → '있음', 아니면 '없음'.
 *   3. PC 판정은 접수(check_in) 연결분에 한해서만(hasCheckIn=false → PC 라인 생략, 단정 금지).
 *   4. 기존 txt 골격/포맷(buildProgressTxt)은 무변경 — 신규 라인은 memoLines 로 흡수(불변식).
 *
 * 왜 pure-logic: 라벨 매핑·PC 유무 판정이 임상 오독의 실질 리스크. supabase 조인 조립·UI 게이팅은
 *   컴포넌트 통합(수동 QA)로 확인. 본 spec 은 값 정확성을 못박는다(SONGDO-FORM-DOWNLOAD 선례 동형).
 */
import { test, expect } from '@playwright/test';
import { treatmentTypeMemoLines, buildProgressTxt } from '../../src/lib/progressTreatmentTxt';

test.describe('TREATHIST-DOWNLOAD · 치료종류(비가열/가열/포돌로게)', () => {
  test('session_type → 한글 라벨(비가열/가열/포돌로게 구분)', () => {
    expect(treatmentTypeMemoLines(['unheated_laser'], undefined, true)).toContain('치료종류: 레이저비가열');
    expect(treatmentTypeMemoLines(['heated_laser'], undefined, true)).toContain('치료종류: 레이저가열');
    expect(treatmentTypeMemoLines(['podologue'], undefined, true)).toContain('치료종류: 발톱교정');
  });

  test('같은 날 복수 시술 = 중복 제거 + , 결합(순서 보존)', () => {
    const lines = treatmentTypeMemoLines(
      ['heated_laser', 'podologue', 'heated_laser'],
      undefined,
      true,
    );
    expect(lines).toContain('치료종류: 레이저가열, 발톱교정');
  });

  test('PC(preconditioning)는 치료종류 목록에서 제외(별도 PC 필드로만 표기)', () => {
    const lines = treatmentTypeMemoLines(['preconditioning', 'unheated_laser'], undefined, true);
    // 치료종류에는 레이저비가열만, 프리컨디셔닝은 빠짐.
    expect(lines).toContain('치료종류: 레이저비가열');
    expect(lines.find((l) => l.startsWith('치료종류'))).not.toContain('프리컨디셔닝');
  });

  test('시술타입 없음(비패키지 방문) → 치료종류 라인 생략', () => {
    const lines = treatmentTypeMemoLines([], undefined, true);
    expect(lines.some((l) => l.startsWith('치료종류'))).toBe(false);
  });
});

test.describe('TREATHIST-DOWNLOAD · PC(프리컨디셔닝) 유무', () => {
  test('session_type=preconditioning → PC 있음', () => {
    expect(treatmentTypeMemoLines(['preconditioning'], undefined, true)).toContain('PC(프리컨디셔닝): 있음');
  });

  test('preconditioning_done=true → PC 있음(펜차트 자동기록 boolean OR-병합)', () => {
    expect(treatmentTypeMemoLines(['heated_laser'], true, true)).toContain('PC(프리컨디셔닝): 있음');
  });

  test('둘 다 부재 → PC 없음(유무 명시)', () => {
    expect(treatmentTypeMemoLines(['heated_laser'], false, true)).toContain('PC(프리컨디셔닝): 없음');
    expect(treatmentTypeMemoLines(['podologue'], undefined, true)).toContain('PC(프리컨디셔닝): 없음');
  });

  test('접수 미연결(hasCheckIn=false) → PC 판정 불가, PC 라인 생략(단정 금지)', () => {
    const lines = treatmentTypeMemoLines([], undefined, false);
    expect(lines.some((l) => l.startsWith('PC'))).toBe(false);
  });
});

test.describe('TREATHIST-DOWNLOAD · 기존 txt 골격 불변식', () => {
  test('신규 라인은 memoLines 로 흡수 — buildProgressTxt 포맷/헤더 무변경', () => {
    const extra = treatmentTypeMemoLines(['unheated_laser', 'preconditioning'], undefined, true);
    const txt = buildProgressTxt(
      { chartNumber: 'F-4696', name: '허유희' },
      [
        {
          date: '2026-08-11',
          time: '14:00',
          registrarName: '홍길동',
          room: '레이저룸',
          memoLines: ['예약메모: 5회차', ...extra],
        },
      ],
      new Date('2026-08-17T09:00:00'),
    );
    // 기존 골격(차트번호/환자명/하단 메타) 유지.
    expect(txt).toContain('차트번호 : F-4696');
    expect(txt).toContain('환자명 : 허유희');
    expect(txt).toContain('경과분석 치료이력 · 생성일 2026-08-17 · 방문 1건');
    // 신규 필드가 방문 블록 안에 그대로 렌더.
    expect(txt).toContain('치료종류: 레이저비가열');
    expect(txt).toContain('PC(프리컨디셔닝): 있음');
    // 기존 메모도 보존.
    expect(txt).toContain('예약메모: 5회차');
  });
});
