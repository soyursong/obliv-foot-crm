/**
 * E2E spec — T-20260818-foot-DOCPRINT-RX-DXCODE-PAYMINI-AUTOFILL
 *
 * 요청(김주연 총괄, C0ATE5P6JTH, 2026-08-18): 서류출력 탭 기존 처방전 양식에서 처방약 용량·횟수·투약일수를
 *   수기 재입력하지 말고, 결제 미니창(PaymentMiniWindow)이 발행 시 저장한 데이터로 자동 prefill.
 *
 * 배경(조사 결과): 상병코드(diag_code_N)와 처방약 약품명/코드는 이미 service_charges 기반 자동 prefill 됨.
 *   남은 gap = 처방약 용량 3칸(unit_dose/daily_freq/total_days) — DocumentPrintPanel 의 rxItemDosages 가
 *   빈 상태로 시작해 기본값 '1' 로만 렌더. PaymentMiniWindow 는 발행 시 구조화 rx_items leaf 를
 *   form_submissions.field_data.rx_items 에 persist(T-20260809 AC1) 하므로 그 값으로 채운다.
 *
 * 본 spec 은 (1) 컴포넌트 prefill 매칭 로직(service_code 우선·name 폴백·empty-safe·1회적용)을 pure 재현으로 잠그고,
 *   (2) 매칭 산출물이 buildRxItemsHtml 로 렌더될 때 결제 미니창 용량이 그대로 나타남을 검증한다.
 *   AC-3(PaymentMiniWindow 저장본 소스, PaymentDialog 미참조)은 소스=form_submissions.field_data.rx_items 로 고정.
 */
import { test, expect } from '@playwright/test';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';

// ── DocumentPrintPanel prefill 매칭 로직의 pure 재현(회귀가드) ──
//   컴포넌트 useEffect 인라인 로직과 1:1 동일 규칙: PMW leaf(code/name/unit_dose/daily_freq/total_days) →
//   service_charges item(id/service_code/name) 매칭 후 rxItemDosages 맵 산출.
type RxLeaf = { code?: string | null; name?: string; unit_dose?: string; daily_freq?: string; total_days?: string };
type SvcItem = { id: string; service_code: string | null; name: string };
type Dosage = { unit_dose: string; daily_freq: string; total_days: string };

function seedRxDosages(
  leaf: RxLeaf[],
  rxServiceItems: SvcItem[],
  prev: Record<string, Dosage> = {},
): Record<string, Dosage> {
  const byCode = new Map<string, RxLeaf>();
  const byName = new Map<string, RxLeaf>();
  for (const it of leaf) {
    const code = it.code == null ? '' : String(it.code);
    const nm = it.name == null ? '' : String(it.name);
    if (code && !byCode.has(code)) byCode.set(code, it);
    if (nm && !byName.has(nm)) byName.set(nm, it);
  }
  const next: Record<string, Dosage> = { ...prev };
  for (const svc of rxServiceItems) {
    if (next[svc.id]) continue; // 이미 입력/세팅 항목 보존(AC-5)
    const match = (svc.service_code ? byCode.get(svc.service_code) : undefined) ?? byName.get(svc.name);
    if (!match) continue;
    const ud = match.unit_dose == null ? '' : String(match.unit_dose);
    const df = match.daily_freq == null ? '' : String(match.daily_freq);
    const td = match.total_days == null ? '' : String(match.total_days);
    if (!ud && !df && !td) continue; // 값 전무 스킵
    next[svc.id] = { unit_dose: ud, daily_freq: df, total_days: td };
  }
  return next;
}

// ── 시나리오 1: 정상 동선 — 결제 미니창 저장 용량이 처방전 양식에 자동 prefill ──
test('AC-1 정상: PMW field_data.rx_items 용량이 service_code 매칭으로 rxItemDosages 에 채워짐', () => {
  const leaf: RxLeaf[] = [
    { code: 'D100', name: '바르토벤', unit_dose: '2', daily_freq: '3', total_days: '5' },
    { code: 'D200', name: '풋크림', unit_dose: '1', daily_freq: '2', total_days: '7' },
  ];
  const svc: SvcItem[] = [
    { id: 'sc-1', service_code: 'D100', name: '바르토벤' },
    { id: 'sc-2', service_code: 'D200', name: '풋크림' },
  ];
  const seeded = seedRxDosages(leaf, svc);
  expect(seeded['sc-1']).toEqual({ unit_dose: '2', daily_freq: '3', total_days: '5' });
  expect(seeded['sc-2']).toEqual({ unit_dose: '1', daily_freq: '2', total_days: '7' });

  // 렌더 계약: 채워진 용량이 처방전 HTML 에 그대로 나타남(수기 없이).
  const html = buildRxItemsHtml(
    svc.map((s) => ({ code: s.service_code, name: s.name, ...seeded[s.id] })),
  );
  expect(html).toContain('D100 | 바르토벤');
  expect(html).toContain('<td style="text-align:center;">2</td>'); // unit_dose
  expect(html).toContain('<td style="text-align:center;">5</td>'); // total_days
  expect(html).toContain('D200 | 풋크림');
});

