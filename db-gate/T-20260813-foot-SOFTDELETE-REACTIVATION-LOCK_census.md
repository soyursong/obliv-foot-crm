# T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK — Leg1 삭제가능 객체 census

- 도메인: foot (obliv-foot-crm)
- 성격: **READ-ONLY census · DB write 0 · prod 무접촉** (Leg2 구현은 supervisor DDL-diff + 물리 GO-token 후)
- 설계 SSOT: DA-20260813-meta-SOFTDELETE-ARCHIVEFIRST-REACTIVATION-LOCK (CONDITIONAL-GO)
- census method: `src/**` supabase `.from('X').delete()` 콜사이트 grep + 삭제 UI surface 열거 + 기존 canonical flag 대조(mirror-not-invent)
- 작성: dev-foot 2026-08-13

---

## ★ 핵심 발견 (planner/DA 회신 요망 논점 2건)

### 발견 1 — 기존 canonical soft-delete flag 이 **혼재**(DA §2-1 단일-boolean 요구와 긴장)
foot 는 이미 배포된 soft-delete 관례가 **2종 병존**:
- **`deleted_at IS NULL` 술어 (지배적·이미 라이브)**: `check_ins`(Assignments R2B soft-hide·다수 집계 필터), `customer_treatment_memos`/치료메모(CustomerChartPage T-20260624), `treatment_photos`(useTreatmentPhotos 의료법 §22), sms 수신거부(AdminSettings `deleted_at`+`deleted_by` 마킹).
- **`is_deleted=false` 술어**: `insurance_receipts`/출력물(CustomerChartPage:3345·3439·3573), KOH 발급결과(KohPublishedResults:42).

DA §2-1 은 신규 canonical = **`is_deleted BOOLEAN NOT NULL DEFAULT false` 단일-boolean 술어**(`deleted_at IS NULL` 술어 **금지**)로 못박음. 그러나 foot 지배 패턴은 `deleted_at IS NULL`.
→ **회신 요망**: 이미 라이브된 `deleted_at IS NULL` 술어 객체(check_ins 등)를 (a) `is_deleted` 단일-boolean 으로 마이그레이션(술어 전환·partial-index parity 재작성 리스크) 할지, (b) 기존 라이브 객체는 `deleted_at IS NULL` 유지하고 신규 대상만 `is_deleted` canonical 적용(dual-predicate 인정) 할지. **mirror-not-invent 원칙상 (b) 우세**로 판단하나 DA 확정 필요. is_deleted 를 신규 발명하기보다 기존 flag 재사용이 원칙.

### 발견 2 — `.delete()` 콜사이트 다수가 **lifecycle 삭제가 아님**(replace/junction/compensation) → soft-delete scope 제외 필수
전체 앱-런타임 `.delete()` 콜사이트 중 상당수가 **junction/detail replace-sync**(저장 시 자식행 delete→re-insert) 또는 **compensation rollback**(생성 실패건 정리). 이들을 soft-delete UPDATE 로 치환하면 replace-sync 가 깨짐. → CLASS C 로 분리, soft-delete 대상에서 **제외**.

---

## Tier 분류표 (DA §1 rubric)

### CLASS A — Tier-0 (fail-closed·물리삭제 차단·view-hide만·기록주체+다원장 앵커/append-only ledger)

| 객체 | 콜사이트 | 삭제 surface 성격 | 현재 flag | 조치 |
|------|----------|------------------|-----------|------|
| `customers` | Customers.tsx:491 | '고객 삭제'(이미 **empty-only fail-closed**: check_in/package 0건 + PHI FK RESTRICT 23503 차단) | `is_simulation` view-hide 존재 | 물리삭제 차단 **유지**, is_deleted view-hide 확장(선택). 사실상 이미 Tier-0 준수 |
| `payments` | (앱 `.delete()` **0건**) | append-only 준수 | — | 참고: 콜사이트 없음(양호) |
| `service_charges` | DocumentPrintPanel.tsx:3161 | 명세(claim·급여) 라인 삭제 | 없음 | **Tier-0 후보(재무 SSOT·매출 split)** → DA 판정 요망. 확정전 soft-delete 미착수 |
| `insurance_receipts` | DocumentPrintPanel.tsx:1055 | 발급 영수증 삭제 | `is_deleted` 패턴 인접(출력물군) | Tier-0/1 경계(발급문서 보존) → is_deleted 재사용 candidate |
| `patient_file_records` | BloodResultDialog.tsx:201, PatientResultFiles.tsx:231 | PHI 검사결과 파일 삭제 | 없음 | **의료법 §22 보존** → Tier-0 lean(soft-delete 필수·물리삭제 금지) |
| `chart_diagnoses` | MedicalChartPanel.tsx:1676 | 차트 저장 시 replace(진단 재기록) | 없음 | replace-sync → **CLASS C**(단 PHI 이므로 물리삭제 자체는 트랜잭션내 replace 로 유지 여부 DA 확인) |

### CLASS B — Tier-1 (soft-delete lifecycle 대상·canonical envelope 적용)

