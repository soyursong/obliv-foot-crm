---
id: T-20260524-foot-PKG-LABEL-AMOUNT
domain: foot
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
spec-added: false
commit: 3da68bc
---

# T-20260524-foot-PKG-LABEL-AMOUNT — 결제수단 "멤버십" → "패키지" 라벨 통일 + 차감 금액 연동

## 구현 요약

### AC-1 (FE 라벨) ✅
- PaymentMiniWindow / PaymentDialog / PaymentEditDialog 3개 컴포넌트 METHOD_OPTIONS
- 이미 T-20260522-foot-PAY-DROPDOWN-LONGRE에서 `membership: '패키지'`로 완료 확인

### AC-2 (금액 연동) ✅ — PaymentDialog 단건 모드
- `customerPackage` state 추가 (package_name / total_amount / total_sessions)
- `useEffect([checkIn?.id])`: packages 테이블에서 customer_id+clinic_id 기준 활성 패키지 조회
- 결제수단 '패키지' 클릭 시 `Math.round(total_amount / total_sessions)` auto-fill
- 패키지 이름·총액·회차 안내 패널 표시 (수동 수정 허용)
- 패키지 미보유 시 빈 상태 + 안내 문구
- 기존 template picker (T-20260522-AC-7 단건+membership 흐름) 제거 → 패키지 구매는 '패키지 결제' 모드로 명확화

### AC-3 (기존 호환) ✅
- `src/lib/status.ts` METHOD_KO: `membership: '멤버십'` → `'패키지'`
  → DailyHistory.tsx 자동 픽업
- `CheckInDetailSheet.tsx` 로컬 METHOD_LABEL: `'멤버십'` → `'패키지'`
- `PaymentEditDialog.tsx` 현재 수납정보 표시: raw `payment.method` → METHOD_OPTIONS label lookup
- `CustomerChartPage.tsx` 결제이력 4개소: `{p.method}` / `{r.method}` → `METHOD_KO[...] ?? raw`
  + METHOD_KO import 추가

## 변경 파일
- `src/lib/status.ts`
- `src/components/CheckInDetailSheet.tsx`
- `src/components/PaymentDialog.tsx`
- `src/components/PaymentEditDialog.tsx`
- `src/pages/CustomerChartPage.tsx`

## DB 변경: 없음
## 빌드: ✓ tsc+vite clean
