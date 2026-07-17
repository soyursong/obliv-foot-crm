---
id: T-20260717-foot-RECEIPT-UPLOAD-TABLET-CAMERA-DLG-MISS
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: 0c924b63
deployed_at: 2026-07-17T13:38:33+09:00
bundle_hash: pending (CF Pages main-push 자동빌드 후 supervisor QA에서 확인)
db_change: false
summary: 2번 차트>상담내역>결제영수증 영수증 업로드 후 '영수증 매출 연동' 팝업이 태블릿 카메라 촬영 업로드 시 미표시(PC 정상) 해소. RC=가설A(카메라 앱 전환 컨텍스트 교란/리마운트). 재조회前 즉시오픈+sessionStorage 리마운트 복원+비차단 갱신. FE-only.
created: 2026-07-17
assignee: dev-foot
---

## 배경 (현상)

2번 차트 > 상담내역 > 결제영수증 > 영수증 업로드 후 "영수증 매출 연동" 팝업(금액/결제수단/귀속대상)이
**태블릿 카메라 촬영 업로드** 시 미표시. **PC 파일선택은 정상.** → 결제-매출 연동 누락 (P1, 김주연 총괄 현장).

- 코드 경로: `src/pages/CustomerChartPage.tsx` / `ReceiptUploadSection`
- 렌더: `handleUpload(async)` 말미 `setAmountDlg({open:true})`, `{amountDlg.open && <div className="fixed inset-0 z-50 …">}`

## 원인 좁힘 (계측 → 1개 확정, 산발 패치 금지)

| 가설 | 판정 | 근거 |
|------|------|------|
| B) fixed inset-0 렌더차단(상위 transform으로 fixed 기준이 viewport 대신 컨테이너) | **배제** | PC 파일선택은 **동일 DOM/CSS 경로**에서 정상 렌더 → 컨테이너 transform 원인 아님 |
| C) `e.target.files` 빈값(모바일 카메라 후 빈 FileList onChange) → early return | **원인서 배제** | 영수증 **업로드는 성공**(이미지 표시) → files 非빈. 단 AC3 안전처리는 유지 |
| **A) 카메라 앱 전환 시 JS 컨텍스트 교란/컴포넌트 리마운트** | **확정** | 업로드 성공 + PC 정상 + 팝업만 소실 = handleUpload 말미의 무거운 귀속후보 재조회(await 체인) 중단으로 `setAmountDlg` 미도달, 또는 리마운트로 `amountDlg`가 초기값 `{open:false}`로 리셋 — 유일하게 3사실 정합 |

## 타겟 픽스 (ReceiptUploadSection 국소)

1. **재조회前 즉시 오픈**: 업로드 성공 직후 `openAmountDialog()` — 무거운 귀속후보 재조회에 종속되지 않음.
2. **리마운트 복원(가설A 핵심)**: 오픈 의도를 `sessionStorage`(`receipt-amount-dlg-pending:<customerId>`)에
   `Date.now()` 스탬프 → 마운트 `useEffect([])`에서 **5분 내** 스탬프 존재 시 다이얼로그 재오픈, 만료 시 정리.
3. **비차단 갱신**: 귀속후보 최신화는 오픈 이후 `void loadActivePkgs().catch()/loadWaitingCIs().catch()` —
   실패/지연해도 팝업 유지. 인라인 중복 재조회 제거(정본 로더 재사용).
4. **종료 정리**: 등록/건너뛰기는 `closeAmountDlg()` 경유로 스탬프 제거(stale 재오픈 방지).
5. **field-soak 계측**: `[RECEIPT-DLG]` `console.debug`(upload:start / dialog:opened / dialog:restore-after-remount /
   upload:empty-filelist) — 갤탭 실기 원격 콘솔로 실패 지점 특정(旣 CAMERA-FOCUS/CAMERA-ZOOM 패턴 준용).

## AC

- **AC1** PC 파일선택 경로 회귀 없음 (`type="file" onChange={handleUpload}` · write-path `recordManualPayment` 불변).
- **AC2** 태블릿(모바일 뷰포트) 카메라 업로드 후 팝업 정상표시 + 팝업이 뷰포트 내부 렌더(off-screen 금지).
- **AC3** 빈 FileList/취소 안전처리(early return, 크래시·팝업 없음).
- **AC4** 저장 시 기존 매출연동 로직 유지(산식/write-path 변경 X — recordManualPayment 3분기 그대로).

## 검증

- 빌드: `npm run build` OK (tsc+vite).
- E2E: `tests/e2e/T-20260717-foot-RECEIPT-UPLOAD-TABLET-CAMERA-DLG-MISS.spec.ts` (unit 프로젝트, auth·server 불요) **13 PASS**
  - AC3 빈 FileList early return
  - AC2 오픈이 재조회보다 선행 / persist 스탬프 기록(uploadedOk 후) / 마운트 5분 복원 / 비차단 갱신 / 계측 로그
  - AC1·AC4 onChange=handleUpload / recordManualPayment 3분기·memo 불변 / closeAmountDlg 스탬프 정리(직접 close 잔존 0)
  - AC2 실DOM: fixed inset-0 오버레이가 PC/갤탭(세로·가로) 뷰포트 모두 중앙·내부 렌더(B 회귀가드)
  - AC2 로직: pending 스탬프 5분 윈도우 복원/만료 정리
- **db_change: false** (FE-only, 데이터 정책 자문 게이트 비대상 — 신규 컬럼·테이블·enum 없음).

## 잔여 (field-soak)

태블릿 실기(갤탭) 카메라 촬영 업로드 실재 재현은 field-soak에서 **김주연 총괄 육안 확인**.
확인 시 `[RECEIPT-DLG]` 로그로 `dialog:opened`(정상) 또는 `dialog:restore-after-remount`(리마운트 복원 발동) 관측 가능.
