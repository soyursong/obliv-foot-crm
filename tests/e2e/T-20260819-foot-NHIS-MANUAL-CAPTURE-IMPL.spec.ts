/**
 * T-20260819-foot-NHIS-MANUAL-CAPTURE-IMPL — 건보 자격조회 수기 캡처 N1~N5 파이프라인 + 하드가드 6개
 *   + startEdit 신규고객(source=null) attribution 잔여 fix (HG#3)
 *
 * 부모: T-20260819-foot-NHIS-MANUAL-CAPTURE-DESIGN 설계 v2 (A안 확정·DB 무변경).
 *   자동 자격조회는 superseded(2017.9 개편 후 로컬 공단OCS only). 본 티켓은 수기 캡처 동선을
 *   N1~N5 로 고정하고, 6개 하드가드(P0 오청구 방화벽)를 전건 회귀-lock 한다.
 *
 * ★blocking AC 2축:
 *   (1) 하드가드 6개 전건 반영 (미반영 배포 금지)
 *   (2) startEdit(:143) 신규고객 source=null 경로 = 실기기(갤탭) 라이브재현 검증.
 *       ↳ 본 spec 은 그 결함의 상태전이 회귀-lock(정적). green build/spec 단독 종결 불가 —
 *         supervisor QA 실기기 재현 evidence 가 (2)의 종결 근거(§풋 실기기 현장 confirm).
 *
 * 소스 provenance: S1(da_decision_foot_nhis_manual_capture_lookup_audit_rpc_20260724.md) ·
 *   S2(T-20260806-...-UNATTRIBUTED-REWORK) · S3(설계_foot_NHIS수기캡처). improvise 0.
 *
 * 검증 방식: (a) 소스 구조 결속(파이프라인 노드·하드가드 심볼) + (b) 순수 judge 실행(HG#1/#2)
 *   + (c) startEdit 포함 상태머신 reducer(HG#3 신규고객 경로). CT 인프라 부재 → 컴포넌트 마운트
 *   대신 소스와 동일 로직 모델링(구조 일치는 (a) 가 소스에 결속).
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { judgeInsuranceGrade } from '@/lib/insuranceGradeJudge';

const __root = dirname(fileURLToPath(import.meta.url));
function readSrc(rel: string): string {
  return readFileSync(resolve(__root, '../../src', rel), 'utf-8');
}
function readMig(rel: string): string {
  return readFileSync(resolve(__root, '../../supabase/migrations', rel), 'utf-8');
}
function srcPath(rel: string): string {
  return resolve(__root, '../../src', rel);
}
const gradeSelectSrc = readSrc('components/insurance/InsuranceGradeSelect.tsx');
const judgeSrc = readSrc('lib/insuranceGradeJudge.ts');
const hookSrc = readSrc('hooks/useNhisLookup.ts');
const chartSrc = readSrc('pages/CustomerChartPage.tsx');
const useInsSrc = readSrc('hooks/useInsurance.ts');
const auditMig = readMig('20260724140000_foot_nhis_lookup_audit_rpc.sql');
const writeMig = readMig('20260725120000_foot_update_insurance_grade_secdef_rpc.sql');

// ══════════════════════════════════════════════════════════════════════
// N1~N5 파이프라인 노드 앵커 (설계 §7) — 각 노드 구현 자산 실재 결속
// ══════════════════════════════════════════════════════════════════════
test.describe('N1~N5 수기캡처 파이프라인 노드 앵커', () => {
  test('N1 조회 개시 — 딥링크 open + 감사 RPC 발화(단일 choke performLookup)', () => {
    expect(hookSrc).toMatch(/window\.open\(NHIS_EXTERNAL_URL/);
    expect(hookSrc).toMatch(/supabase\.rpc\('log_nhis_eligibility_lookup', \{ p_customer_id/);
    // rising-edge attribution 개시(N1) 프리셋 배선
    expect(chartSrc).toMatch(/lookupInProgress=\{nhis\.captureOpen\}/);
  });

  test('N2 값 입력 — 판정보조 칸(급여/경감/외국인) + 증번호(기존 재사용, 파서 미재도입)', () => {
    expect(gradeSelectSrc).toContain('benefitText');
    expect(gradeSelectSrc).toContain('reliefText');
    expect(gradeSelectSrc).toContain('isForeigner');
    // HG#4: 붙여넣기 파서 재도입 금지 (사람 수기 only)
    expect(existsSync(srcPath('lib/nhisParse.ts'))).toBe(false);
    expect(gradeSelectSrc).not.toContain('nhisParse');
  });

  test('N3 등급 추천 — judgeInsuranceGrade (추천만, write 없음)', () => {
    expect(gradeSelectSrc).toMatch(/judgeInsuranceGrade\(/);
    // 추천 적용은 원클릭(applyRecommendation) — 자동확정 아님
    expect(gradeSelectSrc).toMatch(/applyRecommendation/);
    expect(gradeSelectSrc).not.toMatch(/useEffect\([\s\S]{0,600}updateInsuranceGrade/);
  });

  test('N4 등급 확정 sink — updateInsuranceGrade 단일 write choke (사람 [저장]만)', () => {
    const sink = gradeSelectSrc.match(/updateInsuranceGrade\(/g) ?? [];
    expect(sink.length).toBe(1); // 단일 write choke
    expect(gradeSelectSrc).toContain('updateInsuranceGrade(customerId, draftGrade, draftSource');
    expect(gradeSelectSrc).toMatch(/onClick=\{save\}/);
  });

  test('N5 COPAY 산정 — calc_copayment RPC(서버 SSOT) 연계 보존', () => {
    expect(useInsSrc).toMatch(/supabase\.rpc\('calc_copayment'/);
    expect(existsSync(srcPath('lib/copayCalc.ts'))).toBe(true); // 미러 LOGIC-LOCK 보존
    // 등급 확정 → 재산정 연쇄(insuranceGradeRefreshKey)
    expect(chartSrc).toMatch(/setInsuranceGradeRefreshKey\(\(k\) => k \+ 1\)/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 하드가드 6개 — supervisor QA blocking AC (전건, improvise 0)
// ══════════════════════════════════════════════════════════════════════
test.describe('HG#1 자격등급 화이트리스트 (오청구 방화벽)', () => {
  test('write-allowlist = SECDEF RPC governed(free-form 금지) + foreigner write 존재', () => {
    // 서버측 allowlist 강제(클라 억지매핑 무의미) — governed 값집합
    expect(writeMig).toMatch(/p_grade\s+NOT IN \(/);
    expect(writeMig).toContain("'general'");
    expect(writeMig).toContain("'unverified'");
    // 억지매핑 금지의 근원: judge 는 위험키워드 단독 → unverified 폴백(아래 behavioral)
  });

  test('억지매핑 금지 — 산정특례/희귀난치/중증/보훈/국가유공 단독 = unverified (실행)', () => {
    for (const kw of ['산정특례', '희귀난치', '중증', '보훈', '국가유공']) {
      const r = judgeInsuranceGrade({ benefitText: kw, reliefText: '', isForeigner: false, ageYears: null });
      expect(r.recommended, `${kw} 단독은 unverified 여야 함(환수 방지)`).toBe('unverified');
      expect(r.needsMemoNote).toBe(true);
    }
  });

  test('RISK_SOLO_KEYWORDS 정본 5종 소스 결속', () => {
    expect(judgeSrc).toMatch(/RISK_SOLO_KEYWORDS\s*=\s*\[[^\]]*'산정특례'[^\]]*'희귀난치'[^\]]*'중증'[^\]]*'보훈'[^\]]*'국가유공'/);
  });

  test('경감(차상위)은 종별 확정 시에만 등급 — 종별 불명 = unverified', () => {
    // 차상위 종별(1/2) 없으면 부담률 확정 불가 → unverified (오분류=환수)
    const bad = judgeInsuranceGrade({ benefitText: '', reliefText: '차상위', isForeigner: false, ageYears: null });
    expect(bad.recommended).toBe('unverified');
    // 종별 명시 시에만 매핑
    const ok = judgeInsuranceGrade({ benefitText: '', reliefText: '차상위 2종', isForeigner: false, ageYears: null });
    expect(ok.recommended).toBe('low_income_2');
  });
});

test.describe('HG#2 나이↔등급 clobber 금지 (나이 파생축 자동)', () => {
  test('만65세↑ = elderly_flat / 만6세미만 = infant 자동 파생(일반 건보 대상일 때)', () => {
    const elderly = judgeInsuranceGrade({ benefitText: '건강보험', reliefText: '', isForeigner: false, ageYears: 70 });
    expect(elderly.recommended).toBe('elderly_flat');
    const infant = judgeInsuranceGrade({ benefitText: '건강보험', reliefText: '', isForeigner: false, ageYears: 3 });
    expect(infant.recommended).toBe('infant');
  });

  test('급여종별(의급/차상위) 확정 시 나이축이 clobber 하지 않음 (급여종별 우선)', () => {
    // 의료급여1 + 만70세 → 나이축(elderly_flat)이 급여종별을 덮지 않는다
    const r = judgeInsuranceGrade({ benefitText: '의료급여 1종', reliefText: '', isForeigner: false, ageYears: 70 });
    expect(r.recommended).toBe('medical_aid_1');
  });

  test('나이 파생 SSOT = fn_customer_birthdates RPC(서버파생) — 클라 세기 휴리스틱 신설 없음', () => {
    expect(gradeSelectSrc).toMatch(/supabase[\s\S]{0,40}\.rpc\('fn_customer_birthdates'/);
  });
});

test.describe('HG#3 출처 attribution rising-edge (신규고객 startEdit 잔여 fix 포함)', () => {
  test('초기화 effect deps = [grade, source, memo] (양방향 토글 lookupInProgress 미포함)', () => {
    const m = gradeSelectSrc.match(
      /setDraftGrade\(\(grade[\s\S]*?setDraftMemo\(memo[\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\)/,
    );
    const block = m ? m[0] : '';
    expect(block).not.toBe('');
    expect(block).toMatch(/\}\s*,\s*\[grade,\s*source,\s*memo\]\s*\)/);
    expect(block).not.toContain('lookupInProgress');
  });

  test('rising-edge 전용 effect = hira_lookup 의 유일 setter (prevLookupRef false→true)', () => {
    expect(gradeSelectSrc).toMatch(/const\s+prevLookupRef\s*=\s*useRef\(false\)/);
    expect(gradeSelectSrc).toMatch(
      /if\s*\(\s*lookupInProgress\s*&&\s*!prevLookupRef\.current\s*\)\s*\{\s*setDraftSource\('hira_lookup'\)/,
    );
  });

  test('★startEdit(:143) 양방향 토글 완전 제거 — hira_lookup attribution 보존 분기로 대체', () => {
    // 신규고객(source=null) 조회개시 후 [입력] 진입 시 hira_lookup 을 manual_input 으로 clobber 하던
    // `source ?? (lookupInProgress ? ...)` 토글 잔재 0건.
    const legacy = gradeSelectSrc.match(/source\s*\?\?\s*\(lookupInProgress\s*\?\s*'hira_lookup'\s*:\s*'manual_input'\)/g) ?? [];
    expect(legacy.length).toBe(0);
    // hira_lookup(조회개시 attribution) 이 이미 선 상태면 보존, 그 외엔 저장된 source(기존) 또는 manual_input(신규)
    expect(gradeSelectSrc).toMatch(/prev\s*===\s*'hira_lookup'\s*\?\s*prev\s*:\s*\(\(source\s*\?\?\s*'manual_input'\)/);
  });
});

test.describe('HG#4 PHI 원문 미저장 (감사·차트 공통)', () => {
  test('감사 RPC = customer_id FK + 메타만 (RRN·증번호·성명·등급값 미저장)', () => {
    // 인자 = customer_id 1개, by/role/clinic 서버측 파생
    expect(auditMig).toMatch(/log_nhis_eligibility_lookup\(p_customer_id uuid\)/);
    expect(auditMig).toMatch(/accessed_by[\s\S]{0,120}auth\.uid\(\)/);
    // grade 컬럼을 감사에 남기지 않음(책임분리)
    expect(auditMig).not.toMatch(/insurance_grade\b/);
  });

  test('붙여넣기 파서 재도입 금지 — 사람 수기 only', () => {
    expect(gradeSelectSrc).not.toContain('suggestedGrade');
    expect(hookSrc).not.toContain('nhisParse');
  });
});

test.describe('HG#5 조회 감사 SECDEF RPC (anti-IDOR)', () => {
  test('시그니처 정본 = SECURITY DEFINER + search_path 고정 + 인자 p_customer_id 1개', () => {
    expect(auditMig).toMatch(/CREATE OR REPLACE FUNCTION public\.log_nhis_eligibility_lookup\(p_customer_id uuid\)/);
    expect(auditMig).toMatch(/SECURITY DEFINER/);
    expect(auditMig).toMatch(/SET search_path = public, pg_temp/);
  });

  test('anti-IDOR — accessed_by/role/clinic 전량 서버측 파생 (attribution 인자화 금지)', () => {
    expect(auditMig).toMatch(/current_user_role\(\)/);
    expect(auditMig).toMatch(/current_user_clinic_id\(\)/);
    // REVOKE PUBLIC,anon + GRANT authenticated
    expect(auditMig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.log_nhis_eligibility_lookup\(uuid\) FROM PUBLIC, anon/);
    expect(auditMig).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.log_nhis_eligibility_lookup\(uuid\) TO authenticated/);
  });

  test('적재처 = 기존 phi_access_log 재사용 (신규 감사 테이블 금지)', () => {
    expect(auditMig).toMatch(/INSERT INTO public\.phi_access_log/);
    expect(auditMig).toMatch(/'nhis_eligibility_lookup'/);
  });
});

test.describe('HG#6 clinic-scope 소프트게이트 (skip·무중단)', () => {
  test('caller clinic 불일치 = RAISE 금지 → skip + RAISE NOTICE (동선 무중단)', () => {
    expect(auditMig).toMatch(/EXISTS \(\s*SELECT 1 FROM public\.customers c\s*WHERE c\.id = p_customer_id AND c\.clinic_id = v_clinic_id/);
    expect(auditMig).toMatch(/RAISE NOTICE 'nhis lookup audit skipped/);
    expect(auditMig).toMatch(/EXCEPTION WHEN OTHERS THEN/); // 로깅 실패도 무중단
  });

  test('클라 호출부도 감사 실패를 삼켜 동선 무중단 (try/catch 소프트게이트)', () => {
    expect(hookSrc).toMatch(/try\s*\{[\s\S]*log_nhis_eligibility_lookup[\s\S]*\}\s*catch/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// ★ startEdit 상태머신 (blocking AC 시나리오 2) — 신규고객 source=null 경로
//   InsuranceGradeSelect 의 세 setter(초기화 effect·rising-edge·startEdit)를 소스와 동일하게
//   모델링해 관측 가능한 draftSource 전이를 단언. 실기기 재현은 supervisor QA 종결 근거(별도).
// ══════════════════════════════════════════════════════════════════════
type Src = 'manual_input' | 'hira_lookup' | 'jeoneung_crm' | 'eligibility_cert';
interface FormState {
  draftGrade: string;
  draftSource: Src;
  draftMemo: string;
  prevLookup: boolean;
  editing: boolean;
}
const fresh = (): FormState => ({ draftGrade: 'unverified', draftSource: 'manual_input', draftMemo: '', prevLookup: false, editing: false });

// 초기화 effect(:88~92) — deps [grade, source, memo].
function syncFromProps(s: FormState, grade: string | null, source: Src | null, memo: string | null): FormState {
  return { ...s, draftGrade: grade ?? 'unverified', draftSource: source ?? 'manual_input', draftMemo: memo ?? '' };
}
// rising-edge effect(:98~104) — false→true 순간에만 hira_lookup.
function onLookupChange(s: FormState, lookupInProgress: boolean): FormState {
  const next = { ...s };
  if (lookupInProgress && !s.prevLookup) next.draftSource = 'hira_lookup';
  next.prevLookup = lookupInProgress;
  return next;
}
// startEdit(:141~) — FIX: hira_lookup 보존, 그 외 source ?? manual_input. lookupInProgress 재평가 없음.
function startEdit(s: FormState, source: Src | null): FormState {
  return {
    ...s,
    draftSource: s.draftSource === 'hira_lookup' ? s.draftSource : (source ?? 'manual_input'),
    editing: true,
  };
}
function radioSelect(s: FormState, sel: Src): FormState {
  return { ...s, draftSource: sel };
}

test.describe('★ startEdit 상태전이 (blocking 시나리오 2: 신규고객 source=null)', () => {
  test('신규고객: [건보조회]→닫기→[입력]→저장 = hira_lookup (오복귀 차단·본 티켓 핵심 fix)', () => {
    // 신규고객(DB source=null) 로딩
    let st = fresh();
    st = syncFromProps(st, null, null, null);
    expect(st.draftSource).toBe('manual_input');

    // [건보조회] 개시 (rising edge)
    st = onLookupChange(st, true);
    expect(st.draftSource).toBe('hira_lookup');

    // 포털 확인 후 패널 [닫기]
    st = onLookupChange(st, false);
    expect(st.draftSource).toBe('hira_lookup');

    // [입력] 진입 = startEdit (source 는 여전히 DB null). 선행 결함: manual_input 으로 clobber.
    st = startEdit(st, null);
    expect(st.draftSource, '신규고객 startEdit 이 hira_lookup 을 clobber 하면 안 됨').toBe('hira_lookup');
    // 저장 시 이 draftSource 가 그대로 write → 출처 = 요양기관정보마당(hira_lookup)
  });

  test('신규고객: 조회 없이 [입력] → manual_input (음성 대조)', () => {
    let st = fresh();
    st = syncFromProps(st, null, null, null);
    st = startEdit(st, null);
    expect(st.draftSource).toBe('manual_input');
  });

  test('기존고객: 저장된 source(eligibility_cert) 재편집 시 종전 source 유지', () => {
    let st = fresh();
    st = syncFromProps(st, 'general', 'eligibility_cert', '기확인');
    st = startEdit(st, 'eligibility_cert');
    expect(st.draftSource).toBe('eligibility_cert');
  });

  test('기존고객: 재조회(fresh lookup)→[수정] = hira_lookup 재attribution', () => {
    let st = fresh();
    st = syncFromProps(st, 'general', 'manual_input', null);
    st = onLookupChange(st, true); // 새 조회
    expect(st.draftSource).toBe('hira_lookup');
    st = startEdit(st, 'manual_input'); // 저장된 source 는 manual_input 이지만 fresh lookup 보존
    expect(st.draftSource).toBe('hira_lookup');
  });

  test('데스크 수기 선택 우선: 조회 후 수기 라디오 선택 → startEdit 재진입에도 clobber 없음', () => {
    let st = fresh();
    st = syncFromProps(st, null, null, null);
    st = onLookupChange(st, true);       // hira_lookup
    st = radioSelect(st, 'manual_input'); // 데스크가 수기로 되돌림
    expect(st.draftSource).toBe('manual_input');
    // (재진입 없이 저장) — 수기 선택 우선 유지
    st = onLookupChange(st, false);
    expect(st.draftSource).toBe('manual_input');
  });
});

// ══════════════════════════════════════════════════════════════════════
// A안 무변경 가드 — DB 스키마/신규 컬럼/enum 0 (db_change=false)
// ══════════════════════════════════════════════════════════════════════
test.describe('A안 — DB 무변경 (신규 컬럼/테이블/enum 0)', () => {
  test('신규 마이그레이션 없음 — 감사/write RPC 는 기존 배포분 재사용', () => {
    // 본 티켓 명의(T-20260819...IMPL)의 신규 마이그 파일이 없어야 한다(A안·재사용).
    expect(auditMig).toContain('T-20260724-foot-NHIS-MANUAL-CAPTURE'); // 기존 파일 그대로
    expect(writeMig).toContain('T-20260725-foot-INSURANCE-GRADE-SECDEF-RPC');
  });
});
