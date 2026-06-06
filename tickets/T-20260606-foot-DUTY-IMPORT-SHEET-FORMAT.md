---
id: T-20260606-foot-DUTY-IMPORT-SHEET-FORMAT
domain: foot
status: deploy-ready
qa_result: pass
deploy_commit: 2001c73
deployed_at: 2026-06-06T11:23:16+09:00
priority: P2
db_change: false
owner: agent-fdd-dev-foot
---

# T-20260606-foot-DUTY-IMPORT-SHEET-FORMAT — 구글시트 근무 캘린더 파서 (주 단위 블록)

## 배경
planner hold 해제 + 실측 샘플 회수 완료. 실측 시트가 "행=직원/열=날짜" flat 매트릭스가
아니라 **주(week) 단위 캘린더 블록**임이 확정 → `extractCandidates` 재작성.

샘플: `memory/_handoff/diag/foot_duty_sheet/duty_sheet_gid341864863_상담코디_20260606.csv`

## 변경 (src/components/DutyRosterImportDialog.tsx)
1. **셀 시맨틱 확정**: 셀에 직원명 있으면 출근 / 비면 휴무. O/X 마킹 파싱 폐기(MARK_MAP/markToRosterType/parseSheetDate 제거). 매칭 직원 전부 `regular`.
2. **블록 인식**: 연/월/팀 헤더(`parseMonthHeader`)로 컨텍스트 갱신 → 요일헤더 아래 날짜행(day≥3, `dayColumnsOf`) 단위 분절.
3. **칼럼→실날짜**: `resolveRowDates` — 일자가 직전보다 작아지면 다음 달(12월 넘으면 연도+1). **월 롤오버** 처리(29,30,1,2 → 6월말/7월초).
4. **출근자 수집**: 날짜행 아래 ~ 다음 날짜행/헤더/끝까지 칼럼별 비셀 = 출근자 → matchStaff.
5. **특수토큰**: `휴진`=skip / `전직원`=그날 활성 staff 전체 확장 / `총괄`=김주연 치환(Q5) / 이름 trim.
6. 팀 라벨(team) 컨텍스트 캡처. 표시: rawMark는 토큰일 때만 보조 노출.

## 가드 (불변 — additive)
- AC-2: 삽입은 "삽입 확정" 사람 게이트(미리보기 시점 DB 미삽입)
- AC-4: (clinic_id, date, doctor_id) 중복 차단(기존+배치내)
- AC-6: 호출부(DutyRosterTab) admin/manager 권한 게이트

## 검증
- 실측 CSV 단위검증: 8블록 / 5-13~7-04 / 월롤오버(6-30→7-01) / 전직원·총괄·휴진·trim 전부 정상
- build OK (3.52s)
- E2E `tests/e2e/T-20260606-foot-DUTY-IMPORT-SHEET-FORMAT.spec.ts` 3 시나리오(주블록·월롤오버·특수토큰) + 회귀(ALLSTAFF) 모두 pass
- DB 변경 없음

## 비차단 confirm (기본값 진행)
- Q4 치료팀 탭: 상담&코디(gid=341864863) 우선, 탭 다중 지원 구조(파서는 단일 그리드 입력 기준, 다탭은 파일/붙여넣기 반복 import로 커버)
- Q5 총괄→김주연 1:1 / 전직원→활성 staff 전체
- Q6 표시: 통합 단일 명단(팀 라벨 캡처, 섹션 분리는 미적용)
