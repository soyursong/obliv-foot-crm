/**
 * T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — 배치 apply 매핑 SSOT (16종, #3~#18)
 *
 * 부모 §19 apply GO(2026-07-18) 범위. #1 플루나코엠(분리 T-20260716 旣적용)·#2 대웅푸루나졸(분리 DELETE 티켓)·
 * #19 오구멘토(BLOCKER: 확정명 '오구멘틴375mg'=심평원 master 취소 2012-04-26 discontinued, active 부재 → planner FOLLOWUP) 제외.
 *
 * 각 코드는 2026-07-16 갱신 심평원 의약품표준코드 master(/tmp/hira_drugmaster.csv, data.go.kr 15067462)로
 * ★재검증 완료(13/13 active·이름일치, 2026-07-18). v3(2026-06-18) 이후 master 갱신으로 오구멘토 소실 발견 → 전건 재검증함.
 *
 * claim_code 체계(§14 DA CONSULT-REPLY#2):
 *   - 급여=EDI bare / 비급여=HIRA-{품목기준코드9}(fallback HIRA-STD-{표준코드13}).
 *   - 본 배치는 IDENTITY 승격(자체→official 링크·배지 제거)이 목적. 급여/EDI 판정은 canonical
 *     hira_insurance_sync.mjs(약제급여목록표 xlsx) 배치 소관 → 전건 HIRA-{품목기준코드9} + insurance_status=NULL
 *     (급여여부 미확정, 오청구 방지). 이는 분리 티켓 FLUNACOEM(旣 PROD 적용, supervisor 승인)이 확립한 선례.
 *     bare 표준코드 적재 NO_GO(청구 reader EDI 오인) 준수 = HIRA- prefix 필수.
 */

// 13 distinct official targets (dedup 3쌍 수렴)
export const OFFICIALS = [
  { key: 'BARTOBEN',   pumok: '202401671', std13: '8806980045701', name_ko: '바르토벤외용액(에피나코나졸)',            classification_hint: '외용약' },
  { key: 'HANMIUREA',  pumok: '198501225', std13: '8806435037404', name_ko: '한미유리아크림200밀리그램(우레아)',       classification_hint: '외용약' },
  { key: 'CEFACLEAR',  pumok: '201908179', std13: '8800570005007', name_ko: '세파클리어캡슐(세파클러수화물)',           classification_hint: '내복약' },
  { key: 'STILLEN',    pumok: '200500248', std13: '8806425022908', name_ko: '스티렌정(애엽95%에탄올연조엑스(20→1))',   classification_hint: '내복약' },
  { key: 'LOXOPOFEN',  pumok: '201802417', std13: '8806796009508', name_ko: '록소포펜정(록소프로펜나트륨수화물)',       classification_hint: '내복약' },
  { key: 'TERMIZOL',   pumok: '201905864', std13: '8800570000606', name_ko: '터미졸크림(테르비나핀염산염)',             classification_hint: '외용약' },
  { key: 'BETABATE',   pumok: '198300730', std13: '8806428007407', name_ko: '베타베이트연고(클로베타솔프로피오네이트)', classification_hint: '외용약' },
  { key: 'HITRI',      pumok: '200404710', std13: '8806717018602', name_ko: '하이트리크림',                             classification_hint: '외용약' },
  { key: 'ESROBAN',    pumok: '199902738', std13: '8806441004803', name_ko: '에스로반연고(무피로신)10g',                classification_hint: '외용약' }, // §16 총괄확정 규격 10g
  { key: 'JUBLIA',     pumok: '201702389', std13: '8806425073900', name_ko: '주블리아외용액(에피나코나졸)',             classification_hint: '외용약' },
  { key: 'RIDOMEX',    pumok: '198600458', std13: '8806457005603', name_ko: '삼아리도멕스크림(프레드니솔론발레로아세테이트)20g', classification_hint: '외용약' }, // §16 총괄확정 규격 20g
  { key: 'LUMAZOL',    pumok: '201600380', std13: '8806228-026400', name_ko: '루마졸크림(플루트리마졸)',                 classification_hint: '외용약' }, // std13 = GS1 7-6 하이픈 표기(RRN 무하이픈 스캐너 FP 회피, claim_code=std9 기준·기능 무영향)
  { key: 'DRROBAN',    pumok: '201905373', std13: '8800570013903', name_ko: '닥터로반연고(무피로신)',                   classification_hint: '외용약' },
];

