---
id: T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG
domain: foot
status: deploy-ready
priority: P1
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG.spec.ts
created: 2026-06-05
commit: 4b0d568
---

# T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG — 진료차트 상용구/슈퍼상용구 불러오기 회귀 수정

## 증상
진료차트 > 우측 패널 슈퍼상용구/상용구에서 기등록 상용구 불러오기(로딩) 안 됨(미표시).
보고: 문지은 대표원장. 항상 재현.

## 근본 원인 (prod 실측 확정 — node-pg 직접 조회 2026-06-05)
1. **super_phrases**: 테이블 존재 + RLS staff_read(USING true)/admin_write 정상 + rows=0.
   마이그 갭은 이미 해소(`apply_20260603060000_super_phrases_pg.mjs`). 0건은 정당한 빈 상태.
   ⇒ **cda2c8d(RX-SUPER-PHRASE) 자체 회귀 아님** (AC-3 명시).
2. **진짜 회귀**: `MedicalChartPanel.loadData` 가 `phrase_templates` 를
   `.eq('phrase_type','medical_chart')` 단일 필터(T-20260526 MEDCHART-SYNC)로 조회.
   prod = pen_chart 33 + medical_chart 1 → 의사가 등록한 상용구 대부분(pen 33)이
   진료차트 '상용구' 탭에 미노출 → "불러오기 안됨/미표시".
   6/5 SUPER-PHRASE-LOAD-FIX(SuperPhrasesTab)와 동일 루트코즈이나 본 진료차트 패널엔 미전파였음.

## 수정 (AC)
- **AC-1 로딩정상**: loadData phrase_templates 필터완화(is_active 전체, 유형 무관) + phrase_type 보존
  (유형 배지 진료차트/펜차트) + 진료차트 우선 안정정렬.
- **AC-2 빈 vs 에러 구분**: `phraseLoadError`/`superLoadError` 추가 — Promise.all 이 swallow 하던
  supabase error 추적 → "불러오지 못했습니다"(에러) ≠ "없음"(0건) 분리 표기.
- **AC-3 cda2c8d 회귀 여부**: 회귀 아님(super_phrases 정상·0건). 진짜 원인은 MEDCHART-SYNC phrase 필터.
- **AC-4 GUARD**: insertPhrase/insertSelectedPhrases/applySuperPhrase null·빈 내용 안전 종료/경고.

## 검증
- E2E `tests/e2e/T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG.spec.ts` 12 pass (로딩정상/빈vs에러/GUARD).
- 인접 회귀 51 pass (MEDCHART-SYNC, RX-SUPER-PHRASE, SUPER-PHRASE-LOAD-FIX, SUPERPHRASE-EXT).
- build ✓. DB변경 없음. commit 4b0d568.
