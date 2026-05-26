---
id: T-20260526-foot-RX-PRINT-DUAL
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
commit: 2f1b378
db_migration: false
e2e_spec: false
created: 2026-05-26
deadline: 2026-05-30
author: dev-foot
---

# T-20260526-foot-RX-PRINT-DUAL — 처방전 출력 2장(약국보관용 + 환자보관용)

## 수용기준

- AC-1: 처방전 출력 시 2장 생성 (약국보관용 + 환자보관용) ✅
- AC-2: 각 장 상단 우측 구분 라벨 ("약국보관용" / "환자보관용") ✅
- AC-3: 서류출력 4개 경로 전부 동일 적용 ✅
  - 1번차트 탭 (DocumentPrintPanel 배치 출력 portraitHtmlTpls)
  - 2번차트 재발급 (DocumentPrintPanel.printJpg 단일 출력)
  - 미니 결제창 Zone 3 (PaymentMiniWindow.buildPages)
  - 기타 (PaymentMiniWindow.buildPages2 - 출력+수납)
- AC-4: 두 장 내용(처방 내역) 동일 ✅
- AC-5: 다른 서류(진료확인서, 영수증 등) 영향 없음 ✅

## 구현 내역

### 변경 파일
- `src/components/DocumentPrintPanel.tsx`
- `src/components/PaymentMiniWindow.tsx`

### 방식
- `buildHtmlPageHtml` / `buildHtmlPageDiv`에 optional `copyLabel?: string` 추가
- `copyLabel` 존재 시 우상단 구분 라벨 배지(absolute position) 렌더링
- rx_standard 경로에서 2장 flatMap 확장

### DB 변경
없음 (FE 전용)

## 빌드
`npm run build` — tsc -b + vite build ✓