| 객체 | 콜사이트 | 현재 flag | 비고 |
|------|----------|-----------|------|
| `reservations` | Reservations.tsx:2136, ReservationDetailPopup.tsx:1142 | **없음**(코드 주석 "hard-delete, deleted_at 컬럼 없음" 명시) | canonical envelope 신규 필요. 단 restore≠cancel 방화벽(§4) — is_cancelled 축과 분리 |
| `check_ins` | CheckInDetailSheet.tsx:1102 | **`deleted_at IS NULL` 이미 라이브(R2B soft-hide)** | 발견1 대상. 이미 soft-hide 술어 존재 → 신규 is_deleted 강제 시 술어 전환 리스크 |
| `notices` | Notices.tsx:172, CalendarNoticePanel.tsx:332 | 없음 | 공지 |
| `clinic_events` | ClinicCalendar.tsx:234 | 없음 | 일정 |
| `rooms` | Staff.tsx:884, Dashboard.tsx:6213 | 없음 | config master |
| `services` | Services.tsx:515, DiagnosisNamesTab.tsx:220 | 없음 | 시술/진단명 master |
| `handover_notes` | Handover.tsx:432 | 없음 | 인수인계 |
| `closing_manual_payments` | Closing.tsx:1727 | 없음 | 마감 수기조정(money 인접·주의) |
| `notices`(config군), `phrase_templates`(PhrasesTab:216), `super_phrases`(SuperPhrasesTab:138), `document_templates`(DocumentTemplatesTab:130), `treatment_sets`(TreatmentSetsTab:269), `prescription_sets`(PrescriptionSetsTab:262), `diagnosis_sets`(DiagnosisSetsTab:259), `fee_set_templates`(FeeSetTemplatesTab:137), `quick_rx_buttons`(QuickRxButtonsTab:198), `prescription_contraindications`(ContraindicationsTab:155), `package_progress_plans`(ProgressPlansTab:260), `duty_roster`(DutyRosterTab:169·229), `prescription_folders`(drugFolders:190), `prescription_code_folders`(drugFolders:227), `diagnosis_folders`(diagnosisFolders:146) | 각 admin 설정 CRUD | 없음 | config/master CRUD — Tier-1 soft-delete 또는 view-hide. UI '삭제' 버튼 보유 |
| `reservation_memo_history` | ReservationMemoTimeline.tsx:307 | (타 memo 는 deleted_at 사용) | 예약 메모 삭제 — Tier-1 후보(치료메모 선례 준용) |
| `chart_treatment_requests` | TreatmentRequestBox.tsx:143 | 없음 | 임상 요청(replace 여부 확인 요) |

### CLASS C — replace/junction/compensation (NOT lifecycle·soft-delete **제외**)

| 객체 | 콜사이트 | 제외 사유 |
|------|----------|-----------|
| `check_in_services` | PaymentMiniWindow.tsx:2372·2937 | 결제 편집 시 서비스라인 replace(delete→re-insert) |
| `diagnosis_set_items` | DiagnosisSetsTab.tsx:237 | set 멤버십 replace |
| `treatment_set_items` | TreatmentSetsTab.tsx:228 | set 멤버십 replace |
| `handover_checklist_items` | Handover.tsx:397 | 저장 시 항목 replace |
| `staff_capabilities`(capability_code) | Assignments.tsx:3459 | 역량 토글 off |
| `doctor_diagnosis_favorites` | DiagnosisFolderPicker.tsx:367 | 즐겨찾기 토글 |
| `assignment_leadsource_policy` | AssignmentSettingsTab.tsx:226 | 정책 replace(.in 다건) |
| `daily_room_status` | Staff.tsx:960 | 당일 상태 토글(ephemeral) |
| `reservation_registrars` | ReservationRegistrarTab.tsx:172 | 등록자 replace |
| `user_dashboard_layout_overrides` | Dashboard.tsx:3966 | 개인 레이아웃 리셋(pref) |
| `staff_temp_off` | autoAssign.ts:361 | 임시 휴무 토글 |
| `packages` | packageCreditLedger.ts:271 | **compensation rollback**(방금 생성한 패키지 정리·결제/세션 無) |
| `chart_diagnoses` | MedicalChartPanel.tsx:1676 | 차트 저장 replace(PHI — CLASS A 각주 참조) |

### 참고 — Tier-2 (archive-first·remediation-only·CEO+법무 게이트)
앱 런타임 코드 아님. `scripts/*`·`rollback/*`·`db-gate/*`·`migration_packages/*` 의 `DELETE FROM`(더미/테스트 데이터 cleanup·orphan 정리·마이그 원장 정정)이 이 레인. 본 census(앱 삭제 surface) scope 밖 — 기존 orphan_archive_fk_guard_sop 소관.

---

## AC 대응 (Leg1)
- [x] census 표(객체×tier×canonical flag 유무·hard-DELETE 콜사이트 목록) — 본 문서
- [x] staff 특례 확인: 오프보딩 = 비활성(is_active/approved) ≠ 삭제. 앱 `.from('staff').delete()` 콜사이트 **0건**(양호·record 삭제 surface 없음). is_deleted ⊥ is_active 병존 원칙 정합.
- [ ] Leg2 구현 = planner 회신(발견1 술어 정합 + 발견2 CLASS C 제외 확정 + CLASS A service_charges Tier DA 판정) 후 착수. supervisor DDL-diff + 물리 GO-token 선행(apply_before_go 금지).

## planner 회신 요청 사항 (구현 scope 확정 게이트)
1. **발견1**: 기존 라이브 `deleted_at IS NULL` 객체(check_ins 등)를 is_deleted 단일-boolean 으로 전환 vs dual-predicate 인정(신규만 is_deleted). → DA 정합 판정.
2. **발견2**: CLASS C(replace/junction/compensation) soft-delete 제외 확정.
3. **CLASS A** `service_charges`(재무 SSOT)·`insurance_receipts`(발급문서)·`patient_file_records`(PHI) Tier 확정 — DA 판정.
4. Leg2 canonical envelope 적용 대상 = 확정된 CLASS B(+A view-hide) 목록.
