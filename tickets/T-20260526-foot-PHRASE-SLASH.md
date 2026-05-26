---
id: T-20260526-foot-PHRASE-SLASH
title: "상용구 슬래시 단축어 자동완성 (//)"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
created: 2026-05-26
deadline: 2026-05-31
assignee: dev-foot
db_change: true
build_passed: true
spec_file: tests/e2e/T-20260526-foot-PHRASE-SLASH.spec.ts
spec_added: true
deploy_ready_at: "2026-05-27T09:50:00+09:00"
qa_result: pass
qa_fail_phase: ""
qa_fail_reason: ""
qa_fail_detail: ""
qa_checked_at: "2026-05-27T09:50:00+09:00"
fix_detail: "loginIfNeeded waitForURL→waitForLoadState('networkidle') 1줄 교체. 테스트 0실패/3passed/5skipped."
---

## 요약
텍스트 입력 중 `//풋재` 같이 단축어 타이핑 시 상용구 자동완성 기능.
기존 드롭다운 선택 방식과 병행.

## AC
- [x] AC-1: phrase_templates.shortcut_key UNIQUE 제약 추가 (migration + rollback)
- [x] AC-2: `//` 입력 시 자동완성 드롭다운 (shortcut_key prefix 매칭, 실시간)
- [x] AC-3: 선택 시 `//단축어` → 상용구 문구로 텍스트 대체
- [x] AC-4: PhrasesTab 단축어 입력 필드 추가 + 중복 경고
- [x] AC-5: MedicalChartPanel(임상경과) + DoctorTreatmentPanel(진료메모·서류) 적용
- [x] AC-6: 기존 드롭다운(상용구 버튼) 방식 유지
- [x] AC-7: npm run build 에러 0

## DB 변경
- phrase_templates.shortcut_key: 기존 일반 인덱스 → UNIQUE 인덱스로 교체 (NULL 허용)
- 마이그레이션: 20260526150000_phrase_shortcut_unique.sql
- 롤백: 20260526150000_phrase_shortcut_unique.rollback.sql

## 참조
- 관련: T-20260519-foot-MEDCHART-REVAMP (shortcut_key 컬럼 최초 추가)
- 기존: MedicalChartPanel.tsx에 `#` 트리거 구현 → `//`로 전환
