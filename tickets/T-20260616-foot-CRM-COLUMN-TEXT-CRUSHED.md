---
id: T-20260616-foot-CRM-COLUMN-TEXT-CRUSHED
title: "[진료대시보드] 환자목록 칼럼 셀 텍스트 세로뜨기/압축 해소 — 배지 라벨 whitespace-nowrap"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: N/A (FE className only, DB 무변경)
commit_sha: fccc7da7
created: 2026-06-16
assignee: dev-foot
reporter: 문지은 대표원장
source_msg: MSG-20260616-140551-4qts
---

# T-20260616-foot-CRM-COLUMN-TEXT-CRUSHED

## 배경
진료대시보드(의료차트 환자목록 = `DoctorPatientList`) 칼럼 셀 글씨가 한 글자씩
세로로 배열되고 칼럼 너비 압축으로 텍스트가 눌림 (문지은 대표원장, 스크린샷 F0BAU9239R8).

## 원인 (회귀)
- T-20260615-foot-CRM-FONT-PRETENDARD-GLOBAL: Pretendard 글리프 메트릭 확대.
- T-20260613/14 DOCPATIENTLIST 컬럼폭 타이트화.
→ 좁아진 트랙에서 **배지(VisitTypeBadge/StatusCell/PrescriptionStatusBadge/HealerLaserBadge)**
   한글 라벨이 공백('처방전 O','레이저 ✅') 또는 CJK 문자 사이('진료완료','초진')에서
   줄바꿈 → '세로로 뜨고' 압축 증상. 데이터 텍스트 셀은 이미 `truncate`(=nowrap)라 무관.

## 변경 (FE-only, GO)
`src/components/doctor/DoctorPatientList.tsx` — 7개 배지 span에 `whitespace-nowrap` 추가:
| 배지 | 라벨 |
|---|---|
| PrescriptionStatusBadge confirmed | 처방전 O |
| PrescriptionStatusBadge pending | 임시 |
| PrescriptionStatusBadge none | 처방전 X |
| HealerLaserBadge | 레이저 ✅/❌ |
| VisitTypeBadge | 초진/재진 |
| StatusCell pink | 진료완료 |
| StatusCell done | 귀가 |

+ 처방전 O/임시 배지 아이콘에 `shrink-0`(아이콘 찌그러짐 방지).
자형/자간 무변경 (압축은 폭 부족 결과 → nowrap으로만 해소). grid-cols 컬럼폭 보존.

## AC
- AC-1: 환자목록 칼럼 셀 텍스트 세로뜨기/압축 없이 가로 정상 렌더 ✅
- AC-2: 데이터 셀 폭 부족 시 ellipsis(…), 세로 wrap 금지, 자형 왜곡 없음 ✅ (기존 truncate 유지)
- AC-3: 회귀 가드 — 인접 칼럼·colwidth(T-20260613/14) 무변, grid-template 보존 ✅
- AC-4: iPad Safari + Galaxy Tab Chrome 동일 (CSS white-space, 크로스브라우저 표준) — 현장 confirm 대기

## E2E
`tests/e2e/T-20260616-foot-CRM-COLUMN-TEXT-CRUSHED.spec.ts` (15 passed):
1. 배지 nowrap 소스 가드 7종 + in-clinic truncate 유지
2. 좁은 셀 렌더 — nowrap 1줄 / 데이터 셀 ellipsis(세로 wrap 아님)
3. colwidth 회귀 가드 — 오늘/이력 grid-template 보존 + 자형/자간 미조작

## 검증
- `npm run build` ✅
- E2E 15/15 PASS ✅
- DB 변경 없음 / risk_verdict=GO
- 현장 확인 대기: 갤탭 실기기 + iPad Safari 렌더 confirm 후 done
