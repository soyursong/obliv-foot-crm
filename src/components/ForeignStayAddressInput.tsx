// T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW
//
// 외국인 셀프접수 전용 "국내 체류지(숙소) 주소" 입력 위젯.
//   · 카카오 로컬 API(REST 키워드 검색)로 숙소/호텔/주소 검색 → 결과 선택 시 전체주소 자동채움.
//     (A안 확정, 무료 — MSG-20260625-145747-roay. Google Places 폐기.)
//   · 키 미설정 / 호출 실패 / 사용자 수기전환 시 → 일반 텍스트 입력으로 graceful fallback.
//     (DA Q2: 결과 전체주소 → customers.address, 동·호수 등 상세 → customers.address_detail)
//
// 의존성 0 추가: 카카오 로컬은 REST fetch만 사용(SDK/위젯 npm 미설치).
// API 키: import.meta.env.VITE_KAKAO_REST_API_KEY (없으면 자동 수기 입력 모드).
//   ⚠ REST 키는 프론트 노출되므로 카카오 개발자콘솔에서 사용 도메인 제한 필수(무료 티어).
//
// ── ENV GUARD / 운영·QA 검증 노트 (T-20260629-foot-INGEST-EF-401-VERIFYJWT FIX) ──
//   · 키 빌드타임 주입 계약: VITE_KAKAO_REST_API_KEY 미설정 시 Vite가 ''로 인라인 →
//     아래 manualMode 초기값 true → 숙소검색 비활성·수기입력 fallback (정상 동작, 버그 아님).
//   · 카카오 검색 활성화를 원하면 Vercel Production env에 VITE_KAKAO_REST_API_KEY 등록 후 재배포 필요.
//     (2026-06-29 기준 prod env 미등록 → 현재 prod는 수기입력 모드로만 동작.)
//   · QA 번들 검증 시 주의: 본 컴포넌트는 SelfCheckIn 경유 **lazy chunk**(assets/SelfCheckIn-*.js)에
//     번들된다. 진입 index 번들만 grep하면 kakao/KakaoAK/dapi.kakao.com 0건으로 보이나 false-signal.
//     검증은 SelfCheckIn-*.js chunk를 직접 받아 grep. 키 주입 여부는 chunk 내 apiKey 인라인값
//     (미주입=빈문자열)으로 판별. data-search-ready="true|false"(아래 input) 로 런타임 확인 가능.

import { useEffect, useId, useRef, useState } from 'react';

const C = {
  dark: '#3D2B1A',
  primary: '#5C3D1E',
  medium: '#7B5130',
  muted: '#8B7355',
  border: '#D4C5B2',
  borderActive: '#7B5130',
} as const;

const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';

interface KakaoDoc {
  place_name?: string;
  road_address_name?: string;
  address_name?: string;
  category_name?: string;
}

// 검색결과 → 차트 저장용 전체주소 1줄로 합성.
//   place_name(숙소명) + 도로명주소(없으면 지번주소). 숙소명이 주소에 이미 있으면 중복 제거.
function composeAddress(doc: KakaoDoc): string {
  const name = (doc.place_name ?? '').trim();
  const addr = (doc.road_address_name || doc.address_name || '').trim();
  if (name && addr) {
    return addr.includes(name) ? addr : `${name}, ${addr}`;
  }
  return name || addr;
}

interface Props {
  /** 전체주소 (customers.address) */
  address: string;
  onAddressChange: (v: string) => void;
  /** 상세주소 — 호수·동 등 (customers.address_detail) */
  addressDetail: string;
  onAddressDetailChange: (v: string) => void;
  // 라벨/플레이스홀더 (i18n 외부 주입)
  searchLabel: string;
  searchPlaceholder: string;
  detailLabel: string;
  detailPlaceholder: string;
  manualToggleLabel: string;
  manualHint: string;
}

