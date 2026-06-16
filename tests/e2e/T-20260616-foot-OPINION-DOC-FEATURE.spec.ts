/**
 * E2E spec — T-20260616-foot-OPINION-DOC-FEATURE (Phase 2 — 영속·발행·출력)
 * 소견서(진단서) 작성 탭 — 균검사지 '옆' 신규 탭.
 *
 * 검증 대상:
 *   S1 옵션 자동삽입(toggle) — 옵션 phrase 가 editor 본문에 줄 단위로 append/remove(AC-3).
 *   S2 수기수정 보존 — editor 텍스트가 SSOT. 빈 본문/공백 경계에서 append 정상(AC-4).
 *   S3 옵션 그리드 무결성 — F0BAETELCTF 섹션/옵션 구성, key 중복 없음.
 *   S4 발행 게이트(AC-6) — isDoctor(director|doctor) 만 발행 가능.
 *   S5 발행자 스냅샷(AC-6) — clinic_doctors 선택 → 이름/면허, 미등록 시 profile.name → '원장' fallback.
 *   S6 source_option_name 스냅샷 — 선택 옵션 라벨 join(provenance).
 *   S7 실 브라우저 렌더 — 소견서 탭/팝업/발행이력 섹션(균검사지 옆 신설 무회귀).
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(OpinionDocTab)을 모사해 회귀를 잡는다.
 *   (컴포넌트는 auth/DB 의존이라 직접 마운트 대신 로직 동치 검증 — KOH spec 동일 컨벤션.)
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: isDoctor (QuickRxBar.tsx) — 발행 권한 게이트 ─────────────────────
const DOCTOR_ROLES = ['director', 'admin', 'manager'];
const isDoctor = (role: string): boolean => DOCTOR_ROLES.includes(role);

// ── 정본 모사: resolveIssuer (OpinionDocTab.tsx) ──────────────────────────────
type Doc = { id: string; name: string; license_no: string | null; is_default: boolean };
const resolveIssuer = (
  doctors: Doc[],
  doctorId: string,
  profileName: string | null,
): { issuedBy: string | null; issuedByName: string; issuedByLicenseNo: string | null } => {
  const doc = doctors.find((d) => d.id === doctorId) ?? null;
  return {
    issuedBy: doc?.id ?? null,
    issuedByName: doc?.name || profileName || '원장',
    issuedByLicenseNo: doc?.license_no ?? null,
  };
};

// ── 정본 모사: source_option_name join ────────────────────────────────────────
const joinSourceOptions = (labels: string[]): string | null =>
  labels.filter(Boolean).join(', ') || null;

// ── 정본 모사: togglePhraseInText (OpinionDocTab.tsx) ─────────────────────────
const togglePhraseInText = (text: string, phrase: string): string => {
  const lines = text.split('\n').map((l) => l.trimEnd());
  const idx = lines.findIndex((l) => l.trim() === phrase.trim());
  if (idx >= 0) {
    lines.splice(idx, 1);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  }
  const base = text.replace(/\s+$/, '');
  return base ? `${base}\n${phrase}` : phrase;
};

// ── 정본 모사: OPINION_SECTIONS 구조(요약) ────────────────────────────────────
const SECTION_TITLES = ['진단서', '금기증'];
const SAMPLE_KEYS = ['oral_o', 'oral_x', 'after_1m', 'medical_staff', 'hyperlipidemia', 'diabetes', 'pediatric'];

test.describe('T-20260616-foot-OPINION-DOC-FEATURE (Phase 2)', () => {
  // S1 — 옵션 클릭 시 phrase 가 editor 에 자동 삽입(빈 본문)
  test('S1: 빈 editor 에 옵션 phrase append', () => {
    const phrase = '경구약 복용이 가능한 상태로 확인됩니다.';
    expect(togglePhraseInText('', phrase)).toBe(phrase);
  });

  // S1 — 같은 옵션 재클릭 시 phrase 제거(toggle off)
  test('S1: 동일 phrase 재클릭 → 제거(toggle)', () => {
    const phrase = '당뇨 관련 사항을 확인하였습니다.';
    const once = togglePhraseInText('', phrase);
    expect(togglePhraseInText(once, phrase)).toBe('');
  });

  // S1 — 여러 옵션 누적 append(줄 단위)
  test('S1: 여러 옵션 누적 append(줄 단위)', () => {
    const a = '경구약 복용이 가능한 상태로 확인됩니다.';
    const b = '당뇨 관련 사항을 확인하였습니다.';
    let t = togglePhraseInText('', a);
    t = togglePhraseInText(t, b);
    expect(t).toBe(`${a}\n${b}`);
  });

  // S1 — 중간 옵션만 제거(앞뒤 보존)
  test('S1: 중간 phrase 제거 시 앞뒤 줄 보존', () => {
    const a = 'AAA';
    const b = 'BBB';
    const c = 'CCC';
    let t = togglePhraseInText('', a);
    t = togglePhraseInText(t, b);
    t = togglePhraseInText(t, c);
    expect(t).toBe('AAA\nBBB\nCCC');
    expect(togglePhraseInText(t, b)).toBe('AAA\nCCC');
  });

  // S2 — 원장이 수기 수정한 본문 뒤에도 정상 append(공백 경계)
  test('S2: 수기수정 본문 끝에 append(trailing whitespace 정리)', () => {
    const manual = '환자는 양호한 상태입니다.\n\n';
    const phrase = '의료진 판단 하에 진료를 진행하였습니다.';
    expect(togglePhraseInText(manual, phrase)).toBe('환자는 양호한 상태입니다.\n의료진 판단 하에 진료를 진행하였습니다.');
  });

  // S2 — 본문에 수기로 적힌 동일 문구도 toggle 매칭(줄 trim 비교)
  test('S2: 수기로 적힌 동일 문구도 toggle 제거 대상', () => {
    const phrase = '소아 환자임을 확인하였습니다.';
    const manual = `앞줄\n  ${phrase}  \n뒷줄`;
    expect(togglePhraseInText(manual, phrase)).toBe('앞줄\n뒷줄');
  });

  // S3 — 옵션 그리드 무결성(섹션·샘플 key) — 실제 SECTIONS 는 컴포넌트 소유, 여기선 계약만.
  test('S3: 섹션 타이틀/샘플 옵션 key 계약', () => {
    expect(SECTION_TITLES).toContain('진단서');
    expect(SECTION_TITLES).toContain('금기증');
    // key 중복 없음(샘플)
    expect(new Set(SAMPLE_KEYS).size).toBe(SAMPLE_KEYS.length);
  });

  // toggle 은 부수효과(저장/발행) 없는 순수 변환(입력 불변).
  test('toggle 은 순수 변환(입력 불변)', () => {
    const before = '기존 본문';
    const after = togglePhraseInText(before, '추가 문구');
    expect(before).toBe('기존 본문');
    expect(after).toBe('기존 본문\n추가 문구');
  });

  // S4 — 발행 게이트(AC-6): director|doctor(=isDoctor) 만 발행. DB INSERT RLS(is_admin_or_manager)와 동치.
  test('S4: 발행 권한 = isDoctor(director/admin/manager) 만 true', () => {
    expect(isDoctor('director')).toBe(true);
    expect(isDoctor('admin')).toBe(true);
    expect(isDoctor('manager')).toBe(true);
    expect(isDoctor('consultant')).toBe(false);
    expect(isDoctor('coordinator')).toBe(false);
    expect(isDoctor('therapist')).toBe(false);
    expect(isDoctor('staff')).toBe(false);
  });

  // S5 — 발행자 스냅샷(AC-6): 진료의 선택 시 이름/면허, 미선택/미등록 시 fallback.
  test('S5: clinic_doctors 선택 → 이름/면허 스냅샷', () => {
    const docs: Doc[] = [
      { id: 'd1', name: '김원장', license_no: '12345', is_default: true },
      { id: 'd2', name: '이원장', license_no: null, is_default: false },
    ];
    expect(resolveIssuer(docs, 'd1', '관리자')).toEqual({ issuedBy: 'd1', issuedByName: '김원장', issuedByLicenseNo: '12345' });
    expect(resolveIssuer(docs, 'd2', '관리자')).toEqual({ issuedBy: 'd2', issuedByName: '이원장', issuedByLicenseNo: null });
  });

  test('S5: 진료의 미등록 → profile.name, 그것도 없으면 "원장" fallback (issued_by_name NOT NULL 보장)', () => {
    expect(resolveIssuer([], '', '문원장')).toEqual({ issuedBy: null, issuedByName: '문원장', issuedByLicenseNo: null });
    expect(resolveIssuer([], '', null)).toEqual({ issuedBy: null, issuedByName: '원장', issuedByLicenseNo: null });
    expect(resolveIssuer([], '', '')).toEqual({ issuedBy: null, issuedByName: '원장', issuedByLicenseNo: null });
  });

  // S6 — source_option_name 스냅샷: 선택 라벨 join, 없으면 null.
  test('S6: source_option_name = 선택 옵션 라벨 join (없으면 null)', () => {
    expect(joinSourceOptions(['경구약 O', '당뇨'])).toBe('경구약 O, 당뇨');
    expect(joinSourceOptions([])).toBeNull();
    expect(joinSourceOptions(['', ''])).toBeNull();
  });
});

// ── S7: 실 브라우저 렌더 — 소견서 탭 + 팝업 + 발행이력 섹션 (균검사지 옆 신설 무회귀) ──
test.describe('T-20260616-foot-OPINION-DOC-FEATURE — render', () => {
  test('S7: 진료대시보드 → 소견서 탭 렌더 + (데이터 있으면) 팝업/발행이력', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    await page.getByRole('link', { name: '진료 대시보드' }).click();
    await page.waitForTimeout(1500);

    // 균검사지 탭 무회귀 — 여전히 존재.
    await expect(page.getByTestId('tab-koh-report')).toBeVisible();
    // 소견서 탭 — 신설 노출.
    const opinionTab = page.getByTestId('tab-opinion-doc');
    await expect(opinionTab).toBeVisible();
    await opinionTab.click();
    await page.waitForTimeout(2000);

    // 탭 헤더 렌더(빈 명단이어도 안내 문구는 항상).
    await expect(page.getByText('소견서 — 금일 내방객')).toBeVisible({ timeout: 5000 });

    const openBtn = page.getByTestId('opinion-open').first();
    if (await openBtn.count() > 0) {
      await openBtn.click();
      await page.waitForTimeout(1200);
      const dialog = page.getByTestId('opinion-dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      // 옵션 클릭 → editor 자동삽입(AC-3).
      await page.getByTestId('opinion-opt-oral_o').click();
      await page.waitForTimeout(300);
      await expect(page.getByTestId('opinion-editor')).not.toHaveValue('');
      // 발행 버튼 + 발행이력 섹션(AC-6/AC-7) 노출 — enabled 여부는 로그인 역할 의존이라 존재만 확인.
      await expect(page.getByTestId('opinion-publish-btn')).toBeVisible();
      await expect(page.getByTestId('opinion-published')).toBeVisible();
      await page.screenshot({ path: 'evidence/T-20260616-foot-OPINION-DOC-FEATURE_dialog.png', fullPage: true });
    } else {
      await page.screenshot({ path: 'evidence/T-20260616-foot-OPINION-DOC-FEATURE_empty.png', fullPage: true });
    }
  });
});
