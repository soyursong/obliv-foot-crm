/**
 * T-20260714-foot-CHARTDOC-TREATSOURCE-SNAPSHOT (P1, medical confirm + DA A안 GO)
 *
 * 진료차트/서류 담당의(진료의) 출처를 '접속 계정' → '치료테이블 지정 진료의(check_ins.treating_doctor_id)'
 * 기준으로 통일 + 과거 진료차트 이력 담당의 박제(불변 스냅샷).
 *
 * DA CONSULT-REPLY(A안 "Seed, don't bind") 가드 4개 강제:
 *   1. selectedChartId 있으면 seed 미개입(저장된 차트 불변)
 *   2. formSigningDoctorId 이미 있으면 덮어쓰기 금지(비파괴 seed)
 *   3. seed 는 폼 기본값 1회 — 저장 스냅샷은 사람이 확정한 값
 *   4. treating 변경이 저장된 signing_doctor 를 자동 갱신하는 경로 신설 금지(auto-sync 금지)
 *
 * 스코프: item1=MedicalChartPanel(신규 차트 seed), item2=진단서/소견서 OpinionEditorDialog(seed only).
 *   item2(세부내역서·계산서·영수증)=UNLINKED field-soak 로 SCOPE OUT.
 *   item3(과거차트 박제)=medical_charts.signing_doctor_id/name 불변 스냅샷 재사용(db_change=false).
 *
 * 라이브 브라우저 회귀가 아니라 seed 출처/가드 불변식을 소스 레벨로 강제(로그인 불요, 결정론적).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const PANEL_SRC = fs.readFileSync(path.join(ROOT, 'src/components/MedicalChartPanel.tsx'), 'utf8');
const OPINION_SRC = fs.readFileSync(path.join(ROOT, 'src/components/doctor/OpinionDocTab.tsx'), 'utf8');

// 지정 마커 이후 블록에서 useEffect/useMemo 본문 추출(대략적 — 불변식 검사용).
function sliceAround(src: string, marker: string, span = 1400): string {
  const i = src.indexOf(marker);
  expect(i, `마커 존재: ${marker}`).toBeGreaterThan(-1);
  return src.slice(i, i + span);
}

test.describe('CHARTDOC-TREATSOURCE-SNAPSHOT — 담당의 출처=치료테이블 진료의 통일 + 과거 박제', () => {
  // ── item1 / AC-1: 진료차트 신규 seed 출처 = treating_doctor_id 우선 ──
  test('item1: MedicalChartPanel 신규 차트 seed 가 treating_doctor_id 를 우선 사용', () => {
    // 당일 check_ins.treating_doctor_id 자체 조회 effect 존재.
    expect(PANEL_SRC).toContain('treating_doctor_id');
    expect(PANEL_SRC).toMatch(/setTreatingDoctorId/);
    // seed effect: treatingDoctorId 가 등록 진료의에 있으면 그 값으로 seed.
    const seed = sliceAround(PANEL_SRC, 'seed 출처 = 치료테이블 지정 진료의 우선');
    expect(seed).toMatch(/treatingDoctorId\s*&&\s*clinicDoctors\.some\(\(d\)\s*=>\s*d\.id\s*===\s*treatingDoctorId\)/);
    expect(seed).toContain('setFormSigningDoctorId(treatingDoctorId)');
  });

  // ── A안 가드 1·2: 저장된 차트 미개입 + 이미 선택된 값 덮어쓰기 금지(비파괴 seed) ──
  test('가드1·2: selectedChartId/formSigningDoctorId early-return 이 seed effect 최상단에 유지', () => {
    const seed = sliceAround(PANEL_SRC, 'if (selectedChartId) return;', 900);
    // early-return 순서 유지 — treating seed 이전에 두 가드가 먼저.
    const gIdx = seed.indexOf('if (selectedChartId) return');
    const fIdx = seed.indexOf('if (formSigningDoctorId) return');
    const tIdx = seed.indexOf('setFormSigningDoctorId(treatingDoctorId)');
    expect(gIdx).toBeGreaterThan(-1);
    expect(fIdx).toBeGreaterThan(gIdx);
    expect(tIdx).toBeGreaterThan(fIdx); // 두 가드 통과 후에만 treating seed
  });

  // ── item2 / AC-2: 진단서·소견서 발행자 기본값 = treating_doctor_id 우선(seed only) ──
  test('item2: OpinionEditorDialog defaultDoctorId 가 treating_doctor_id 를 최우선 seed', () => {
    // 그 내원 check_ins.treating_doctor_id read-only 조회 훅 존재.
    expect(OPINION_SRC).toContain('useVisitTreatingDoctor');
    // 코드 앵커에서 slice(주석 텍스트 오염 방지 — 주석에 is_default 등 토큰 존재).
    const memo = sliceAround(OPINION_SRC, 'const defaultDoctorId = useMemo', 700);
    // treating 우선 → 기존 체인(signed → is_default → 첫 진료의) 폴백.
    const tIdx = memo.indexOf('return treatingDoctorId');
    const sIdx = memo.indexOf('signingIds.has(d.id)');
    const dIdx = memo.indexOf('is_default');
    expect(tIdx).toBeGreaterThan(-1);
    expect(sIdx).toBeGreaterThan(tIdx); // treating 이 서명의보다 먼저
    expect(dIdx).toBeGreaterThan(sIdx); // is_default 는 최후 폴백
  });

  // ── A안 가드 3: seed 는 open-bind 1회만 적용, override(doctorTouched) 보존 ──
  test('가드3: defaultDoctorId 는 open-bind 시 1회 setDoctorId — override 상태 보존', () => {
    // bind 블록에서 defaultDoctorId 적용 + doctorTouched 리셋(수동 변경 추적).
    expect(OPINION_SRC).toContain('setDoctorId(defaultDoctorId)');
    expect(OPINION_SRC).toContain('doctorTouched');
    // 발행 게이트(publish_opinion_doc RPC 대응)·issuer 매칭은 그대로 존재해야 한다(auto-bind 금지 무회귀).
    expect(OPINION_SRC).toContain('canPublish');
  });

  // ── A안 가드 4 / item3: treating 변경이 저장값을 자동 갱신하는 경로 신설 금지 + 과거 박제 재사용 ──
  test('가드4·item3: 저장된 차트 진료의는 signing_doctor 스냅샷 복원(불변) — treating auto-sync 경로 없음', () => {
    // resetForm: 저장된 차트는 chart.signing_doctor_id(불변 스냅샷)로 복원 — treating 로 재바인딩 금지.
    expect(PANEL_SRC).toMatch(/setFormSigningDoctorId\(chart\.signing_doctor_id\s*\?\?\s*''\)/);
    // treatingDoctorId 를 저장된 차트(selectedChartId 존재) 경로에서 signing 에 주입하는 코드가 없어야 한다.
    // seed effect 는 반드시 selectedChartId early-return 뒤에서만 treating 을 쓴다(위 가드1 테스트가 순서 보장).
    // 여기서는 저장 핸들러가 treatingDoctorId 를 직접 참조하지 않음을 확인(auto-sync 경로 부재).
    const saveIdx = PANEL_SRC.indexOf('const handleSave');
    if (saveIdx > -1) {
      const saveBlock = PANEL_SRC.slice(saveIdx, saveIdx + 3000);
      expect(saveBlock).not.toContain('treatingDoctorId');
    }
  });
});
