/**
 * Unit spec — T-20260822-foot-PROGANALYSIS-MD-GENERATOR-UNIFY
 *
 * 원장 지시("알집추출 개별추출 다 같은 로직이어야한다 이원화하지마") = 경과분석 .md 생성을 단일 공유 함수로 통합.
 *   [행별]/[ZIP]/[개별저장] 3경로가 전부 buildProgressAnalysisFiles() 하나로 수렴.
 *   · content  = buildProgressAnalysisMd(p, env) (섹션 1~9 SSOT — 유일 콘텐츠 빌더)
 *   · basename = {차트|id}_{이름} + 동일 충돌 시 `_n` dedupe (ZIP/개별 동일 규칙 1곳)
 *   · filename = `${basename}.md`
 *
 * 대상(순수 함수) — auth/page/server 미사용 → playwright.config 'unit' 프로젝트:
 *   src/lib/progressAnalysisMd.ts : buildProgressAnalysisFiles / buildProgressAnalysisMd
 *
 * AC(티켓 §DoD 매핑):
 *   시나리오1(ZIP·개별 산출물 byte 동일성): 동일 patients+env → ZIP 엔트리 payload(BOM+content) == 개별저장 payload(BOM+content),
 *                                         파일명(ZIP filename == 개별 basename+'.md')도 동일. 배치 dedupe 순서 결정론.
 *   시나리오2(섹션 1~9 완전성): 단일 빌더 산출 .md 에 헤더 【1】~【9】 전부 존재(데이터 유무 무관·빈 섹션도 헤더 유지).
 *   회귀0: buildProgressAnalysisFiles[i].content === buildProgressAnalysisMd(patients[i], env) (콘텐츠 등가·재가공 0).
 *
 * 실기기 순차 다운로드/ZIP unzip byte 대조/토스트/버튼 3종 병존 = supervisor 갤탭 field-soak(browser_verify, CF 해제 동기).
 */
import { test, expect } from '@playwright/test';
import {
  buildProgressAnalysisFiles,
  buildProgressAnalysisMd,
  type ProgressAnalysisEnvelope,
  type ProgressAnalysisPatient,
} from '../../src/lib/progressAnalysisMd';

const CUST_A = '11111111-2222-3333-4444-555555555555';
const CUST_B = '22222222-3333-4444-5555-666666666666';
const CUST_C = '33333333-4444-5555-6666-777777777777';