export default function ForeignStayAddressInput({
  address,
  onAddressChange,
  addressDetail,
  onAddressDetailChange,
  searchLabel,
  searchPlaceholder,
  detailLabel,
  detailPlaceholder,
  manualToggleLabel,
  manualHint,
}: Props) {
  const fieldId = useId();
  const apiKey = (import.meta.env.VITE_KAKAO_REST_API_KEY as string | undefined) ?? '';
  // manualMode: 수기 입력 강제(키 없음 · 호출 실패 · 사용자 선택)
  const [manualMode, setManualMode] = useState(!apiKey);
  const [results, setResults] = useState<KakaoDoc[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // 결과 선택 직후 자기-검색 재트리거 방지
  const skipNextSearch = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // 카카오 키워드 검색 — address(검색어) 변경 시 디바운스 호출.
  useEffect(() => {
    if (manualMode) return;
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    const q = address.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      fetch(`${KAKAO_KEYWORD_URL}?query=${encodeURIComponent(q)}&size=10`, {
        headers: { Authorization: `KakaoAK ${apiKey}` },
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`kakao ${res.status}`);
          return res.json();
        })
        .then((data: { documents?: KakaoDoc[] }) => {
          const docs = Array.isArray(data?.documents) ? data.documents : [];
          setResults(docs);
          setOpen(docs.length > 0);
        })
        .catch((err) => {
          if ((err as Error)?.name === 'AbortError') return;
          // 호출 실패(키 오류·CORS·할당량) → 수기 입력 fallback
          setManualMode(true);
          setResults([]);
          setOpen(false);
        })
        .finally(() => setLoading(false));
    }, 320);
    return () => clearTimeout(timer);
    // onAddressChange 안정 참조 가정(부모 setState). 의존성 최소화.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, manualMode, apiKey]);

  const handleSelect = (doc: KakaoDoc) => {
    const composed = composeAddress(doc);
    if (composed) {
      skipNextSearch.current = true;
      onAddressChange(composed);
    }
    setResults([]);
    setOpen(false);
  };

  const inputBase = (filled: boolean): React.CSSProperties => ({
    border: `1.5px solid ${filled ? C.borderActive : C.border}`,
    backgroundColor: 'white',
    color: C.dark,
  });

  return (
    <div className="space-y-1.5" data-testid="foreign-stay-address">
      <label
        htmlFor={`${fieldId}-addr`}
        className="block text-sm font-medium tracking-wide"
        style={{ color: C.medium }}
      >
        {searchLabel}
      </label>

      {/* 검색/주소 입력 — 검색 활성 시 결과 드롭다운, 아니면 일반 입력 */}
      <div className="relative">
        <input
          id={`${fieldId}-addr`}
          type="text"
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          placeholder={searchPlaceholder}
          autoComplete="off"
          className="h-14 w-full rounded-xl px-4 text-lg outline-none transition"
          style={inputBase(address.trim().length > 0)}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = C.borderActive;
            e.currentTarget.style.boxShadow = `0 0 0 3px ${C.borderActive}18`;
            if (results.length > 0) setOpen(true);
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = address.trim() ? C.borderActive : C.border;
            e.currentTarget.style.boxShadow = 'none';
            // 결과 클릭(mousedown) 후 닫히도록 지연
            setTimeout(() => setOpen(false), 150);
          }}
          data-testid="foreign-addr-input"
          data-search-ready={!manualMode ? 'true' : 'false'}
        />

        {/* 카카오 검색결과 드롭다운 */}
        {open && !manualMode && results.length > 0 && (
          <ul
            className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border bg-white shadow-lg"
            style={{ borderColor: C.border }}
            data-testid="foreign-addr-results"
          >
            {results.map((doc, i) => {
              const addr = doc.road_address_name || doc.address_name || '';
              return (
                <li key={`${doc.place_name ?? ''}-${i}`}>
                  <button
                    type="button"
                    // onMouseDown: input blur 보다 먼저 실행(클릭 유실 방지)
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(doc);
                    }}
                    className="block w-full px-4 py-3 text-left transition hover:bg-gray-50"
                    data-testid="foreign-addr-result-item"
                  >
                    {doc.place_name && (
                      <span className="block text-base font-medium" style={{ color: C.dark }}>
                        {doc.place_name}
                      </span>
                    )}
                    {addr && (
                      <span className="block text-sm" style={{ color: C.muted }}>
                        {addr}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 상세주소 (동·호수·층) */}
      <input
        type="text"
        value={addressDetail}
        onChange={(e) => onAddressDetailChange(e.target.value)}
        placeholder={detailPlaceholder}
        aria-label={detailLabel}
        autoComplete="off"
        className="h-14 w-full rounded-xl px-4 text-lg outline-none transition"
        style={inputBase(addressDetail.trim().length > 0)}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = C.borderActive;
          e.currentTarget.style.boxShadow = `0 0 0 3px ${C.borderActive}18`;
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = addressDetail.trim() ? C.borderActive : C.border;
          e.currentTarget.style.boxShadow = 'none';
        }}
        data-testid="foreign-addr-detail-input"
      />

      {/* 수기 입력 안내 — 검색 활성 상태에서만 토글 노출(검색 안 될 때 직접 입력 유도) */}
      {!manualMode ? (
        <button
          type="button"
          onClick={() => {
            setManualMode(true);
            setOpen(false);
          }}
          className="text-xs underline"
          style={{ color: C.muted }}
          data-testid="foreign-addr-manual-toggle"
        >
          {manualToggleLabel}
          {loading ? ' …' : ''}
        </button>
      ) : (
        <p className="text-xs" style={{ color: C.muted }} data-testid="foreign-addr-manual-hint">
          {manualHint}
        </p>
      )}
    </div>
  );
}
