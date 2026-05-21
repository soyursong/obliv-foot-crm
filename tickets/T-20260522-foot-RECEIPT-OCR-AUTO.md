---
id: T-20260522-foot-RECEIPT-OCR-AUTO
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
created: 2026-05-22
deadline: 2026-05-28
assigned: dev-foot
---

# T-20260522-foot-RECEIPT-OCR-AUTO — 영수증 OCR 자동인식 Phase 2a

## 요약

POS 임시 대안. Phase 1 영수증 업로드(T-20260512-foot-OCR-RECEIPT) 위에 **OCR 자동인식 UI + 인터페이스 추상화 + DB 스키마** 선행 구현.
Phase 2b: OCR 서비스 확정 후 Edge Function 내부만 교체하면 전체 연동 완료.

## AC 체크리스트

- [x] AC-1: 영수증 촬영/업로드 후 OCR 자동인식 버튼 활성화 (기존 disabled → 활성)
- [x] AC-2: OCR 실행 시 로딩 인디케이터 + `Loader2` 스피너 + "인식 중…" 텍스트
- [x] AC-3: 인식 실패(confidence=0) 시 "자동 인식 실패" 메시지 + 수동입력 패널 자동 오픈
- [x] AC-4: 텍스트 붙여넣기 폴백 유지 (Phase 1 동작 보존)
- [x] AC-5: AbortController 10초 타임아웃 (타임아웃 시 "인식 시간 초과" + 수동 폴백)
- [x] AC-6: OCR 결과 DB 저장 (`receipt_ocr_results`) — 성공/실패 모두 저장, clinicId 없으면 스킵
- [x] AC-7: IOcrService 인터페이스 추상화 (`src/lib/ocr/types.ts`)
- [x] AC-8: SupabaseEdgeOcrService 구현 (`src/lib/ocr/SupabaseEdgeOcrService.ts`)
- [x] AC-9: receipt-ocr Edge Function stub (`supabase/functions/receipt-ocr/index.ts`)
- [x] AC-10: ReceiptExtracted 타입 확장 (paidAt, cardCompany, ocrRawText, ocrConfidence)
- [x] AC-11: Closing.tsx clinicId prop 전달

## 구현 파일

### 신규
- `src/lib/ocr/types.ts` — IOcrService + OcrResult 인터페이스
- `src/lib/ocr/SupabaseEdgeOcrService.ts` — Edge Function 래퍼
- `supabase/functions/receipt-ocr/index.ts` — OCR Edge Function (Phase 2a stub)
- `supabase/migrations/20260522030000_receipt_ocr_results.sql` — DB 테이블
- `supabase/migrations/20260522030000_receipt_ocr_results.down.sql` — 롤백
- `tests/e2e/T-20260522-foot-RECEIPT-OCR-AUTO.spec.ts` — E2E spec

### 수정
- `src/components/ReceiptUpload.tsx` — OCR 버튼 활성화, 로딩, 타임아웃, 프리필, DB 저장
- `src/pages/Closing.tsx` — `clinicId` prop 전달

## DB 변경

- 신규 테이블: `receipt_ocr_results` (13컬럼, RLS auth_all, 인덱스 2개)
- **적용 완료** (2026-05-22 `supabase db query --linked`)

## Phase 2b 전환 방법

1. `supabase/functions/receipt-ocr/index.ts`의 `processOcr()` 함수를 실제 OCR API 호출로 교체
2. Edge Secret 추가 (`OCR_PROVIDER`, `GOOGLE_VISION_KEY` 등)
3. 클라이언트 코드 변경 없음 (IOcrService 인터페이스 동일)

## 빌드

```
✓ built in 3.16s (에러 없음)
```

## 리스크

- **GO_WARN**: Phase 2a는 stub — 실제 OCR 미동작. 현장에서 텍스트 붙여넣기 폴백 안내 필요.
- Phase 2b 서비스(Google Vision / AWS / Clova) 비용 확정 전 대표 결정 필요.

## 관련 티켓

- 선행: T-20260512-foot-OCR-RECEIPT (Phase 1 영수증 업로드, commit 1776c5e)
- 연관: MSG-20260522-020956-9h6u (OCR 서비스 DECISION-REQUEST 대기 중)
