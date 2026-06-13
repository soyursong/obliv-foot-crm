# T-20260614-foot-VISITPATH-JINSOGAE-TYPO — RCA 증거

생성: 2026-06-14 / agent: dev-foot
현장 신고: 셀프접수 워크인 방문경로 "진소개" 오타

## 결론: NOT_REPRODUCIBLE (코드·데이터 결함 아님)

"진소개"(3글자, 지인소개 제외) 단독값이 **전 계층 전수검색 0건**.

| 탐색 대상 | 지인소개(정상) | "진소개"(독립) | 방법 |
|---|---|---|---|
| 소스 코드 전체 | 다수 | **0** | `grep -rn 진소개 \| grep -v 지인소개` |
| 로컬 빌드 dist/assets | 정상 | **0** | dist 청크 grep |
| 프로덕션 SelfCheckIn-DdPhe5Y2.js | 3 | **0** | curl 후 grep |
| 프로덕션 CheckInDetailSheet-DMvDYmFJ.js | 4 | **0** | curl 후 grep |
| 프로덕션 Reservations-n-CVmvu7.js | 2 | **0** | curl 후 grep |
| 프로덕션 Customers-CrLE6kGQ.js | 1 | **0** | curl 후 grep |
| 프로덕션 Closing-Ce2CZLwa.js | 1 | **0** | curl 후 grep |
| 프로덕션 CustomerChartPage-Cp6S-MPQ.js | 3 | **0** | curl 후 grep |
| DB 전 text/varchar 컬럼 | 25건(정상) | **0** | `_rca.mjs` 전수 스캔 |
| git 전체 이력 (--all -S) | — | **0** | 과거에도 커밋된 적 없음 |

## 가설 검증

| planner 가설 | 판정 | 근거 |
|---|---|---|
| 미배포 (소스↔프로덕션 불일치) | ✗ 기각 | 프로덕션 번들도 '지인소개' 정상 |
| i18n 리소스 잔존 | ✗ 기각 | i18n 리소스 없음(하드코딩), 전부 정상 |
| 배포번들/CDN 캐시 | △ 부분 | 현재 배포 청크는 정상. 단, 특정 태블릿 PWA/브라우저 캐시에 과거 번들 잔존 가능성은 남음 |
| 현장 오인(misread) | ◎ 유력 | "지인소개"(4글자) → "진소개"(3글자) 태블릿 압축 렌더 시 '지인'→'진' 시각 축약 오인 |

## 핵심 판단
- git 전체 이력에 "진소개"가 단 한 번도 존재한 적 없음 → 과거 배포본에도 오타가 없었음 → "오래된 캐시" 가설조차 오타의 출처를 설명 못 함.
- 따라서 **블라인드 문자열 치환 대상이 존재하지 않음**. 코드 수정 없음(NO-OP).

## 권고
1. 현장에 정확한 재현 정보 요청: (a) 어느 화면(셀프접수 입력 / 직원 체크인 상세 / 고객정보 2번차트) (b) 스크린샷 (c) 실제 표시값.
2. 특정 태블릿에서만 보인다면 → 강력 새로고침(캐시 비움)으로 해소되는지 확인. 현재 배포 코드는 정상.

## 산출물
- `scripts/T-20260614-foot-VISITPATH-JINSOGAE-TYPO_rca.mjs` (DB read-only 전수 스캔)
