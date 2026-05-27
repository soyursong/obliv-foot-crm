# iPad Safari 펜차트 진단 가이드 (AC-R4-1/AC-R4-2)

**대상 버그**: T-20260525-foot-PENCHART-FORM-BLACKSCR  
**최신 픽스 커밋**: cf69be5 (desynchronized:true 제거)  
**라이브 URL**: https://obliv-foot-crm.vercel.app

---

## 현장 테스트 절차 (iPad Safari)

### 1단계: Safari Web Inspector 연결 (Mac + iPad)
1. iPad → 설정 → Safari → 고급 → **웹 인스펙터 ON**
2. USB로 iPad를 Mac에 연결
3. Mac Safari → 개발자 메뉴(없으면 Safari 환경설정 → 고급 → 메뉴 막대에 개발자 메뉴 표시)
4. 개발자 메뉴 → [iPad 이름] → obliv-foot-crm.vercel.app

### 2단계: 테스트 실행
1. iPad Safari → https://obliv-foot-crm.vercel.app 접속
2. 로그인 → 고객 선택 → 2번차트 → 펜차트 탭
3. 양식 목록에서 **"[보험차트]" 또는 "발건강 질문지(일반)"** 클릭
4. 화면 렌더링 확인 (정상 흰 바탕 vs 검정)

### 3단계: Console 로그 캡처
양식 오픈 시 자동으로 다음 진단 로그가 출력됩니다:
```
[DIAG-R4-3] drawCanvas pixel alpha = 0 (OK: 투명)    ← 정상
[DIAG-R4-3] drawCanvas pixel alpha = 255 (BUG: opaque ← 버그)
[DIAG-R4-4] CSS stacking context ancestors: ...
[DIAG-R4-5] bgCanvas CORS taint: false (OK)
```

Mac Safari Web Inspector → Console 탭 전체 스크린샷 캡처.

### 4단계: 스크린샷 저장 경로
캡처한 스크린샷을 아래 경로에 저장:
```
~/claude-sync/memory/_handoff/qa_screenshots/
파일명: ipad_penchart_{날짜}_{정상OK|검정BUG}.png
```

---

## 추가 테스트: ?penchart_enable_desync URL 파라미터
- 기본값: desynchronized=false (cf69be5 이후)
- 비교 테스트 시: URL에 `?penchart_enable_desync` 추가
  → desynchronized=true 강제 → 구 버그 재현 가능

---

## 진단 요약 체크리스트
- [ ] iPad Safari에서 양식 정상 렌더링 확인
- [ ] Console: `[DIAG-R4-3] alpha = 0 (OK)` 확인
- [ ] Console: `[DIAG-R4-5] CORS taint: false` 확인
- [ ] 스크린샷 `qa_screenshots/` 저장
- [ ] 결과를 responder에게 공유 → deploy-ready 최종 마킹

---

## Supervisor 빌드 검증 경로
```
레포: /Users/domas/Documents/GitHub/obliv-foot-crm/
명령: npm run build
E2E:  npx playwright test tests/e2e/T-20260525-foot-PENCHART-FORM-BLACK.spec.ts
```
> **주의**: `/Users/domas/claude-sync/memory`는 SSOT 문서 저장소이며 레포가 아님.
