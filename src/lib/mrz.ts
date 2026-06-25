// mrz.ts — 여권 MRZ(Machine Readable Zone) TD3 파서 + 국적 alpha-3 매핑
// T-20260625-foot-PASSPORT-FOREIGN-INFO-PORT (origin: T-20260609-derm-NEWCUST-PASSPORT-SCAN, 무변경 이식)
//
// 여권(TD3)은 하단 2줄 × 44자. 외부 npm 패키지(mrz) 없이 deterministic 파싱.
// 데이터는 전적으로 클라이언트(브라우저) 내에서만 처리 — 외부 전송/저장 없음.
//
// TD3 레이아웃:
//  Line1: P<ISS<SURNAME<<GIVEN<NAMES<<<<<...        (44자)
//    [0]   문서타입 'P'
//    [2:5] 발급국 alpha-3
//    [5:]  성명 필드 (SURNAME<<GIVEN, '<'=공백 구분)
//  Line2: PPPPPPPPP C NNN YYMMDD C S YYMMDD C <개인번호14> C 종합C   (44자)
//    [0:9]   여권번호
//    [9]     여권번호 check digit
//    [10:13] 국적 alpha-3
//    [13:19] 생년월일 YYMMDD
//    [19]    생년월일 check digit
//    [20]    성별 M/F/<
//    [21:27] 만료일 YYMMDD

export interface MrzResult {
  /** 여권 영문 성 (SURNAME) */
  surname: string;
  /** 여권 영문 이름 (GIVEN NAMES) */
  givenNames: string;
  /** 생년월일 ISO yyyy-mm-dd (파싱 실패 시 null) */
  birthDate: string | null;
  /** 성별 'm' | 'f' | null */
  gender: 'm' | 'f' | null;
  /** 국적 ISO alpha-3 (예: KOR) */
  nationalityAlpha3: string | null;
  /** 여권번호 (trailing '<' 제거) */
  passportNumber: string;
  /** MRZ 신뢰도 힌트: check digit 1개 이상 통과 여부 */
  verified: boolean;
}

/** OCR이 흔히 혼동하는 글자 → MRZ 허용 charset(A-Z,0-9,<) 보정 */
function cleanMrzLine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[«»«»]/g, '<') // guillemets → filler
    .replace(/[^A-Z0-9<]/g, '<');
}

/** TD3 라인 후보 추출: 길이 ~44, '<' 다수 포함하는 라인 2개. */
function extractMrzLines(text: string): [string, string] | null {
  const candidates = text
    .split(/\r?\n/)
    .map(cleanMrzLine)
    .filter((l) => l.length >= 28 && (l.match(/</g)?.length ?? 0) >= 2);
  if (candidates.length < 2) return null;
  // 길이를 44에 맞춰 정규화(패딩/트림)
  const norm = (l: string) => (l.length >= 44 ? l.slice(0, 44) : l.padEnd(44, '<'));
  // 'P<'로 시작하는 라인을 Line1로 우선 채택
  const line1Idx = candidates.findIndex((l) => l.startsWith('P<') || l.startsWith('P'));
  if (line1Idx >= 0 && candidates[line1Idx + 1]) {
    return [norm(candidates[line1Idx]), norm(candidates[line1Idx + 1])];
  }
  // 폴백: 마지막 2줄
  return [norm(candidates[candidates.length - 2]), norm(candidates[candidates.length - 1])];
}

/** 이름 필드 파싱: SURNAME<<GIVEN<NAMES → {surname, givenNames} */
function parseNameField(field: string): { surname: string; givenNames: string } {
  const trimmed = field.replace(/<+$/, '');
  const [surnameRaw, givenRaw = ''] = trimmed.split('<<');
  const toName = (s: string) =>
    s.split('<').filter(Boolean).join(' ').trim();
  return { surname: toName(surnameRaw), givenNames: toName(givenRaw) };
}

/** YYMMDD → ISO. 생년 century 추론: YY가 현재 2자리 연도보다 크면 19xx, 아니면 20xx. */
function parseMrzDate(yymmdd: string): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const nowYY = new Date().getFullYear() % 100;
  const century = yy > nowYY ? 1900 : 2000;
  const year = century + yy;
  const dt = new Date(year, mm - 1, dd);
  if (dt.getFullYear() !== year || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  if (dt.getTime() > Date.now()) return null; // 미래 생년 거부
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** ICAO 9303 check digit (weights 7,3,1). */
function checkDigit(input: string): number {
  const val = (c: string): number => {
    if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
    if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55; // A=10
    return 0; // '<'
  };
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += val(input[i]) * weights[i % 3];
  return sum % 10;
}

/**
 * MRZ 텍스트(OCR 결과 전체)에서 TD3 여권 정보를 파싱.
 * @returns 파싱 성공 시 MrzResult, 실패 시 null (수동 입력 폴백)
 */
export function parseMrz(ocrText: string): MrzResult | null {
  const lines = extractMrzLines(ocrText);
  if (!lines) return null;
  const [line1, line2] = lines;

  // Line1: 이름
  const { surname, givenNames } = parseNameField(line1.slice(5));

  // Line2: 여권번호 / 국적 / 생년월일 / 성별
  const passportNumber = line2.slice(0, 9).replace(/<+$/, '').replace(/</g, '');
  const passportCd = line2[9];
  const nationalityAlpha3 = /^[A-Z]{3}$/.test(line2.slice(10, 13)) ? line2.slice(10, 13) : null;
  const dobRaw = line2.slice(13, 19);
  const dobCd = line2[19];
  const birthDate = parseMrzDate(dobRaw);
  const sexChar = line2[20];
  const gender: 'm' | 'f' | null = sexChar === 'M' ? 'm' : sexChar === 'F' ? 'f' : null;

  // check digit 검증(신뢰도 힌트). OCR 오인식 가능성 → 통과 0개여도 결과는 반환.
  const passportOk = /\d/.test(passportCd) && checkDigit(line2.slice(0, 9)) === Number(passportCd);
  const dobOk = /\d/.test(dobCd) && checkDigit(dobRaw) === Number(dobCd);
  const verified = passportOk || dobOk;

  // 최소 의미 있는 결과인지 — 이름/여권번호/생년월일 중 하나라도 있어야
  if (!surname && !givenNames && !passportNumber && !birthDate) return null;

  return {
    surname,
    givenNames,
    birthDate,
    gender,
    nationalityAlpha3,
    passportNumber,
    verified,
  };
}

/**
 * ISO alpha-3 → 한글 국가명 (nationalities 마스터 매칭용 best-effort).
 * derm 외국인 환자 빈출국 우선. 미수록 코드는 null → 자동 매칭 생략(수동 선택).
 */
export const ALPHA3_TO_KO: Record<string, string> = {
  KOR: '대한민국',
  CHN: '중국',
  JPN: '일본',
  USA: '미국',
  VNM: '베트남',
  THA: '태국',
  TWN: '대만',
  HKG: '홍콩',
  SGP: '싱가포르',
  PHL: '필리핀',
  IDN: '인도네시아',
  MYS: '말레이시아',
  MNG: '몽골',
  RUS: '러시아',
  KAZ: '카자흐스탄',
  IND: '인도',
  GBR: '영국',
  AUS: '호주',
  CAN: '캐나다',
  FRA: '프랑스',
  DEU: '독일',
};

/** alpha-3 → 한글 국가명(없으면 null). */
export function alpha3ToKoreanName(alpha3: string | null): string | null {
  if (!alpha3) return null;
  return ALPHA3_TO_KO[alpha3.toUpperCase()] ?? null;
}
