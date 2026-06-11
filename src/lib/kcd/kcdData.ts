// kcdData — KCD-8(한국표준질병·사인분류 8차) 내장 데이터셋 (정적 asset 번들).
// Ticket: T-20260611-foot-DIAG-KCD-BUNDLE-LOCKDOWN  (AC-0 = (A) 정적 번들 확정, DB 무변경)
//
// ⚠️ PROVISIONAL (AC-0b 비블로킹 원칙):
//   이 파일은 **임시 샘플 데이터셋**이다. 풋/근골격(MSK) 현장 빈출 상병 위주 큐레이션 ~80건.
//   최종 prod 번들 = 공식 KCD-8 ~8만건 전수(통계청 통계분류포털/KOICD)로 **drop-in 교체** 예정
//   (field-soak/배포 직전 게이트 + reporter confirm). 교체 시 KCD_BUNDLE_VERSION 갱신.
//
//   이 모듈은 kcdSearch.ts 에서 **dynamic import()** 로만 로드된다(코드 스플릿).
//   → 상병명 관리 탭을 열 때만 1회 fetch, 그 외 번들에 포함되지 않음.
//
// 데이터 = { code: KCD-8 코드(dotted 정본), name: 한글 상병명 }.
//   코드는 dotted 정본으로 저장(예 M72.2). dotless(M722) 검색은 kcdSearch 정규화가 흡수.

export interface KcdEntry {
  /** KCD-8 코드 (dotted 정본, 예: M72.2). 대문자. */
  code: string;
  /** 한글 상병명 (KCD-8 공식 명칭 또는 통용 명칭). */
  name: string;
}

/** 번들 데이터셋 버전 스탬프 (AC-5 ① — 어느 시점/출처 데이터인지 추적).
 *  포맷: KCD8-<edition>-<source>-<yyyymmdd>[-provisional]
 *  PROVISIONAL: 공식 8만건 미반영. prod drop-in 시 -provisional 제거 + 실제 출처/일자 기입. */
export const KCD_BUNDLE_VERSION = 'KCD8-curated-foot-20260611-provisional';

/** 데이터셋 출처 메타 (AC-0b 버전 스탬프). */
export const KCD_BUNDLE_META = {
  version: KCD_BUNDLE_VERSION,
  provisional: true,
  source: 'curated (foot/MSK 빈출 큐레이션) — 공식 KCD-8 8만건 전수 미반영',
  edition: 'KCD-8',
  count_note: 'provisional sample ~80건. prod = 통계청/KOICD 공식 전수 교체 대상',
} as const;

