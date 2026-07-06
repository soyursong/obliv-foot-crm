// T-20260603-foot-CHART-DRAFT-SAVE: 진료차트(MedicalChartPanel) localStorage 경량 임시저장.
//   정책: CEO A안 (MSG-20260706-090900-xzug, 2026-07-06) —
//     · 저장소 = localStorage (클라이언트 로컬, 서버/DB 미저장 → PHI 서버 미적재)
//     · 복원 범위 = 동일 단말 / 동일 브라우저 한정 (진료실 고정 단말 전제)
//     · 대상 = MedicalChartPanel 신규 구현 (기존 draft 메커니즘 없음 — CHART-UNSAVED-GUARD 의
//       dirty-guard 와 별개)
//   보안: localStorage 라 PHI 서버 미저장 → 별도 보안게이트 불요. 단 기기 공용 대비
//     로그아웃 시 전체 clear(clearAllChartDrafts) 로 잔존 draft 폐기.
import type { PrescriptionItem } from '@/components/admin/PrescriptionSetsTab';

const PREFIX = 'foot:medchart-draft:v1';
// AC-3: 생성 후 N일 경과 시 자동 폐기(stale draft 재복원 방지). dev 재량 상수 — 기본 7일.
export const CHART_DRAFT_TTL_DAYS = 7;
const TTL_MS = CHART_DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface ChartDraftFields {
  formDx: string;
  formClinical: string;
  formMemo: string;
  formRx: PrescriptionItem[];
  formSigningDoctorId: string;
}

interface StoredDraft extends ChartDraftFields {
  v: 1;
  savedAt: number; // epoch ms
}

// AC-1/AC-4: 저장 키는 사용자 + 환자/차트 식별자 단위로 분리(다른 환자 draft 오복원 방지).
export function chartDraftKey(userId: string, customerId: string, chartKey: string): string {
  return `${PREFIX}:${userId}:${customerId}:${chartKey}`;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // 프라이빗 모드/차단 환경 — draft 는 best-effort 이므로 조용히 skip
  }
}

export function saveChartDraft(key: string, fields: ChartDraftFields): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    const payload: StoredDraft = { v: 1, savedAt: Date.now(), ...fields };
    ls.setItem(key, JSON.stringify(payload));
  } catch {
    /* quota/serialize 실패 무시 — draft 는 best-effort */
  }
}

// AC-3: 로드 시 만료(7일) 검사 → 만료분은 삭제 후 null.
export function loadChartDraft(key: string): ChartDraftFields | null {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed || parsed.v !== 1 || typeof parsed.savedAt !== 'number') {
      ls.removeItem(key);
      return null;
    }
    if (Date.now() - parsed.savedAt > TTL_MS) {
      ls.removeItem(key); // 만료 자동 폐기
      return null;
    }
    return {
      formDx: parsed.formDx ?? '',
      formClinical: parsed.formClinical ?? '',
      formMemo: parsed.formMemo ?? '',
      formRx: Array.isArray(parsed.formRx) ? parsed.formRx : [],
      formSigningDoctorId: parsed.formSigningDoctorId ?? '',
    };
  } catch {
    try {
      ls.removeItem(key);
    } catch {
      /* noop */
    }
    return null;
  }
}

export function clearChartDraft(key: string): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.removeItem(key);
  } catch {
    /* noop */
  }
}

// AC-3: 로그아웃 시 clear(기기 공용 대비). 사용자 구분 없이 전체 medchart draft 폐기(over-clear 는 안전).
export function clearAllChartDrafts(): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => ls.removeItem(k));
  } catch {
    /* noop */
  }
}

type ContentFields = Pick<ChartDraftFields, 'formDx' | 'formClinical' | 'formMemo' | 'formRx'>;

// 콘텐츠 시그니처 — 기준(로드/빈)값 대비 실제 변경 여부 판정용.
//   진료의(formSigningDoctorId) 단독 변경/자동채움은 draft 판정에서 제외(내용 필드만 비교).
export function chartDraftContentSig(f: ContentFields): string {
  return JSON.stringify({
    dx: (f.formDx ?? '').trim(),
    clinical: (f.formClinical ?? '').trim(),
    memo: (f.formMemo ?? '').trim(),
    rx: f.formRx ?? [],
  });
}

// 저장 가치가 있는 내용이 있는지(빈 폼이면 draft 미저장/미프롬프트).
export function chartDraftHasContent(f: ContentFields): boolean {
  return !!(
    (f.formDx ?? '').trim() ||
    (f.formClinical ?? '').trim() ||
    (f.formMemo ?? '').trim() ||
    (f.formRx?.length ?? 0) > 0
  );
}
