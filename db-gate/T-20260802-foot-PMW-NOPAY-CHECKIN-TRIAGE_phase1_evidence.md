# T-20260802-foot-PMW-NOPAY-CHECKIN-TRIAGE — Phase1 진단표 (현장 제시용)

- 생성: 2026-08-02T06:03:15.855Z (KST today=2026-08-02)
- **class-A(체크인-무수납 잔류) = 31건** — payment_waiting인데 결제기록 전무
- disposition 후보: (a)완료-수납누락 의심 12 / (b)취소·노쇼 의심 0 / (c)판단불가 19
- ⚠️ 아래 그룹은 **후보 제안**입니다. 결제기록이 없어 자동 판정이 불가하여, **행별 정답 disposition(완료/미수/취소/노쇼)은 현장에서만 확정**할 수 있습니다.
- write 0 (진단 전용). 정정 실행(Phase3)은 현장 확정 후 별도 봉투로만 진행합니다.

| # | 고객 | 차트 | 방문 | 체크인일 | 경과 | 마지막 상태전이 | 예약상태 | 동일자결제 | disposition 후보 |
|---|------|------|------|----------|------|------------------|----------|-----------|------------------|
| 1 | 김민경 | F-0177 | returning | 2026-06-02 | 61일 | preconditioning→payment_waiting | checked_in | 0 | **a·완료수납누락?** |
| 2 | 김민경 | F-0177 | returning | 2026-06-15 | 48일 | laser→payment_waiting | checked_in | 0 | **a·완료수납누락?** |
| 3 | 김민경 | F-0177 | returning | 2026-06-16 | 47일 | done→payment_waiting | checked_in | 0 | **a·완료수납누락?** |
| 4 | 김민경 | F-0177 | returning | 2026-06-23 | 40일 | treatment_waiting→payment_waiting | checked_in | 0 | **c·판단불가** |
| 5 | 김민경 | F-0177 | returning | 2026-06-25 | 38일 | done→payment_waiting | checked_in | 0 | **a·완료수납누락?** |
| 6 | 김민경 | F-0177 | returning | 2026-06-27 | 36일 | laser_waiting→payment_waiting | checked_in | 0 | **c·판단불가** |
| 7 | 풋테스트1 | F-4427 | new | 2026-06-30 | 33일 | receiving→payment_waiting | checked_in | 0 | **c·판단불가** |
| 8 | 풋테스트3 | F-4425 | new | 2026-06-30 | 33일 | receiving→payment_waiting | checked_in | 0 | **c·판단불가** |
| 9 | 김민경 | F-0177 | returning | 2026-07-01 | 32일 | exam_waiting→payment_waiting | checked_in | 0 | **c·판단불가** |
| 10 | Daniel | F-4444 | new | 2026-07-01 | 32일 | consult_waiting→payment_waiting | checked_in | 0 | **c·판단불가** |
| 11 | 김민경 | F-0177 | returning | 2026-07-03 | 30일 | done→payment_waiting | checked_in | 0 | **a·완료수납누락?** |
| 12 | 김민경 | F-0177 | returning | 2026-07-04 | 29일 | receiving→payment_waiting | checked_in | 0 | **c·판단불가** |
| 13 | 김민경 | F-0177 | returning | 2026-07-06 | 27일 | treatment_waiting→payment_waiting | checked_in | 0 | **c·판단불가** |
| 14 | 풋 서류 테스트 입니다 | F-4468 | new | 2026-07-06 | 27일 | receiving→payment_waiting | checked_in | 0 | **c·판단불가** |
| 15 | 김민경 | F-0177 | returning | 2026-07-08 | 25일 | treatment_waiting→payment_waiting | checked_in | 0 | **c·판단불가** |
| 16 | 총괄테스트중 | F-4574 | returning | 2026-07-10 | 23일 | receiving→payment_waiting | checked_in | 0 | **c·판단불가** |
| 17 | [재수집필요] | F-4621 | new | 2026-07-13 | 20일 | receiving→payment_waiting | - | 0 | **c·판단불가** |
| 18 | 김민경 | F-4452 | returning | 2026-07-13 | 20일 | done→payment_waiting | checked_in | 0 | **a·완료수납누락?** |
| 19 | 총괄테스트2 | F-4755 | returning | 2026-07-14 | 19일 | done→payment_waiting | checked_in | 0 | **a·완료수납누락?** |
| 20 | 총괄테스트 | F-4714 | returning | 2026-07-16 | 17일 | treatment_waiting→payment_waiting | checked_in | 0 | **c·판단불가** |
| 21 | 르람 | F-4856 | new | 2026-07-17 | 16일 | preconditioning→payment_waiting | - | 0 | **a·완료수납누락?** |
| 22 | 김정숙 | F-4872 | returning | 2026-07-18 | 15일 | done→payment_waiting | checked_in | 0 | **a·완료수납누락?** |
| 23 | [4ZONE-LIVE-QA] | F-4888 | returning | 2026-07-19 | 14일 | - | - | 0 | **c·판단불가** |
| 24 | 강혁주 | F-4513 | returning | 2026-07-20 | 13일 | laser→payment_waiting | checked_in | 0 | **a·완료수납누락?** |
| 25 | 임수현 | F-4898 | new | 2026-07-20 | 13일 | laser→payment_waiting | checked_in | 0 | **a·완료수납누락?** |
| 26 | Marouane Kamal | F-4518 | returning | 2026-07-21 | 12일 | preconditioning→payment_waiting | checked_in | 0 | **a·완료수납누락?** |
| 27 | 서류테스트 | F-4990 | returning | 2026-07-25 | 8일 | treatment_waiting→payment_waiting | - | 0 | **c·판단불가** |
| 28 | 이영수 | F-4550 | returning | 2026-07-27 | 6일 | treatment_waiting→payment_waiting | - | 0 | **c·판단불가** |
| 29 | qa-consent-gate-1785330648613 | F-5332 | new | 2026-07-29 | 4일 | - | - | 0 | **c·판단불가** |
| 30 | 서류테스트 | F-4990 | returning | 2026-07-30 | 3일 | consultation→payment_waiting | - | 0 | **c·판단불가** |
| 31 | 서류테스트 | F-4990 | returning | 2026-07-30 | 3일 | receiving→payment_waiting | - | 0 | **c·판단불가** |

## 현장 확인 요청 (Phase2)
각 행에 대해 실제 처리 결과를 알려주세요:
- **완료** — 시술까지 끝났고 수납만 기록 누락된 건
- **미수** — 시술은 됐으나 실제 미수금(대기 정당)
- **취소/노쇼** — 방문이 취소·노쇼로 종료됐어야 하는 건
- **판단불가/기타** — 위로 분류 안 되는 건 (사유 메모)