// 16 custom rows (#3~#18) → official key (dedup 3쌍: BARTOBEN·HANMIUREA·JUBLIA 는 2 custom → 1 official)
export const CUSTOMS = [
  { n: 3,  legacy: 'LEGACY-1bb57c2e4782', name_ko: '바르토벤 외용액 4ml(에피나코나졸)',                       official: 'BARTOBEN' },
  { n: 4,  legacy: 'LEGACY-1edb55721d2f', name_ko: '한미유리아크림 200ml(우레아)50g',                         official: 'HANMIUREA' },
  { n: 5,  legacy: 'LEGACY-1f8b80f62fbb', name_ko: '세파클리어',                                              official: 'CEFACLEAR' },
  { n: 6,  legacy: 'LEGACY-2a0c89797bce', name_ko: '스티렌',                                                  official: 'STILLEN' },
  { n: 7,  legacy: 'LEGACY-2e28835bfc5f', name_ko: '록소포펜',                                                official: 'LOXOPOFEN' },
  { n: 8,  legacy: 'LEGACY-3e7ce9b8f6fb', name_ko: '터미졸크림(테르비나핀염산염)15g',                         official: 'TERMIZOL' },
  { n: 9,  legacy: 'LEGACY-45744395cb7a', name_ko: '한미유리아크림 200ml(우레아)20g',                         official: 'HANMIUREA' },  // DEDUP w/ #4
  { n: 10, legacy: 'LEGACY-5d19d9727ef4', name_ko: '바르토벤 외용액 8ml(에피나코나졸)',                       official: 'BARTOBEN' },   // DEDUP w/ #3
  { n: 11, legacy: 'LEGACY-a7a1a9195c67', name_ko: '베타베이트연고(클로베타솔프로피오네이트)15g',             official: 'BETABATE' },
  { n: 12, legacy: 'LEGACY-a9078a1449c3', name_ko: '하이트리크림 20g',                                        official: 'HITRI' },
  { n: 13, legacy: 'LEGACY-ba5c97dfb0b8', name_ko: '에스로반연고(무피로신)10g',                               official: 'ESROBAN' },
  { n: 14, legacy: 'LEGACY-ce36618a71d0', name_ko: '주블리아외용액 4ml(에피나코나졸)',                        official: 'JUBLIA' },
  { n: 15, legacy: 'LEGACY-d17507bd1967', name_ko: '삼아리도멕스크림(프레드니솔론발레로아세테이트)',          official: 'RIDOMEX' },
  { n: 16, legacy: 'LEGACY-e11452cf9200', name_ko: '주블리아 외용액 8ml(에피나코나졸)',                       official: 'JUBLIA' },     // DEDUP w/ #14
  { n: 17, legacy: 'LEGACY-e98e0cb79ec6', name_ko: '루마졸크림',                                              official: 'LUMAZOL' },
  { n: 18, legacy: 'LEGACY-f76313d45cc9', name_ko: '닥터로반',                                                official: 'DRROBAN' },
];

export const EXCLUDED = {
  '#1 플루나코엠캡슐': '분리 티켓 T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY (旣 PROD 적용)',
  '#2 대웅푸루나졸정150mg': '총괄 제외 → 분리 DELETE 티켓 T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE (in-place 접근 절대 금지)',
  '#19 오구멘토': 'BLOCKER: 확정명 오구멘틴375mg = 심평원 master 취소(2012-04-26) discontinued, active 부재 → planner FOLLOWUP',
};

export const CLAIM = (o) => `HIRA-${o.pumok}`; // 비급여/EDI미확정 IDENTITY prefix
