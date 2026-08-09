/**
 * E2E(unit) spec — T-20260809-foot-CONSENT-SELFCHECKIN-CONTENT-ADD-LAYOUT
 * 고유식별정보 수집 동의(필수) 신규 추가 — 셀프접수(TabletChecklistPage) + 팬차트 동의서(ConsentFormDialog) 2곳
 *   + 동의 텍스트 줄간격 완화(레이아웃).
 *
 * 배경: 개보법 §24 고유식별정보(주민번호·외국인등록번호·여권번호) = 별도 필수 동의.
 *   두 곳 모두 지금 이 항목 없음 → 신규 ADDITIVE 추가.
 * da_consult_ref: DA-20260809-foot-CONSENT-UNIQUEID-FORMTYPE (Option A — consent_forms.form_type
 *   CHECK 에 'unique_id' 추가, db_change=true + MIG-GATE). 셀프접수 leg = jsonb 블롭 재사용(db_change=false).
 *
 * AC 커버:
 *   AC1 — 셀프접수: 개인정보 동의 다음에 "고유식별정보 수집·이용 동의(필수)" 섹션(수집항목·목적·기간 3항목).
 *         섹션 번호 재정렬(개인정보 1 / 고유식별정보 2 / 서명 3).
 *   AC2 — 셀프접수: 고유식별정보 미동의 시 제출 불가(submit validation + 버튼 disabled).
 *   AC3 — 팬차트: FormType/FORM_TITLES/FORM_CONTENT/버튼목록에 unique_id 배선.
 *   AC4 — 레이아웃: 셀프접수 동의 텍스트 space-y-1→space-y-2, 팬차트 본문 space-y-2→space-y-3.
 *   AC5 — 저장 무회귀: 기존 privacy/hira/consent_sensitive 배선 무접촉(ADDITIVE only).
 *   MIG — 마이그레이션: CHECK IN-list 5값(신규 unique_id) + dormant hira_consent 미포함(DA Q3).
 *
 * NOTE: 두 화면 모두 backend state(prescreen check_in / 인증 스태프·check-in row) 의존이라 실 UI 관측은
 *   supervisor field-soak(태블릿 셀프접수 + 팬차트 동의서). 본 spec 은 auth/DB 불요·결정론 정적 소스/계약 가드
 *   (repo '정적 소스 가드' 패턴 — T-20260807-CONSULTASSIGN 등 선례).
 * 실행: playwright test --project=unit T-20260809-foot-CONSENT-SELFCHECKIN-CONTENT-ADD-LAYOUT
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TABLET = readFileSync(join(ROOT, 'src/pages/TabletChecklistPage.tsx'), 'utf-8');
const CONSENT = readFileSync(join(ROOT, 'src/components/ConsentFormDialog.tsx'), 'utf-8');
const MIG = readFileSync(
  join(ROOT, 'supabase/migrations/20260809150000_foot_consent_unique_id_formtype.sql'),
  'utf-8',
);

test.describe('T-20260809 CONSENT-SELFCHECKIN-CONTENT-ADD-LAYOUT', () => {

  // ── AC1: 셀프접수 고유식별정보 섹션 + 3항목 + 번호 재정렬 ────────────────
  test('AC1 — 셀프접수 UNIQUE_ID_TEXT 3항목(수집항목/목적/기간10년) 존재', () => {
    expect(TABLET).toContain('const UNIQUE_ID_TEXT');
    // 수집 항목: 주민등록번호/외국인등록번호/여권번호
    expect(TABLET).toMatch(/수집 항목:\s*주민등록번호,\s*외국인등록번호,\s*여권번호/);
    // 이용 목적: 본인확인/진료기록/건강보험 자격확인
    expect(TABLET).toMatch(/이용 목적:.*본인확인.*진료기록.*건강보험 자격확인/);
    // 보유 기간: 진료기록 보존기간 10년
    expect(TABLET).toMatch(/보유 기간:.*진료기록 보존기간.*10년/);
  });

  test('AC1 — 섹션 노출 + 번호 재정렬(개인정보=1 / 고유식별정보=2 / 서명=3)', () => {
    expect(TABLET).toContain('num={1} title="개인정보 수집·이용 동의 (필수)"');
    expect(TABLET).toContain('num={2} title="고유식별정보 수집·이용 동의 (필수)"');
    // 서명 섹션이 num=2 → num=3 으로 밀림
    expect(TABLET).toContain('num={3} title="서명 *"');
    expect(TABLET).not.toContain('num={2} title="서명 *"');
    // 신규 섹션이 UNIQUE_ID_TEXT 를 map 으로 렌더
    expect(TABLET).toMatch(/UNIQUE_ID_TEXT\.map/);
  });

  // ── AC2: 필수 게이팅 (validation + 버튼 disabled) ────────────────────────
  test('AC2 — agree_unique_id 필수: 타입/초기값/제출검증/버튼비활성 배선', () => {
    // ChecklistData 필드 + 초기값 false
    expect(TABLET).toContain('agree_unique_id: boolean;');
    expect(TABLET).toContain('agree_unique_id: false,');
    // handleSubmit validation — 미동의 시 제출 차단(alert + return)
    expect(TABLET).toMatch(/if \(!data\.agree_unique_id\) \{[\s\S]*?return;/);
    // 제출 버튼 disabled 조건에 포함
    expect(TABLET).toMatch(/disabled=\{!d\.agree_privacy \|\| !d\.agree_unique_id \|\| sigEmpty\}/);
    // 버튼 라벨 안내
    expect(TABLET).toContain('고유식별정보 동의 필요');
    // agree_unique_id 체크박스 바인딩
    expect(TABLET).toMatch(/checked=\{d\.agree_unique_id\}/);
  });

  // ── AC3: 팬차트 ConsentFormDialog unique_id 배선 ─────────────────────────
  test('AC3 — FormType/FORM_TITLES/FORM_CONTENT/버튼목록 unique_id 배선', () => {
    // FormType union
    expect(CONSENT).toMatch(/export type FormType =[^;]*'unique_id'/);
    // FORM_TITLES
    expect(CONSENT).toContain("unique_id: '고유식별정보 수집·이용 동의서'");
    // FORM_CONTENT — 3항목 verbatim
    expect(CONSENT).toMatch(/수집 항목:\s*주민등록번호,\s*외국인등록번호,\s*여권번호/);
    expect(CONSENT).toMatch(/이용 목적:.*본인확인.*진료기록.*건강보험 자격확인/);
    expect(CONSENT).toMatch(/보유 기간:.*진료기록 보존기간.*10년/);
    // ConsentFormButtons types 배열
    expect(CONSENT).toContain("{ type: 'unique_id', label: '고유식별정보' }");
  });

  // ── AC4: 레이아웃 줄간격 완화 ────────────────────────────────────────────
  test('AC4 — 셀프접수 동의 텍스트 space-y-2 / 팬차트 본문 space-y-3', () => {
    // 셀프접수: 동의 본문 블록이 space-y-1 → space-y-2 (과밀 완화). space-y-1 잔존 금지(동의 본문)
    expect(TABLET).not.toMatch(/space-y-1 text-sm leading-relaxed/);
    expect(TABLET).toMatch(/space-y-2 text-sm leading-relaxed/);
    // 팬차트: 본문 블록 space-y-2 → space-y-3
    expect(CONSENT).toContain('text-sm leading-relaxed space-y-3');
    expect(CONSENT).not.toContain('text-sm leading-relaxed space-y-2');
  });

  // ── AC5: 기존 동의 배선 무회귀(ADDITIVE only) ────────────────────────────
  test('AC5 — 기존 privacy/hira/consent_sensitive 배선 무접촉', () => {
    // 셀프접수 기존 동의값 유지
    expect(TABLET).toContain('agree_privacy: boolean;');
    expect(TABLET).toContain('agree_marketing: boolean;');
    // 팬차트 기존 form_type 유지
    for (const t of ['refund', 'non_covered', 'treatment', 'privacy', 'hira_consent']) {
      expect(CONSENT).toContain(`${t}:`);
    }
    // consent_sensitive(개보법 §23) 선례 배선 유지
    expect(CONSENT).toContain('consent_sensitive_agreed');
    expect(CONSENT).toContain("formType === 'privacy'");
  });

  // ── MIG: CHECK IN-list 5값 + dormant hira_consent 미포함 ─────────────────
  test('MIG — form_type CHECK 5값(신규 unique_id 포함) / hira_consent 미포함(DA Q3)', () => {
    const checkClause = MIG.match(/CHECK \(form_type IN \([^)]*\)\)/)?.[0] ?? '';
    expect(checkClause).toBe(
      "CHECK (form_type IN ('refund','non_covered','treatment','privacy','unique_id'))",
    );
    // dormant hira_consent 는 CHECK 목록(실효 제약)에 끼워넣지 않음(DA Q3) — 주석 언급은 무관
    expect(checkClause).not.toContain('hira_consent');
    // 안전 형태: 동적 제약명 탐색 후 DROP → ADD (auto-name drift 방지)
    expect(MIG).toMatch(/DROP CONSTRAINT/);
    expect(MIG).toContain('pg_get_constraintdef');
    expect(MIG).toContain('da_consult_ref: DA-20260809-foot-CONSENT-UNIQUEID-FORMTYPE');
  });
});
