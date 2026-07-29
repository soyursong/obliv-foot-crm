/**
 * E2E spec — T-20260729-foot-ALERTBOARD-DOBTXRX-COL-BLANK
 * 진료 알림판 소견서·진단서 목록(처리대기 + 서류완료) 3컬럼(생년(만나이)/오늘시술/처방내역) 전행 공란 — read-only 결선 복구.
 *
 * RC (런타임 재현으로 확정 — scripts/T-20260729-...-COL-BLANK_probe.mjs):
 *   선례 JINRYO-ALIMPAN-3COL 배선이 실 데이터 없는 소스를 봐 3컬럼이 전행 공란이었다.
 *     · 생년(만나이) : 표기 birthYearAgeDisplay 가 6자리 YYMMDD 만 파싱 → 실 소스가 만드는 8자리
 *         (ISO "1994-05-30" / 스냅샷 "1994년 05월 30일")를 무효 처리(mm>12) → 공란.
 *     · 오늘시술     : check_ins.treatment_kind(전행 NULL) + '글로벌 오늘(KST)' 스코프 → 서류완료(과거일) 전면 배제.
 *     · 처방내역     : 소스(check_in_services 처방약)는 데이터 존재하나, today-글로벌 check_ins 로만 조회 → 과거일 행 공란.
 *
 * FIX: 각 행의 방문(check_in_id) 앵커로 재결선(loadOpinionAutofillRef 동형, read-only, DDL/write 0).
 *   · 생년(만나이) : birthYearAgeDisplay 가 8자리 정년도 파싱(앞 4자리=정년). 6자리 경로 불변(회귀 0).
 *   · 오늘시술     : 이 방문 package_sessions.session_type(=차트2 티켓 차감/패키지 회차 차감) → sessionTypeLabel 간략형.
 *   · 처방내역     : 이 방문 check_in_services 처방약(category_label='처방약') service_name.
 *
 * 검증(정본 모사 — 구현 정본 birthYearAgeDisplay / sessionTypeLabel / extractRxDrugNames / 방문 스코프 결선 동치 모사):
 *   시나리오 A(처리대기 draft 행)  : 방문에 레이저비가열 차감 + 처방약 + 스냅샷 생년 → 3컬럼 전부 결선(공란 재발 없음).
 *   시나리오 B(서류완료 과거일 행) : 과거일 발행 행도 방문 앵커로 시술·처방 결선(today-글로벌 RC 재발 차단).
 *   S1 생년 포맷 매트릭스 : ISO 8자리 / 스냅샷 "YYYY년MM월DD일" / 레거시 6자리 모두 "YYYY (만 N세)" 파생, 무효는 ''.
 *   S2 오늘시술 : session_type → 간략형 라벨, 차감 없으면 '' (당일 차감 없으면 공란, AC).
 *   S3 처방내역 : check_in_services 중 category='처방약' 만, 시술/검사/상병 라인 배제.
 *   S4 스코프 무결 : 다른 방문(check_in_id) 데이터는 결선되지 않음(타 환자 유입 배제, read-only 스코프 가드).
 *
 * 스타일: in-page 순수 로직 시뮬레이션(정본 모사) — auth/DB 의존 회피, DOCFORM-AUTOFILL/KOH spec 동일 컨벤션.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: birthYearAgeDisplay (src/lib/format.ts, 8자리 정년 흡수 포함) ──
function ageSuffix(birthYear: number, mm: number, dd: number): string {
  const now = new Date();
  let age = now.getFullYear() - birthYear;
  const curMonth = now.getMonth() + 1;
  const curDay = now.getDate();
  if (curMonth < mm || (curMonth === mm && curDay < dd)) age -= 1;
  if (age < 0 || age > 130) return String(birthYear);
  return `${birthYear} (만 ${age}세)`;
}
function birthYearAgeDisplay(birth_date: string | null | undefined): string {
  if (!birth_date) return '';
  const digits = String(birth_date).replace(/\D/g, '');
  if (digits.length < 6) return '';
  if (digits.length >= 8) {
    const birthYear = Number(digits.slice(0, 4));
    const mm = Number(digits.slice(4, 6));
    const dd = Number(digits.slice(6, 8));
    if (Number.isNaN(birthYear) || Number.isNaN(mm) || Number.isNaN(dd)) return '';
    if (birthYear < 1900 || birthYear > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
    return ageSuffix(birthYear, mm, dd);
  }
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  if (Number.isNaN(yy) || Number.isNaN(mm) || Number.isNaN(dd)) return '';
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  const curYY = new Date().getFullYear() % 100;
  const birthYear = (yy <= curYY ? 2000 : 1900) + yy;
  return ageSuffix(birthYear, mm, dd);
}

// ── 정본 모사: sessionTypeLabel (src/lib/progressTreatmentCsv.ts) ──
const SESSION_TYPE_LABEL: Record<string, string> = {
  heated_laser: '레이저가열', unheated_laser: '레이저비가열', podologue: '발톱교정',
  ribbon: '각질', preconditioning: '프리컨디셔닝', iv: '수액', trial: '체험', reborn: 'Re:Born',
};
const sessionTypeLabel = (code: string | null | undefined): string =>
  !code ? '' : (SESSION_TYPE_LABEL[code] ?? code);

// ── 정본 모사: extractRxDrugNames (src/lib/opinionRequest.ts) ──
function extractRxDrugNames(cisRows: Array<Record<string, unknown>>): string[] {
  const names: string[] = [];
  for (const r of cisRows) {
    const svc = r['services'] as { category_label?: string | null } | Array<{ category_label?: string | null }> | null | undefined;
    const cat = Array.isArray(svc) ? (svc[0]?.category_label ?? '') : (svc?.category_label ?? '');
    if (cat !== '처방약') continue;
    const nm = String(r['service_name'] ?? '').trim();
    if (nm) names.push(nm);
  }
  return names;
}

// ── 정본 모사: useQueueVisitProcedureRx 의 방문 스코프 결선(단일 check_in_id) ──
interface VisitData {
  packageSessions: Array<{ check_in_id: string; session_type: string | null; session_number: number }>;
  checkInServices: Array<Record<string, unknown>>; // check_in_id + service_name + services.category_label
}
function resolveVisit(checkInId: string | null, db: VisitData): { procedures: string[]; prescriptions: string[] } {
  const out = { procedures: [] as string[], prescriptions: [] as string[] };
  if (!checkInId) return out;
  for (const p of db.packageSessions.filter((x) => x.check_in_id === checkInId).sort((a, b) => a.session_number - b.session_number)) {
    const label = sessionTypeLabel(p.session_type);
    if (label && !out.procedures.includes(label)) out.procedures.push(label);
  }
  const cis = db.checkInServices.filter((x) => String(x['check_in_id']) === checkInId);
  for (const nm of extractRxDrugNames(cis)) if (!out.prescriptions.includes(nm)) out.prescriptions.push(nm);
  return out;
}
const svcRow = (cin: string, name: string, cat: string) => ({ check_in_id: cin, service_name: name, services: { category_label: cat } });

test.describe('T-20260729-foot-ALERTBOARD-DOBTXRX-COL-BLANK — 알림판 3컬럼 방문 스코프 결선', () => {
  // 시나리오 A: 처리대기(draft) 행 — 원장이 알림판에서 처리대기 목록을 볼 때.
  test('시나리오A 처리대기: 방문에 차감·처방·스냅샷 생년 있으면 3컬럼 전부 결선(공란 재발 없음)', () => {
    const checkInId = 'chk-A';
    const db: VisitData = {
      packageSessions: [{ check_in_id: checkInId, session_type: 'unheated_laser', session_number: 1 }],
      checkInServices: [
        svcRow(checkInId, '초진진찰료-의원', '기본'),
        svcRow(checkInId, '일반진균검사-KOH도말-조갑조직', '검사'),
        svcRow(checkInId, '비가열성 진균증 레이저 치료', '풋케어'),
        svcRow(checkInId, '손발톱백선', '상병'),
        svcRow(checkInId, '(비급여) 바르토벤외용액 4mL(에피나코나졸)', '처방약'),
      ],
    };
    const v = resolveVisit(checkInId, db);
    // 오늘시술 = 티켓 차감(레이저비가열) — treatment_kind NULL 이어도 결선.
    expect(v.procedures).toEqual(['레이저비가열']);
    // 처방내역 = 처방약 라인만(시술/검사/상병 배제).
    expect(v.prescriptions).toEqual(['(비급여) 바르토벤외용액 4mL(에피나코나졸)']);
    // 생년(만나이) = 스냅샷 "YYYY년MM월DD일" 파싱.
    expect(birthYearAgeDisplay('1994년 05월 30일')).toMatch(/^1994 \(만 \d+세\)$/);
    // 3컬럼 모두 '—'(공란) 아님 = RC 재발 없음.
    expect(v.procedures.length && v.prescriptions.length && birthYearAgeDisplay('1994년 05월 30일')).toBeTruthy();
  });

  // 시나리오 B: 서류완료(published) 과거일 행 — RC 핵심: today-글로벌 필터로 과거일이 전면 배제됐던 것.
  test('시나리오B 서류완료 과거일: 방문 앵커로 시술·처방 결선(today-글로벌 배제 RC 재발 차단)', () => {
    const past = 'chk-B-past'; // 어제 발행분 방문
    const db: VisitData = {
      packageSessions: [{ check_in_id: past, session_type: 'heated_laser', session_number: 3 }],
      checkInServices: [
        svcRow(past, '가열성 진균증 레이저 치료', '풋케어'),
        svcRow(past, '터미졸크림(테르비나핀염산염)15g', '처방약'),
      ],
    };
    const v = resolveVisit(past, db);
    // 과거일이어도 방문(check_in_id) 앵커라 공란 아님.
    expect(v.procedures).toEqual(['레이저가열']);
    expect(v.prescriptions).toEqual(['터미졸크림(테르비나핀염산염)15g']);
  });

  test('S1 생년 포맷 매트릭스: ISO 8자리 / 스냅샷 / 레거시 6자리 모두 파생, 무효는 공란', () => {
    expect(birthYearAgeDisplay('1979-11-08')).toMatch(/^1979 \(만 \d+세\)$/);   // ISO 8자리
    expect(birthYearAgeDisplay('1958년 02월 05일')).toMatch(/^1958 \(만 \d+세\)$/); // 스냅샷
    expect(birthYearAgeDisplay('880310')).toMatch(/^1988 \(만 \d+세\)$/);        // 레거시 6자리(불변)
    expect(birthYearAgeDisplay('890707')).toMatch(/^1989 \(만 \d+세\)$/);        // 레거시 6자리(불변)
    expect(birthYearAgeDisplay(null)).toBe('');
    expect(birthYearAgeDisplay('')).toBe('');
    expect(birthYearAgeDisplay('19XX')).toBe('');                                 // 자릿수 부족
    expect(birthYearAgeDisplay('19993299')).toBe('');                             // 8자리지만 월 32 무효
  });

  test('S2 오늘시술: session_type→간략형, 차감 없으면 공란(당일 차감 없으면 공란)', () => {
    expect(sessionTypeLabel('unheated_laser')).toBe('레이저비가열');
    expect(sessionTypeLabel('podologue')).toBe('발톱교정');
    expect(sessionTypeLabel('ribbon')).toBe('각질');
    // KOH검사만 있고 package_sessions 차감 없는 방문 → 오늘시술 공란(graceful '—').
    const koh = resolveVisit('chk-KOH', {
      packageSessions: [],
      checkInServices: [svcRow('chk-KOH', '일반진균검사-KOH도말-조갑조직', '검사')],
    });
    expect(koh.procedures).toEqual([]);
  });

  test('S3 처방내역: category=처방약 라인만 결선(시술/검사/상병 배제)', () => {
    const rows = [
      svcRow('c', '비가열성 진균증 레이저 치료', '풋케어'),
      svcRow('c', '일반진균검사-KOH도말-조갑조직', '검사'),
      svcRow('c', '손발톱백선', '상병'),
      svcRow('c', '터미졸크림(테르비나핀염산염)15g', '처방약'),
      svcRow('c', '(비급여) 바르토벤외용액 4mL(에피나코나졸)', '처방약'),
    ];
    expect(extractRxDrugNames(rows)).toEqual([
      '터미졸크림(테르비나핀염산염)15g',
      '(비급여) 바르토벤외용액 4mL(에피나코나졸)',
    ]);
  });

  test('S4 스코프 무결: 다른 방문 데이터는 결선되지 않음(타 환자 유입 배제)', () => {
    const db: VisitData = {
      packageSessions: [
        { check_in_id: 'mine', session_type: 'unheated_laser', session_number: 1 },
        { check_in_id: 'other', session_type: 'heated_laser', session_number: 1 },
      ],
      checkInServices: [
        svcRow('mine', '바르토벤', '처방약'),
        svcRow('other', '남의약', '처방약'),
      ],
    };
    const v = resolveVisit('mine', db);
    expect(v.procedures).toEqual(['레이저비가열']);   // 'other' 의 레이저가열 유입 안 됨
    expect(v.prescriptions).toEqual(['바르토벤']);     // 'other' 의 처방 유입 안 됨
    // check_in_id null(내원 이력 없는 draft) → 전부 공란(graceful).
    expect(resolveVisit(null, db)).toEqual({ procedures: [], prescriptions: [] });
  });
});