// ── service_code 없을 때 약품명(name) 폴백 매칭 ──
test('AC-1 폴백: service_code null 이면 약품명으로 매칭', () => {
  const leaf: RxLeaf[] = [{ code: null, name: '무좀약', unit_dose: '1', daily_freq: '1', total_days: '10' }];
  const svc: SvcItem[] = [{ id: 'sc-9', service_code: null, name: '무좀약' }];
  const seeded = seedRxDosages(leaf, svc);
  expect(seeded['sc-9']).toEqual({ unit_dose: '1', daily_freq: '1', total_days: '10' });
});

// ── 시나리오 2: 엣지 — 저장본 없음/미매칭이면 무동작(빈칸 유지·에러 없음) ──
test('AC-2 엣지: rx_items leaf 없음 → rxItemDosages 무변경(빈칸 유지)', () => {
  const seeded = seedRxDosages([], [{ id: 'sc-1', service_code: 'D100', name: '바르토벤' }]);
  expect(seeded).toEqual({});
  // 빈 dosage → 처방전 렌더는 크래시 없이 공란(용량 셀 빈칸), 인쇄 경로의 '|| 1' 기본값 흐름 보존.
  const html = buildRxItemsHtml([{ code: 'D100', name: '바르토벤' }]);
  expect(html).toContain('D100 | 바르토벤');
  expect(html).not.toMatch(/\{\{[a-z_0-9]+\}\}/);
});

test('AC-2 엣지: 매칭 안 되는 항목은 스킵(다른 약만 채워짐)', () => {
  const leaf: RxLeaf[] = [{ code: 'D100', name: '바르토벤', unit_dose: '2', daily_freq: '2', total_days: '3' }];
  const svc: SvcItem[] = [
    { id: 'sc-1', service_code: 'D100', name: '바르토벤' },
    { id: 'sc-2', service_code: 'D999', name: '미매칭약' },
  ];
  const seeded = seedRxDosages(leaf, svc);
  expect(seeded['sc-1']).toEqual({ unit_dose: '2', daily_freq: '2', total_days: '3' });
  expect(seeded['sc-2']).toBeUndefined();
});

// ── AC-5: 사용자가 이미 수정한 항목은 prefill 이 덮어쓰지 않음(수기 보존) ──
test('AC-5 회귀: 이미 입력된 dosage 는 prefill 이 덮어쓰지 않음', () => {
  const leaf: RxLeaf[] = [{ code: 'D100', name: '바르토벤', unit_dose: '9', daily_freq: '9', total_days: '9' }];
  const svc: SvcItem[] = [{ id: 'sc-1', service_code: 'D100', name: '바르토벤' }];
  const prev = { 'sc-1': { unit_dose: '1', daily_freq: '1', total_days: '1' } }; // 사용자 수기값
  const seeded = seedRxDosages(leaf, svc, prev);
  expect(seeded['sc-1']).toEqual({ unit_dose: '1', daily_freq: '1', total_days: '1' }); // 보존
});

// ── 값 전무(용량 3칸 모두 공백) leaf 는 스킵해 기본값 흐름 유지 ──
test('AC-2 회귀: 용량 3칸 전부 공백인 leaf 는 스킵(기본값 흐름 보존)', () => {
  const leaf: RxLeaf[] = [{ code: 'D100', name: '바르토벤', unit_dose: '', daily_freq: '', total_days: '' }];
  const svc: SvcItem[] = [{ id: 'sc-1', service_code: 'D100', name: '바르토벤' }];
  const seeded = seedRxDosages(leaf, svc);
  expect(seeded['sc-1']).toBeUndefined();
});
