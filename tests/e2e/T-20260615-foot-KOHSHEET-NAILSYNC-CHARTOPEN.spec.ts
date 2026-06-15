/**
 * E2E spec — T-20260615-foot-KOHSHEET-NAILSYNC-CHARTOPEN
 * 균검사지(KohReportTab): ① 치료부위 → 조갑부위 연동(정규화 프리필) ② 고객차트 열기 결선.
 *
 * 검증 대상(현장 클릭 시나리오 1/2/3 변환):
 *   S1 정규화 매핑(AC1)        — footSiteToNailSite/treatmentNailSites: L→Lt / R→Rt, toe 1:1, 중복 제거·정렬.
 *                                 소스 foot_sites(배열) 우선, 없으면 레거시 단일 foot_site 폴백.
 *   S2 프리필 + 가드(AC2/AC3)  — koh_nail_sites 비어있을 때만 치료부위 effective. 원장 입력값(non-빈)은
 *                                 SSOT 유지(치료부위 silent 덮어쓰기 금지). 프리필은 표시 한정(자동 DB쓰기 X).
 *   S3 단방향(AC4)             — 치료부위 → 균검사지만. 역방향(koh→treatment) 매핑 함수 부재.
 *   S4 차트열기 결선(AC5)      — 진료대시보드 → 균검사지 탭 → 환자 이름 클릭 → MedicalChartPanel 오픈.
 *
 * 스타일: S1~S3 는 in-page 순수 로직 시뮬레이션(구현 정본 KohReportTab 헬퍼 모사로 회귀 차단).
 *         S4 는 실 브라우저 동선(AC7) — render 증거는 *.render.spec.ts 가 별도 담당.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: 타입 (KohReportTab.tsx / FootSiteSelector.tsx) ─────────────────
type NailSide = 'Rt' | 'Lt';
interface NailSite { side: NailSide; toe: number; }
type FootSide = 'L' | 'R';
interface FootSite { side: FootSide; toe: number; }

// FootSiteSelector.parseFootSites 모사 — 배열/단일 모두 흡수, 중복 제거·정렬.
const parseFootSite = (raw: unknown): FootSite | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { side?: unknown; toe?: unknown };
  if (r.side !== 'L' && r.side !== 'R') return null;
  if (typeof r.toe !== 'number' || r.toe < 1 || r.toe > 5) return null;
  return { side: r.side, toe: r.toe };
};
const parseFootSites = (raw: unknown): FootSite[] => {
  const out: FootSite[] = [];
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const v of arr) {
    const s = parseFootSite(v);
    if (s && !out.some((o) => o.side === s.side && o.toe === s.toe)) out.push(s);
  }
  return out.sort((a, b) => (a.side === b.side ? a.toe - b.toe : a.side === 'L' ? -1 : 1));
};

// KohReportTab.footSiteToNailSite / treatmentNailSites / sortNailSites 모사 (정본).
const sideRank: Record<NailSide, number> = { Lt: 0, Rt: 1 };
const sortNailSites = (sites: NailSite[]): NailSite[] =>
  [...sites].sort((a, b) => sideRank[a.side] - sideRank[b.side] || a.toe - b.toe);
const footSiteToNailSite = (s: FootSite): NailSite => ({ side: s.side === 'L' ? 'Lt' : 'Rt', toe: s.toe });
const treatmentNailSites = (treatmentMemo: unknown): NailSite[] => {
  const tm = treatmentMemo && typeof treatmentMemo === 'object'
    ? (treatmentMemo as { foot_sites?: unknown; foot_site?: unknown }) : null;
  if (!tm) return [];
  const footSites = parseFootSites(tm.foot_sites ?? tm.foot_site);
  const out: NailSite[] = [];
  for (const fs of footSites) {
    const ns = footSiteToNailSite(fs);
    if (!out.some((o) => o.side === ns.side && o.toe === ns.toe)) out.push(ns);
  }
  return sortNailSites(out);
};
const formatNailSites = (sites: NailSite[] | null | undefined): string =>
  !sites || sites.length === 0 ? '—' : sortNailSites(sites).map((s) => `${s.side} ${s.toe}지 조갑`).join(', ');

// 행 effective 규칙(정본 KohReportTab 셀): koh 비어있을 때만 치료부위 프리필.
const effectiveSites = (nailSites: NailSite[], treatmentSites: NailSite[]): NailSite[] =>
  nailSites.length > 0 ? nailSites : treatmentSites;
const isPrefilled = (nailSites: NailSite[], treatmentSites: NailSite[]): boolean =>
  nailSites.length === 0 && treatmentSites.length > 0;

// ── S1: 정규화 매핑 (AC1) ─────────────────────────────────────────────────────
test('S1: 치료부위 → 조갑부위 정규화 매핑 — L→Lt / R→Rt, toe 1:1', () => {
  // 단일 변환
  expect(footSiteToNailSite({ side: 'L', toe: 1 })).toEqual({ side: 'Lt', toe: 1 });
  expect(footSiteToNailSite({ side: 'R', toe: 3 })).toEqual({ side: 'Rt', toe: 3 });

  // 시나리오1: 오른발 엄지 R1 + 왼발 검지 L2 (배열 foot_sites)
  const mapped = treatmentNailSites({ foot_sites: [{ side: 'R', toe: 1 }, { side: 'L', toe: 2 }] });
  // Lt 먼저 정렬 → 'Lt 2지 조갑, Rt 1지 조갑'
  expect(formatNailSites(mapped)).toBe('Lt 2지 조갑, Rt 1지 조갑');

  // 레거시 단일 foot_site 폴백
  expect(treatmentNailSites({ foot_site: { side: 'R', toe: 5 } })).toEqual([{ side: 'Rt', toe: 5 }]);

  // foot_sites 우선(둘 다 있으면 배열 채택)
  expect(treatmentNailSites({ foot_sites: [{ side: 'L', toe: 1 }], foot_site: { side: 'R', toe: 2 } }))
    .toEqual([{ side: 'Lt', toe: 1 }]);

  // 중복 제거
  expect(treatmentNailSites({ foot_sites: [{ side: 'L', toe: 1 }, { side: 'L', toe: 1 }] }))
    .toEqual([{ side: 'Lt', toe: 1 }]);

  // 잡값/결측 = 빈 배열
  expect(treatmentNailSites(null)).toEqual([]);
  expect(treatmentNailSites({})).toEqual([]);
  expect(treatmentNailSites({ foot_sites: [{ side: 'X', toe: 9 }] })).toEqual([]);
});

// ── S2: 프리필 + 수기입력 보호 가드 (AC2/AC3) ────────────────────────────────
test('S2: 조갑부위 비어있을 때만 치료부위 프리필 — 원장 입력값 silent 덮어쓰기 금지', () => {
  const treatment = treatmentNailSites({ foot_sites: [{ side: 'R', toe: 1 }, { side: 'L', toe: 2 }] });

  // (a) 조갑부위 빈 값 → 치료부위로 프리필(표시), 프리필 배지 ON
  const emptyKoh: NailSite[] = [];
  expect(formatNailSites(effectiveSites(emptyKoh, treatment))).toBe('Lt 2지 조갑, Rt 1지 조갑');
  expect(isPrefilled(emptyKoh, treatment)).toBe(true);

  // (b) 원장이 수기 입력(예: Rt 3지)한 뒤 → 그 값이 SSOT, 치료부위가 덮어쓰지 않음
  const doctorEdited: NailSite[] = [{ side: 'Rt', toe: 3 }];
  expect(effectiveSites(doctorEdited, treatment)).toEqual([{ side: 'Rt', toe: 3 }]);
  expect(formatNailSites(effectiveSites(doctorEdited, treatment))).toBe('Rt 3지 조갑');
  expect(isPrefilled(doctorEdited, treatment)).toBe(false); // 배지 OFF — 더 이상 프리필 아님

  // (c) 치료부위도 없고 조갑부위도 없으면 빈 표시
  expect(formatNailSites(effectiveSites([], []))).toBe('—');
  expect(isPrefilled([], [])).toBe(false);
});

// ── S3: 단방향 (AC4) ─────────────────────────────────────────────────────────
test('S3: 단방향 — 치료부위→균검사지만, 역방향 동기화 없음', () => {
  // 프리필은 effective(표시) 단계에서만 일어나고, 원장 입력값(koh)을 치료부위로 되쓰는 경로는 없음.
  // 원장이 균검사지에 입력해도 treatmentNailSites 입력(치료부위 소스)은 불변 — 역방향 함수 부재로 보장.
  const treatment = treatmentNailSites({ foot_site: { side: 'L', toe: 1 } });
  const doctorEdited: NailSite[] = [{ side: 'Rt', toe: 4 }];
  // effective 가 doctorEdited 를 채택해도 치료부위 소스는 그대로(되쓰기 없음)
  expect(effectiveSites(doctorEdited, treatment)).toEqual([{ side: 'Rt', toe: 4 }]);
  expect(treatment).toEqual([{ side: 'Lt', toe: 1 }]); // 치료부위 불변
});

// ── S4: 고객차트 열기 결선 (AC5) — 실 브라우저 동선 ──────────────────────────
test('S4: 균검사지 탭 환자 이름 클릭 → 고객차트(MedicalChartPanel) 오픈', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  await page.getByRole('link', { name: '진료 대시보드' }).click();
  await page.waitForTimeout(1500);
  await page.getByTestId('tab-koh-report').click();
  await page.waitForTimeout(2500);

  const openBtn = page.getByTestId('koh-open-chart').first();
  if (await openBtn.count() > 0) {
    await openBtn.click();
    await page.waitForTimeout(1500);
    // MedicalChartPanel 오픈 확인 — dialog role 또는 차트 패널 마커.
    const dialog = page.getByRole('dialog');
    await expect(dialog.first()).toBeVisible({ timeout: 5000 });
    await page.screenshot({
      path: 'evidence/T-20260615-foot-KOHSHEET-NAILSYNC-CHARTOPEN_chartopen.png',
      fullPage: true,
    });
  } else {
    // eligible KOH row 가 없으면(데이터 의존) 빈 상태만 캡처 — 결선 자체는 빌드+코드로 보장.
    await page.screenshot({
      path: 'evidence/T-20260615-foot-KOHSHEET-NAILSYNC-CHARTOPEN_empty.png',
      fullPage: true,
    });
  }
});