// ---------------------------------------------------------------------------
// PROVISIONAL 데이터셋 — 풋/근골격 빈출 + 일반 상병 큐레이션
//   (현장 클릭 시나리오/E2E·field-soak 의미가 있도록 실재 KCD-8 코드만 수록)
// ---------------------------------------------------------------------------
export const KCD_DATASET: KcdEntry[] = [
  // 족부·발목 (foot/ankle) — 핵심
  { code: 'M72.2', name: '발바닥근막섬유종증(족저근막염)' },
  { code: 'M76.6', name: '아킬레스힘줄염' },
  { code: 'M77.3', name: '발꿈치뼈가시(종골극)' },
  { code: 'M77.4', name: '발허리통증(중족골통)' },
  { code: 'M20.1', name: '엄지건막류(무지외반증)' },
  { code: 'M20.2', name: '엄지발가락 굳음증(강직)' },
  { code: 'M20.4', name: '기타 망치발가락(후천성)' },
  { code: 'M21.4', name: '편평발(평발)' },
  { code: 'M21.6', name: '기타 후천성 발목 및 발의 변형' },
  { code: 'M25.57', name: '발목 및 발의 관절통' },
  { code: 'M79.67', name: '발목 및 발의 통증' },
  { code: 'S93.401', name: '발목의 외측인대 염좌 및 긴장' },
  { code: 'S93.40', name: '발목의 상세불명 인대의 염좌 및 긴장' },
  { code: 'S93.30', name: '발의 관절 및 인대의 염좌 및 긴장' },
  { code: 'S92.30', name: '발허리뼈(중족골)의 골절, 폐쇄성' },
  { code: 'S92.00', name: '발꿈치뼈(종골)의 골절, 폐쇄성' },
  { code: 'G57.6', name: '발바닥신경의 병변(지간신경종)' },
  { code: 'L84', name: '티눈 및 못(굳은살)' },
  { code: 'B35.1', name: '발톱백선(조갑백선)' },
  { code: 'L60.0', name: '내향성 손발톱(내성발톱)' },
  { code: 'I83.9', name: '하지정맥류(궤양 또는 염증 없음)' },
  { code: 'E11.5', name: '2형 당뇨병(말초순환 합병증 동반, 당뇨발)' },

  // 무릎·하지 (knee/leg)
  { code: 'M17.9', name: '상세불명의 무릎관절증' },
  { code: 'M22.2', name: '무릎뼈연골연화증' },
  { code: 'M23.2', name: '오래된 파열에 의한 반월연골(반월판) 장애' },
  { code: 'M76.5', name: '슬개건염(무릎힘줄염)' },
  { code: 'S83.2', name: '무릎의 반월연골(반월판) 파열, 최근' },
  { code: 'S83.5', name: '무릎의 십자인대 염좌 및 긴장' },
  { code: 'M70.5', name: '무릎의 기타 윤활낭염' },
  { code: 'M79.66', name: '아래다리의 통증' },

  // 척추·요부 (spine)
  { code: 'M51.2', name: '기타 명시된 추간판전위(요추)' },
  { code: 'M54.5', name: '요통' },
  { code: 'M54.4', name: '좌골신경통을 동반한 요통(좌골신경통)' },
  { code: 'M48.0', name: '척추협착(척추관협착증)' },
  { code: 'M47.8', name: '기타 척추증' },
  { code: 'M53.2', name: '척추불안정' },
  { code: 'M62.83', name: '근육연축(근경련)' },

  // 어깨·상지 (shoulder/upper)
  { code: 'M75.0', name: '어깨의 유착성 관절낭염(오십견)' },
  { code: 'M75.1', name: '돌림근띠증후군(회전근개)' },
  { code: 'M75.4', name: '어깨의 부딪힘증후군(충돌증후군)' },
  { code: 'M77.0', name: '안쪽위관절융기염(내상과염)' },
  { code: 'M77.1', name: '가쪽위관절융기염(테니스엘보)' },
  { code: 'M65.3', name: '방아쇠수지(탄발지)' },
  { code: 'M70.0', name: '손 및 손목의 만성 마찰윤활낭염' },
  { code: 'G56.0', name: '손목굴증후군(수근관증후군)' },

  // 일반 근골격·연부조직
  { code: 'M79.1', name: '근육통' },
  { code: 'M79.7', name: '섬유근통' },
  { code: 'M25.5', name: '관절통' },
  { code: 'M62.6', name: '근육긴장' },
  { code: 'M60.9', name: '상세불명의 근육염' },
  { code: 'M70.9', name: '상세불명의 사용·과다사용 및 압박과 관련된 연조직 장애' },
  { code: 'T14.3', name: '상세불명 신체부위의 관절 및 인대의 탈구·염좌 및 긴장' },

  // 신경·통증
  { code: 'G54.4', name: '허리엉치신경뿌리 장애' },
  { code: 'M79.2', name: '상세불명의 신경통 및 신경염' },
  { code: 'R52.2', name: '기타 만성 통증' },

  // 손상·후유증
  { code: 'S90.3', name: '발의 기타 부위의 타박상' },
  { code: 'S80.0', name: '무릎의 타박상' },
  { code: 'T93.3', name: '아래다리 탈구·염좌 및 긴장의 후유증' },

  // 일반(내과 등) — 검색 폭 확인용 소수
  { code: 'J00', name: '급성 비인두염(감기)' },
  { code: 'K29.7', name: '상세불명의 위염' },
  { code: 'I10', name: '본태성(원발성) 고혈압' },
  { code: 'E78.5', name: '상세불명의 고지질혈증' },
  { code: 'R51', name: '두통' },
  { code: 'M81.9', name: '상세불명의 골다공증' },
  { code: 'E03.9', name: '상세불명의 갑상선기능저하증' },
  { code: 'F41.9', name: '상세불명의 불안장애' },
  { code: 'G47.0', name: '잠들기 및 수면유지 장애(불면증)' },
  { code: 'L20.9', name: '상세불명의 아토피피부염' },
];