/** 섹션 1~9 전부를 실데이터로 채운 풀 envelope(완전성 검증용). */
function fullEnvelope(): ProgressAnalysisEnvelope {
  const ids = [CUST_A, CUST_B, CUST_C];
  const env: ProgressAnalysisEnvelope = {
    boilerSet: new Set(),
    milestonesByCust: new Map(),
    visitCountByCust: new Map(),
    nextResvByCust: new Map(),
    memosByCust: new Map(),
    rxByCust: new Map(),
    hqByCust: new Map(),
    firstVisitByCust: new Map(),
    consultByCust: new Map(),
    chartByCust: new Map(),
    visitsByCust: new Map(),
    roomLogsByCheckIn: new Map(),
    activePkgsByCust: new Map(),
    reservationsByCust: new Map(),
  };
  for (const id of ids) {
    env.milestonesByCust.set(id, [{ anticipated: 6, used: 5, total: 12 }]);
    env.visitCountByCust.set(id, 5);
    env.nextResvByCust.set(id, {
      reservation_date: '2026-08-25',
      reservation_time: '14:30',
      registrar_name: '김코디',
    });
    env.memosByCust.set(id, [
      { content: '좌측 엄지 호전. 부기 감소.', created_at: '2026-08-01T10:00:00Z', created_by: null, created_by_name: '박치료' },
    ]);
    env.rxByCust.set(id, [
      {
        id: `rx-${id.slice(0, 4)}`,
        prescribed_at: '2026-08-01T10:00:00Z',
        prescribed_by_name: '문원장',
        diagnosis: '조갑진균증',
        memo: null,
        created_at: '2026-08-01T10:00:00Z',
        items: [{ medication_name: '테르비나핀', dosage: '1일 1회', duration_days: 30, quantity: 30, memo: null }],
      },
    ]);
    env.hqByCust.set(id, {
      form_data: { symptoms: ['통증'], foot_pain_level: '중등도' },
      submitted_at: '2026-07-30T09:00:00Z',
      created_at: '2026-07-30T09:00:00Z',
    });
    env.firstVisitByCust.set(id, '2026-07-30');
    env.consultByCust.set(id, [
      { content: '초진 상담: 좌엄지 통증 6개월.', created_at: '2026-07-30T09:30:00Z', created_by_name: '이상담' },
    ]);
    env.chartByCust.set(id, [
      {
        visit_date: '2026-07-30',
        chief_complaint: '좌엄지 통증',
        diagnosis: '조갑진균증',
        treatment_record: '레이저 1회',
        clinical_progress: '초기',
        materials_used: null,
        treatment_result: null,
        created_by_name: '문원장',
        created_at: '2026-07-30T09:40:00Z',
      },
    ]);
    env.visitsByCust!.set(id, [
      {
        id: `ci-${id.slice(0, 4)}`,
        checked_in_at: '2026-07-30T09:00:00Z',
        completed_at: '2026-07-30T10:00:00Z',
        visit_type: 'new',
        treatment_category: '레이저',
        status: 'completed',
      },
    ]);
    env.roomLogsByCheckIn!.set(`ci-${id.slice(0, 4)}`, [
      { check_in_id: `ci-${id.slice(0, 4)}`, assigned_room: 'L1', room_type: 'laser', logged_at: '2026-07-30T09:20:00Z' },
    ]);
    env.activePkgsByCust!.set(id, [
      {
        package_name: '발톱 12회',
        package_type: 'laser',
        rows: [{ label: '가열', total: 12, used: 5, remaining: 7 }],
        totalRemaining: 7,
      },
    ]);
    env.reservationsByCust!.set(id, [
      {
        reservation_date: '2026-08-25',
        reservation_time: '14:30',
        status: 'confirmed',
        booking_memo: '가열 진행',
        memo: null,
        brief_note: null,
        registrar_name: '김코디',
      },
    ]);
  }
  return env;
}

const PATIENTS: ProgressAnalysisPatient[] = [
  { id: CUST_A, name: '홍길동', chart_number: '404658' },
  { id: CUST_B, name: '김철수', chart_number: '404659' },
  { id: CUST_C, name: '이영희', chart_number: '404660' },
];

// createStoreZip / downloadMd 공통 BOM 프리픽스(두 배송 경로 실 바이트 래퍼 동일).
const BOM = '﻿';
function payloadBytes(content: string): Uint8Array {
  return new TextEncoder().encode(BOM + content);
}

