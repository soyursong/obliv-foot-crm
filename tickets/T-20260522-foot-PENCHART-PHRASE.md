---
id: T-20260522-foot-PENCHART-PHRASE
domain: foot
type: feature
priority: P2
status: deploy-ready
deploy-ready: true
deploy-ready-at: 2026-05-22T21:43:00+09:00
build: OK
db-change: false
e2e-spec: tests/e2e/T-20260522-foot-PENCHART-PHRASE.spec.ts
commit: 25e0867
created: 2026-05-22
deadline: 2026-06-05
assignee: dev-foot
spec-source: planner MQ MSG-20260522-214322-xq5v
---

# T-20260522-foot-PENCHART-PHRASE — 펜차트 상용구 불러오기 (phrase_templates 연동)

## 배경
- T-20260517-foot-PENCHART-FORM(closed)에서 "펜차트 상용구 불러오기" 스펙 있었으나
  상용구↔phrase_templates 연동 누락
- 2-3구역 상담탭은 C23-PHRASE-LINK로 phrase_templates 연동 완료(deployed). 펜차트 탭만 빠짐
- 현장: 진료 도구 > 상용구 30개 등록 (전체/차팅/처방/서류/일반)

## 수용기준
1. [펜차트] 탭에 "상용구 불러오기" 버튼 존재
2. phrase_templates 목록 표시 (카테고리별 필터, charting 우선)
3. 상용구 선택 → 펜차트 캔버스에 텍스트 삽입 (PENCHART-TOOLS-V2 boilerplate-placing 모드 활용)
4. 삽입 후 위치 조정 가능 (클릭 위치 지정)
5. 0건 빈 상태 메시지

## 구현 방식
- phrase_templates: SELECT id, category, name, content WHERE is_active=true ORDER BY sort_order
- draw 모드 진입 시 1회 fetch (phraseTemplatesLoaded guard)
- 카테고리 필터: charting(차팅) / prescription(처방) / document(서류) / general(일반)
- 선택 시 기존 handleBoilerplateSelect() 재사용 → boilerplate-placing 모드 활성화
- DB 스키마 변경 없음

## 리스크
GO (0/5)

## 변경 파일
- `src/components/PenChartTab.tsx`
- `tests/e2e/T-20260522-foot-PENCHART-PHRASE.spec.ts` (신규)
