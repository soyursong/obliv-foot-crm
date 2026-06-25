import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// useNationalities — 국적 마스터(nationalities) 로드 훅.
// T-20260625-foot-PASSPORT-PORT (이식 출처: obliv-derm-crm useNationalities).
//   nationalities 는 정적 참조데이터(≈23행, 변경 빈도 0에 수렴) → 모듈 캐시 1회 조회 후 공유.
//   조회 실패 시 빈 배열(graceful — 국적 셀렉트 비고 fallback, 폼 깨짐 0).

export interface Nationality {
  id: number;
  name: string;
  code: string | null;
  sort_order: number;
}

let _cache: Nationality[] | null = null;
let _inflight: Promise<Nationality[]> | null = null;

async function fetchNationalities(): Promise<Nationality[]> {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const { data, error } = await supabase
        .from('nationalities')
        .select('id, name, code, sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data ?? []).map((r: any) => ({
        id: Number(r.id),
        name: r.name as string,
        code: (r.code ?? null) as string | null,
        sort_order: Number(r.sort_order ?? 0),
      }));
      _cache = rows;
      return rows;
    } catch {
      _inflight = null; // 실패 시 다음 호출 때 재시도
      return [];
    }
  })();
  return _inflight;
}

/** 국적 마스터 목록(sort_order 오름차순). 로드 전엔 빈 배열. */
export function useNationalities(): Nationality[] {
  const [list, setList] = useState<Nationality[]>(_cache ?? []);
  useEffect(() => {
    let alive = true;
    fetchNationalities().then((rows) => { if (alive) setList(rows); });
    return () => { alive = false; };
  }, []);
  return list;
}