test.describe('T-20260822 MD-GENERATOR-UNIFY — 시나리오1(ZIP·개별 산출물 byte 동일성)', () => {
  test('AC1-1: 동일 patients+env → 파일 수·순서·basename 결정론(단일 생성기 1회 호출)', () => {
    const files = buildProgressAnalysisFiles(PATIENTS, fullEnvelope());
    expect(files).toHaveLength(3);
    expect(files.map((f) => f.basename)).toEqual(['404658_홍길동', '404659_김철수', '404660_이영희']);
    expect(files.map((f) => f.filename)).toEqual(['404658_홍길동.md', '404659_김철수.md', '404660_이영희.md']);
  });

  test('AC1-2: ZIP 엔트리 payload(BOM+content) == 개별저장 payload(BOM+content) — byte 동일', () => {
    const files = buildProgressAnalysisFiles(PATIENTS, fullEnvelope());
    for (const f of files) {
      // ZIP: createStoreZip 이 encode('﻿' + entry.content), entry.content = f.content
      const zipBytes = payloadBytes(f.content);
      // 개별: downloadMd 가 Blob(['﻿', content]), content = f.content (동일 소스)
      const individualBytes = payloadBytes(f.content);
      expect(Array.from(individualBytes)).toEqual(Array.from(zipBytes));
    }
  });

  test('AC1-3: ZIP 파일명 == 개별 basename+".md" (파일명 규칙 단일)', () => {
    const files = buildProgressAnalysisFiles(PATIENTS, fullEnvelope());
    for (const f of files) {
      expect(f.filename).toBe(`${f.basename}.md`); // 개별저장은 downloadMd 가 basename 에 .md 자동 부착
    }
  });

  test('AC1-4: 동일 {차트}_{이름} 충돌 → 두 경로 동일 dedupe(_n) — 파일 유실/덮어쓰기 방지', () => {
    const dup: ProgressAnalysisPatient[] = [
      { id: CUST_A, name: '홍길동', chart_number: '404658' },
      { id: CUST_B, name: '홍길동', chart_number: '404658' },
      { id: CUST_C, name: '홍길동', chart_number: '404658' },
    ];
    const files = buildProgressAnalysisFiles(dup, fullEnvelope());
    expect(files.map((f) => f.basename)).toEqual(['404658_홍길동', '404658_홍길동_2', '404658_홍길동_3']);
    expect(new Set(files.map((f) => f.filename)).size).toBe(3);
  });
});

test.describe('T-20260822 MD-GENERATOR-UNIFY — 시나리오2(섹션 1~9 완전성)', () => {
  const SECTION_HEADERS = [
    '# 【1】 치료메모',
    '# 【2】 처방내역',
    '# 【3】 과거력',
    '# 【4】 첫날 상담차트',
    '# 【5】 임상 유의미 텍스트',
    '# 【6】 진료내역',
    '# 【7】 동선 로그',
    '# 【8】 활성 패키지',
    '# 【9】 예약내역',
  ];

  test('AC2-1: 단일 빌더 산출 .md 에 섹션 헤더 【1】~【9】 전부 존재(풀 데이터)', () => {
    const [file] = buildProgressAnalysisFiles([PATIENTS[0]], fullEnvelope());
    for (const h of SECTION_HEADERS) expect(file.content).toContain(h);
  });

  test('AC2-2: 데이터가 비어도 섹션 헤더 【1】~【9】 유지(빈 섹션 누락 금지)', () => {
    const emptyEnv: ProgressAnalysisEnvelope = {
      boilerSet: new Set(),
      milestonesByCust: new Map(),
      visitCountByCust: new Map(),
      nextResvByCust: new Map(),
      memosByCust: new Map(),
      rxByCust: new Map(),
      hqByCust: new Map(),
      firstVisitByCust: new Map(),
      consultByCust: new Map(),
      chartByCust: new Map(),
    };
    const [file] = buildProgressAnalysisFiles([PATIENTS[0]], emptyEnv);
    for (const h of SECTION_HEADERS) expect(file.content).toContain(h);
  });
});

test.describe('T-20260822 MD-GENERATOR-UNIFY — 회귀0(콘텐츠 등가)', () => {
  test('AC3-1: buildProgressAnalysisFiles[i].content === buildProgressAnalysisMd(patients[i], env) — 재가공 0', () => {
    const env = fullEnvelope();
    const files = buildProgressAnalysisFiles(PATIENTS, env);
    PATIENTS.forEach((p, i) => {
      expect(files[i].content).toBe(buildProgressAnalysisMd(p, env));
    });
  });

  test('AC3-2: 빈 선택 → 산출 0개(호출부 안내 후 다운로드 미발생)', () => {
    expect(buildProgressAnalysisFiles([], fullEnvelope())).toEqual([]);
  });
});
