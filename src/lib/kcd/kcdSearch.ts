// kcdSearch — KCD-8 내장 번들 인메모리 검색 (hand-rolled 인덱스, 신규 의존성 0).
// Ticket: T-20260611-foot-DIAG-KCD-BUNDLE-LOCKDOWN (AC-0 = (A) 정적 번들 + 인메모리 검색)
//
//   ★ 데이터(kcdData)는 dynamic import() 로만 로드 → 코드 스플릿(상병명 관리 탭 열 때만 1회 fetch).
//   ★ 검색 = code prefix(dotless/dotted 정규화) + name 부분일치. cmdk/fuse 미도입.
//   ★ 8만건 전수 교체 후에도 prefix/substring 필터는 로드 후 sub-ms·키스트로크당 네트워크 0.

import { normalizeServiceCode } from '@/lib/diagnosisCode';
import type { KcdEntry } from './kcdData';

export type { KcdEntry } from './kcdData';

// ---------------------------------------------------------------------------
// dotless/dotted 정규화 — DIAG-CODE-VALIDATION 표기관례 자산 승계.
//   검색·매칭 비교는 **점 제거 + 대문자** 키로 통일(M72.2 == M722 == m722).
// ---------------------------------------------------------------------------
function dotlessKey(raw: string): string {
  return normalizeServiceCode(raw).replace(/\./g, '');
}

// ---------------------------------------------------------------------------
// 번들 + 인덱스 (모듈 싱글턴, 1회 로드 후 캐시)
// ---------------------------------------------------------------------------
interface KcdIndex {
  entries: KcdEntry[];
  /** dotless 대문자 code 키 → entry (멤버십·중복 판정용). */
  byCodeKey: Map<string, KcdEntry>;
  version: string;
  provisional: boolean;
}

let _index: KcdIndex | null = null;
let _loading: Promise<KcdIndex> | null = null;

/** 번들 로드 + 인덱스 빌드 (멱등·캐시). 상병명 관리 탭 mount 시 1회 호출. */
export async function loadKcdBundle(): Promise<KcdIndex> {
  if (_index) return _index;
  if (_loading) return _loading;
  _loading = (async () => {
    const mod = await import('./kcdData');
    const byCodeKey = new Map<string, KcdEntry>();
    for (const e of mod.KCD_DATASET) {
      const key = dotlessKey(e.code);
      if (!byCodeKey.has(key)) byCodeKey.set(key, e); // 데이터셋 내 코드 유일(선등록 우선)
    }
    _index = {
      entries: mod.KCD_DATASET,
      byCodeKey,
      version: mod.KCD_BUNDLE_VERSION,
      provisional: mod.KCD_BUNDLE_META.provisional,
    };
    _loading = null;
    return _index;
  })();
  return _loading;
}

/** 동기 접근 — 이미 로드됐으면 인덱스, 아니면 null. */
export function getLoadedBundle(): KcdIndex | null {
  return _index;
}

// ---------------------------------------------------------------------------
// 검색 — code prefix(정규화) 또는 name 부분일치. 코드매치 우선 랭킹.
// ---------------------------------------------------------------------------
export interface KcdSearchResult extends KcdEntry {
  /** 매치 사유 — 랭킹/하이라이트 용. */
  matchedBy: 'code' | 'name';
}

const DEFAULT_LIMIT = 30;

export function searchKcd(query: string, limit = DEFAULT_LIMIT): KcdSearchResult[] {
  const idx = _index;
  if (!idx) return [];
  const q = query.trim();
  if (!q) return [];

  const codeKey = dotlessKey(q); // 코드 검색용(점 제거 대문자)
  const nameQ = q.toLowerCase();

  const codeHits: KcdSearchResult[] = [];
  const nameHits: KcdSearchResult[] = [];

  for (const e of idx.entries) {
    const eKey = dotlessKey(e.code);
    // 코드 prefix 매치 (사용자가 코드/숫자를 입력한 경우)
    if (codeKey && eKey.startsWith(codeKey)) {
      codeHits.push({ ...e, matchedBy: 'code' });
      continue;
    }
    // 이름 부분일치
    if (e.name.toLowerCase().includes(nameQ)) {
      nameHits.push({ ...e, matchedBy: 'name' });
    }
  }

  // 코드매치 먼저(코드 짧은 순=상위코드 우선), 그다음 이름매치(가나다)
  codeHits.sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
  nameHits.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  return [...codeHits, ...nameHits].slice(0, limit);
}

// ---------------------------------------------------------------------------
// 멤버십 검증 — 번들에 실재하는 코드인지 (AC-2/AC-3: 비-KCD 입력 차단 보조).
//   검색클릭 구조상 자연 충족되나, 저장 직전 방어용.
// ---------------------------------------------------------------------------
export function getKcdByCode(code: string | null | undefined): KcdEntry | null {
  const idx = _index;
  if (!idx || !code) return null;
  return idx.byCodeKey.get(dotlessKey(code)) ?? null;
}

/** 번들 로드 완료 & 코드 실재 여부. (미로드 시 false-negative 회피 위해 호출 전 loadKcdBundle 보장) */
export function isKnownKcdCode(code: string | null | undefined): boolean {
  return getKcdByCode(code) != null;
}
