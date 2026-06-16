/**
 * E2E spec — T-20260612-foot-DOCDASH-11FIX
 * 진료대시보드(DoctorCallDashboard) 구조 개선 11항목 (문지은 대표원장, TABLE-BTN-MINIMIZE 0185822 이후 follow-up).
 *
 * 정적 소스 검증(빌드·lint·LLM-QA 보강) + 순수 헬퍼 단위 검증 스타일 — 인접 DOCDASH spec 컨벤션 동일.
 *
 * AC-1  전화 아이콘 제거(테이블 내 Phone 잔존 0)
 * AC-2  초/재진 레이블 이름 왼쪽 배치(VisitBadge가 name 버튼 앞)
 * AC-3  데이터테이블 정렬(table-fixed + colgroup 열너비 고정)
 * AC-4  손들기 버튼 이름 오른쪽(ml-auto) + 이름 너비 확보(min-w)
 * AC-5  임상경과 textarea auto-resize(고정 h-9 제거 + scrollHeight 확장)
 * AC-6  진료의 토글 → "진료의 ○○○" 레이블(편집 시에만 드롭다운) + NOT NULL 강제 보존
 * AC-7  경과시간 "콜 후 _분 경과"(formatSinceCall)
 * AC-8  손들기 2단계(손들기→확인됨 두손아이콘→진료완료, 의사+직원)
 * AC-9  귀가 환자 처방 버튼 숨김(in-clinic 무회귀)
 * AC-10 상태 칼럼 귀가/귀가 대기
 * AC-11 진료완료 테이블 임상경과 칼럼
 *
 * ⚠ GUARD: 진료의 NOT NULL 강제(MEDCHART-SIGN-AUDIT AC-P2-6) / 처방게이트(QUICKRX-INCLINIC-GATE) /
 *   직전 테이블뷰·버튼최소화·임상경과 인라인 저장경로 회귀 금지.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSinceCall, formatElapsed } from '../../src/lib/doctor-call-notify';
import { checkRxInClinic } from '../../src/lib/inClinicRxGate';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');
const NOTIFY = () => SRC('lib/doctor-call-notify.ts');
const ACK = () => SRC('components/doctor/DoctorAck.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 전화 아이콘 제거
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 전화 아이콘 제거', () => {
  test('Phone 아이콘 import/사용 잔존 0 (헤더 Bell 로 교체)', () => {
    const s = DASH();
    expect(s).not.toContain('<Phone ');
    expect(s).not.toMatch(/^\s*Phone,$/m);
  });
  test('호출 알람 헤더는 Bell 아이콘', () => {
    expect(DASH()).toContain('AC-1: 전화 아이콘 제거');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 초/재진 레이블 이름 왼쪽
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — 초/재진 레이블 이름 왼쪽', () => {
  test('CallFeedRow 이름 셀: VisitBadge 가 name 버튼보다 앞', () => {
    // T-20260612-foot-DOCDASH-SECTION-RESTRUCTURE: 레이아웃 재정의로 주석 앵커 변경 — 동작(VisitBadge가 이름 앞)은 보존.
    const s = DASH();
    const cell = s.slice(s.indexOf('doctor-call-feed-row'), s.indexOf('doctor-call-name-chart-btn'));
    expect(cell).toContain('<VisitBadge visitType={checkIn.visit_type} />');
  });
  // T-20260612-foot-DOCDASH-WAITELAPSED-POLISH supersede(AC-8): 레이블 초진/재진 → 초/재 한 글자(색상·매핑 유지).
  test('VisitBadge 컴포넌트 존속 (new/returning/experience 매핑 유지, 한 글자 레이블)', () => {
    const s = DASH();
    expect(s).toContain("new: { label: '초', full: '초진'");
    expect(s).toContain("returning: { label: '재', full: '재진'");
    expect(s).toContain("experience: { label: '체', full: '체험'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 테이블 정렬(table-fixed + colgroup)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 데이터테이블 정렬', () => {
  test('두 테이블 모두 table-fixed + colgroup 적용', () => {
    const s = DASH();
    // T-20260612-foot-DOCDASH-FULLWIDTH-INLINE-EMOJI AC-1: 폰트 확대(text-sm→text-[15px]).
    expect(s).toContain('table-fixed text-[15px]" data-testid="doctor-call-feed-table"');
    expect(s).toContain('table-fixed text-[15px]" data-testid="doctor-completed-table"');
    expect((s.match(/<colgroup>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — 손들기 버튼 오른쪽 + 이름 너비
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 — 손들기 오른쪽 / 이름 너비', () => {
  // T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT supersede(AC-4): 손들기 affordance 가 이름 셀이 아니라
  //   상태 셀('진료필요' 옆)로 이동 — HandRaiseFlow(2단계 버튼) → HandToggle(✋ 단색 3-상태 토글)로 대체.
  test('손들기 affordance = 상태 셀 HandToggle(MONOTONE-RELAYOUT 이동)', () => {
    const s = DASH();
    expect(s).toContain('<HandToggle');
    expect(s).not.toContain('<HandRaiseFlow'); // 구 이름-셀 affordance 잔존 0
    expect(s).toContain('data-testid="doctor-hand-toggle"');
  });
  test('이름 버튼 min-w 확보(잘림 방지)', () => {
    expect(DASH()).toContain('min-w-[4rem] break-keep');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5 — 임상경과 textarea auto-resize
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-5 — 임상경과 auto-resize', () => {
  test('singleLine textarea 고정 h-9 제거 → min-h + auto-resize useEffect', () => {
    const s = PANEL();
    expect(s).toContain('AC-5: singleLine 임상경과 textarea auto-resize');
    expect(s).toContain('ta.style.height = `${ta.scrollHeight}px`');
    // 옛 고정 높이 클래스 회귀 0
    expect(s).not.toContain("'h-9 min-h-0 resize-none overflow-hidden py-2 text-sm placeholder:text-gray-300'");
    expect(s).toContain('min-h-[2.25rem] resize-none overflow-hidden py-2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-6 — 진료의 레이블형 + NOT NULL 강제 보존
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-6 — 진료의 레이블형(편집 시에만 드롭다운)', () => {
  test('진료의 ○○○ 레이블 + 변경 버튼 분기 존재', () => {
    const s = PANEL();
    expect(s).toContain('data-testid="clinical-singleline-doctor-label"');
    expect(s).toContain('진료의 {selectedSingleDoctor.name}');
    expect(s).toContain('data-testid="clinical-singleline-doctor-edit"');
  });
  test('미선택/편집 중이면 드롭다운 노출(showLabel 게이트)', () => {
    const s = PANEL();
    expect(s).toContain('const showLabel = !!formSigningDoctorId && !!selectedSingleDoctor && !editingSingleDoctor');
  });
  test('GUARD: 진료의 NOT NULL 강제(AC-P2-6) handleSave 차단 보존', () => {
    const s = PANEL();
    expect(s).toContain('if (!formSigningDoctorId) {');
    expect(s).toContain("toast.error('진료의가 필요합니다 — 담당 의사를 선택해주세요');");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7 — 콜 후 경과시간
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-7 — 콜 후 _분 경과', () => {
  test('formatSinceCall 표기', () => {
    expect(formatSinceCall(0)).toBe('콜 직후');
    expect(formatSinceCall(12)).toBe('콜 후 12분 경과');
    expect(formatSinceCall(60)).toBe('콜 후 1시간 경과');
    expect(formatSinceCall(135)).toBe('콜 후 2시간 15분 경과');
  });
  // T-20260612-foot-DOCDASH-WAITELAPSED-POLISH supersede(AC-3): 대시보드 경과시간 표기가 '콜 후 N분'(formatSinceCall)
  //   → '+N분'(formatElapsedPlus)로 축약. formatSinceCall 순수 헬퍼는 lib 잔존(타 surface 무회귀).
  // T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-1 supersede: 경과 계산 체인(elapsedMinutes→formatElapsedPlus) 보존하되
  //   별도 칼럼 → 상태셀 인라인 이전을 위해 elapsedMin 중간변수로 분리(표시위치만 이동, 헬퍼 무회귀).
  test('대시보드가 formatElapsedPlus("+N분") 사용(콜 후 표기 축약)', () => {
    const s = DASH();
    expect(s).toContain('elapsedMinutes(getCallTime(checkIn))');
    expect(s).toContain('formatElapsedPlus(elapsedMin)');
    expect(s).not.toContain('formatSinceCall(elapsedMinutes');
  });
  test('formatElapsed 헬퍼는 잔존(타 surface 무회귀)', () => {
    expect(formatElapsed(3)).toBe('3분 전');
    expect(NOTIFY()).toContain('export function formatElapsed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-8 — 손들기 2단계 워크플로우
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-8 — 손들기 2단계', () => {
  // T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT supersede(AC-4/AC-5): 2단계 버튼(HandRaiseFlow/TreatmentCompleteButton)
  //   → HandToggle 단일 ✋ 3-상태(shake→green ack→blue 완료). ack/완료 SSOT(recordAck/applyStatusFlagTransition) 재사용.
  test('HandToggle: 미ack→shake, ack→green(완료가능), 완료→blue', () => {
    const s = DASH();
    expect(s).toContain('const acked = isDoctorAcked(checkIn.doctor_ack_at)');
    expect(s).toContain("completed ? 'blue' : acked ? 'green' : 'shake'");
    expect(s).toContain('recordAck(checkIn.id)');
  });
  test('진료완료 전이 = HandToggle 초록 클릭(두손 버튼/Handshake 폐지)', () => {
    const s = DASH();
    expect(s).not.toContain('Handshake'); // 구 두손 아이콘 폐지
    expect(s).toContain("applyStatusFlagTransition(checkIn, 'pink', actor)");
  });
  test('진료완료 전이 = applyStatusFlagTransition(pink) SSOT(의사+직원, 신설 0)', () => {
    expect(DASH()).toContain("applyStatusFlagTransition(checkIn, 'pink', actor)");
  });
  test('DoctorAckButton label prop 기본값 확인(무회귀)', () => {
    expect(ACK()).toContain("label = '확인'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-9 / AC-10 — 귀가 처방게이트 / 상태 칼럼
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-9/AC-10 — 귀가 처방게이트 / 상태', () => {
  test('귀가 판정 = checkRxInClinic SSOT(discharged) 재사용', () => {
    const s = DASH();
    expect(s).toContain('const discharged = dischargeGate.reason === \'discharged\'');
    expect(s).toContain('checkRxInClinic({');
  });
  test('AC-9: 귀가면 처방 버튼 숨김(!discharged 게이트)', () => {
    // T-20260612-foot-DOCDASH-FULLWIDTH-INLINE-EMOJI item9: 처방 셀이 either/or 삼항으로 재구조화됨
    //   (확정→파란글씨 처방완료 / 미처방·원내잔류→알약 버튼 / 귀가·미처방→'-'). 귀가 게이트는 !discharged 분기로 보존.
    const s = DASH();
    expect(s).toContain('discharged ? (');
    expect(s).toContain('doctor-completed-no-rx');
  });
  test('AC-10: 상태 칼럼 귀가/귀가 대기', () => {
    const s = DASH();
    expect(s).toContain("{discharged ? '귀가' : '귀가 대기'}");
    expect(s).toContain('data-testid="doctor-completed-discharge-status"');
  });
  test('GUARD: SSOT discharged 판정(status==done) 회귀 0', () => {
    const today = '2026-06-12';
    const base = { checked_in_at: `${today}T01:00:00+09:00` };
    expect(checkRxInClinic({ ...base, status: 'done' }, today).reason).toBe('discharged');
    // 원내 잔류(진료완료 pink) → 처방 허용(버튼 유지)
    expect(checkRxInClinic({ ...base, status: 'treatment_waiting', status_flag: 'pink' }, today).allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-11 — 임상경과 칼럼(진료완료 테이블 한정)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-11 — 임상경과 칼럼', () => {
  test('진료완료 테이블 헤더에 임상경과 + 미리보기 셀', () => {
    const s = DASH();
    // FULLWIDTH-INLINE-EMOJI AC-1: 여백 축소(px-3→px-2). 임상경과 칼럼은 끝 미리보기 전용 유지(11FIX AC-11 정합).
    expect(s).toContain('<th className="px-2 py-1.5">임상경과</th>');
    expect(s).toContain('data-testid="doctor-completed-clinical-cell"');
    expect(s).toContain('useCompletedClinicalProgress');
  });
  // T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-1 supersede: '시간(경과시간)' 칼럼 제거(✋ 옆 인라인 이전) → 피드 테이블 8칼럼.
  //   (선행 NAME-EMOJI-CLINICAL-3FIX 가 이미 '차트' 칼럼 제거 → 9칼럼이었고, 본 티켓이 시간 칼럼까지 제거.)
  test('피드(대기) 테이블 8칼럼(시간 칼럼 제거, ELAPSED-CLINICAL-3FIX)', () => {
    const s = DASH();
    const feedThead = s.slice(
      s.indexOf('doctor-call-feed-table'),
      s.indexOf('doctor-call-feed-rows'),
    );
    expect((feedThead.match(/<th /g) ?? []).length).toBe(8);
    // th 라벨만 추출(주석의 '시간' 언급과 무관) — 마지막 칼럼=임상경과, '시간' th 부재.
    const labels = (feedThead.match(/>([가-힣()]+)<\/th>/g) ?? []).map((m) => m.replace(/<\/?th>|[<>]/g, ''));
    expect(labels).toContain('임상경과');
    expect(labels).not.toContain('시간');
  });
  test('진료완료 expand colSpan = 8칼럼(DOCDASH_COLSPAN, SECTION-RESTRUCTURE)', () => {
    expect(DASH()).toContain('colSpan={DOCDASH_COLSPAN}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-12 — 시술 정보 별도 칼럼 (reopen 신규 스코프, 2026-06-12)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-12 — 시술 별도 칼럼', () => {
  test('이름 셀 아래 treatmentLabel 표기 제거(이름+시술 뭉뚱그림 해소)', () => {
    const s = DASH();
    // 이름 셀 아래 <p>{treatmentLabel(checkIn)}</p> 잔존 0
    expect(s).not.toContain('treatmentLabel(checkIn)');
    expect(s).not.toContain('treatmentLabel,'); // import 도 제거
  });
  test('ProcedureCell 컴포넌트 존속 + 미지정 폴백', () => {
    const s = DASH();
    expect(s).toContain('function ProcedureCell(');
    expect(s).toContain('미지정');
    // 데이터 소스 = treatment_kind ?? treatment_category (DB read, 무변경)
    expect(s).toContain("(checkIn.treatment_kind ?? checkIn.treatment_category ?? '').trim()");
    expect(s).toContain('data-testid="doctor-procedure-cell"');
  });
  // T-20260612-foot-DOCDASH-SECTION-RESTRUCTURE AC-4(대표원장 지정, 변경 불가)로 헤더 순서 재정의 — 양 섹션 동일 8칼럼.
  //   ProcedureCell('오늘시술') 칼럼 자체는 보존(AC-12 동작 무회귀), 위치만 새 스펙으로 이동.
  // T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT AC-3 재정의: 시간 칼럼명 '시간'(시계 제거) + 임상경과=처방 왼쪽,
  //   차트 칼럼 신설(처방 오른쪽). 대기 9칼럼 = 이름·차트번호·상태·시간·방·오늘시술·임상경과·처방·차트.
  test('대기 테이블: 헤더 순서 이름→차트번호→상태→시간→방→오늘시술→임상경과→처방→차트', () => {
    const s = DASH();
    const feedThead = s.slice(
      s.indexOf('doctor-call-feed-table'),
      s.indexOf('doctor-call-feed-rows'),
    );
    const order = (feedThead.match(/>([가-힣]+)<\/th>/g) ?? []).map((m) => m.replace(/[<>/th]/g, ''));
    expect(order).toEqual(['이름', '차트번호', '상태', '시간', '방', '오늘시술', '임상경과', '처방', '차트']);
  });
  // T-20260612-foot-DOCDASH-WAITFILTER-UX7 AC-7(경과시간 제거) 유지 + T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT
  //   AC-3 재정의: 임상경과=처방 왼쪽 + 차트 칼럼 신설(처방 오른쪽) → 완료 8칼럼.
  //   완료 8칼럼 = 이름·차트번호·상태·방·오늘시술·임상경과·처방·차트.
  test('진료완료 테이블: 8칼럼 순서(경과시간 제거 + 차트번호·차트 칼럼, MONOTONE-RELAYOUT)', () => {
    const s = DASH();
    const compThead = s.slice(
      s.indexOf('doctor-completed-table'),
      s.indexOf('doctor-completed-rows'),
    );
    expect((compThead.match(/<th /g) ?? []).length).toBe(8);
    const order = (compThead.match(/>([가-힣]+)<\/th>/g) ?? []).map((m) => m.replace(/[<>/th]/g, ''));
    expect(order).toEqual(['이름', '차트번호', '상태', '방', '오늘시술', '임상경과', '처방', '차트']);
  });
  test('양 테이블 행에 ProcedureCell 렌더(대기 1 + 완료 1)', () => {
    const s = DASH();
    expect((s.match(/<ProcedureCell checkIn=\{checkIn\} \/>/g) ?? []).length).toBe(2);
  });
  test('GUARD: 시술 데이터는 read-only — treatment_kind/category 가 CALL_SELECT 에 포함', () => {
    expect(DASH()).toContain('treatment_kind, treatment_category');
  });
});
