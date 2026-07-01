// T-20260630-foot-SELFCHECKIN-ADDR-KAKAO-ENG
//
// 외국인 셀프접수 전용 "국내 체류지(숙소) 주소" 입력 위젯.
//   · 카카오 Daum 우편번호 팝업 재활용(2번차트/내국인 우편번호검색과 동일 임베드, postcode.v2.js).
//     ★신규 Kakao REST 키 불요★ — 팝업은 키 없이 동작(직전 T-20260625 REST 키워드검색을 SUPERSEDE).
//   · 항목 선택 시 영문 도로명주소(roadAddressEnglish, 없으면 jibunAddressEnglish → addressEnglish → address)
//     를 주소 필드에 자동기입. 우편번호(zonecode)도 함께 채움(optional onPostalCodeChange).
//   · 팝업으로 못 찾는 숙소(카카오 DB 미수록) → 주소 필드에 직접 타이핑하는 수기 폴백 상시 허용(Q2=b).
//   · 팝업 검색 입력창은 한국어 기반(Q1 한계 — 호텔명·주소를 한국어로 검색해야 함, 현장 고지 완료).
//     선택 후 결과는 영문 주소로 자동기입되어 노출됨.
//
// 의존성 0 추가: 공식 Daum postcode <script> embed 만 동적 로드(신규 npm 미설치).
//   · 저장: 전체(영문)주소 → customers.address / 동·호수 등 상세 → customers.address_detail.
//   · 영문주소가 3칼럼(시/도·시군구·상세) 매핑 어려우면 단일 address 텍스트로 폴백(마이그 불요).

import { useId } from 'react';

const C = {
  dark: '#3D2B1A',
  primary: '#5C3D1E',
  medium: '#7B5130',
  muted: '#8B7355',
  border: '#D4C5B2',
  borderActive: '#7B5130',
} as const;

const DAUM_POSTCODE_SRC = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

// Daum 우편번호 팝업 oncomplete 페이로드(영문 필드 포함 부분 타입).
interface DaumPostcodeData {
  zonecode: string;
  address: string;
  addressEnglish?: string;
  roadAddress?: string;
  roadAddressEnglish?: string;
  jibunAddress?: string;
  jibunAddressEnglish?: string;
  buildingName?: string;
}

// 선택 결과 → 영문 도로명주소 우선 합성. 영문 미제공 항목(드묾)은 한글주소로 최종 폴백.
function composeEnglishAddress(data: DaumPostcodeData): string {
  return (
    data.roadAddressEnglish ||
    data.jibunAddressEnglish ||
    data.addressEnglish ||
    data.address ||
    ''
  ).trim();
}

interface Props {
  /** 전체주소 (customers.address) — 팝업 선택 시 영문주소 자동기입, 수기 직접 입력도 허용 */
  address: string;
  onAddressChange: (v: string) => void;
  /** 상세주소 — 호수·동 등 (customers.address_detail) */
  addressDetail: string;
  onAddressDetailChange: (v: string) => void;
  /** 우편번호(customers.postal_code) 자동기입 — optional */
  onPostalCodeChange?: (v: string) => void;
  // 라벨/플레이스홀더 (i18n 외부 주입)
  searchLabel: string;
  searchButtonLabel: string;
  searchPlaceholder: string;
  detailLabel: string;
  detailPlaceholder: string;
  manualHint: string;
}

export default function ForeignStayAddressInput({
  address,
  onAddressChange,
  addressDetail,
  onAddressDetailChange,
  onPostalCodeChange,
  searchLabel,
  searchButtonLabel,
  searchPlaceholder,
  detailLabel,
  detailPlaceholder,
  manualHint,
}: Props) {
  const fieldId = useId();

  // 카카오 Daum 우편번호 팝업 오픈 — 스크립트 미로드 시 동적 삽입 후 오픈(2번차트 패턴 재사용).
  const openPostcode = () => {
    const runPostcode = () => {
      // @ts-expect-error Daum Postcode global
      new window.daum.Postcode({
        oncomplete: (data: DaumPostcodeData) => {
          const eng = composeEnglishAddress(data);
          if (eng) onAddressChange(eng);
          if (data.zonecode && onPostalCodeChange) onPostalCodeChange(data.zonecode);
        },
      }).open();
    };
    // @ts-expect-error Daum Postcode global
    if (!window.daum?.Postcode) {
      const script = document.createElement('script');
      script.src = DAUM_POSTCODE_SRC;
      script.onload = () => runPostcode();
      document.head.appendChild(script);
    } else {
      runPostcode();
    }
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

      {/* 주소 행: [주소 입력(영문 자동기입 + 수기 폴백)] [주소검색 버튼] */}
      <div className="flex gap-2">
        <input
          id={`${fieldId}-addr`}
          type="text"
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          placeholder={searchPlaceholder}
          autoComplete="off"
          className="h-14 flex-1 rounded-xl px-4 text-lg outline-none transition"
          style={inputBase(address.trim().length > 0)}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = C.borderActive;
            e.currentTarget.style.boxShadow = `0 0 0 3px ${C.borderActive}18`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = address.trim() ? C.borderActive : C.border;
            e.currentTarget.style.boxShadow = 'none';
          }}
          data-testid="foreign-addr-input"
        />
        <button
          type="button"
          onClick={openPostcode}
          className="flex-none rounded-xl px-5 text-base font-medium text-white transition active:scale-95"
          style={{ backgroundColor: C.primary }}
          data-testid="foreign-addr-search-btn"
        >
          {searchButtonLabel}
        </button>
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

      {/* 수기 폴백 안내 — 팝업으로 못 찾는 숙소는 위 주소칸에 직접 입력(Q2=b) */}
      <p className="text-xs" style={{ color: C.muted }} data-testid="foreign-addr-manual-hint">
        {manualHint}
      </p>
    </div>
  );
}
