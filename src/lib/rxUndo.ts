// rxUndo — 빠른처방 되돌리기(undo) 스냅샷 캡처/복원 헬퍼
// T-20260609-foot-QUICKRX-INCLINIC-GATE (AC5~6)
//
// 빠른처방은 check_ins 의 4개 필드를 "덮어쓴다"(append 아님):
//   prescription_items / prescription_status / doctor_confirm_prescription / doctor_confirmed_at
// 따라서 별도 이력 테이블·소프트삭제 컬럼 없이도, 적용 직전 4개 필드 스냅샷만 보존하면
// 그대로 write-back 하여 완전 원복할 수 있다(무스키마 — DB 변경 없음).
//
// 불변식:
//   - 덮어쓰기(overwrite)이므로 이중적용 없음(같은 행 update, INSERT 없음 → 유령행 없음).
//   - buildUndoPatch(captureRxSnapshot(row)) 의 4개 필드 = 적용 전 row 의 4개 필드(idempotent).

/** 빠른처방 상태를 결정하는 check_ins 4개 필드 */
export interface RxSnapshot {
  prescription_items: unknown;
  prescription_status: string;
  doctor_confirm_prescription: boolean;
  doctor_confirmed_at: string | null;
}

export interface RxRowLike {
  prescription_items?: unknown;
  prescription_status?: string | null;
  doctor_confirm_prescription?: boolean | null;
  doctor_confirmed_at?: string | null;
}

/** 적용 전 row → 되돌리기 스냅샷(4개 필드 정규화) */
export function captureRxSnapshot(row: RxRowLike | null | undefined): RxSnapshot {
  return {
    prescription_items: row?.prescription_items ?? null,
    prescription_status: row?.prescription_status ?? 'none',
    doctor_confirm_prescription: Boolean(row?.doctor_confirm_prescription),
    doctor_confirmed_at: row?.doctor_confirmed_at ?? null,
  };
}

/** 스냅샷 → check_ins update 패치(원복용) */
export function buildUndoPatch(snapshot: RxSnapshot): RxSnapshot {
  return {
    prescription_items: snapshot.prescription_items,
    prescription_status: snapshot.prescription_status,
    doctor_confirm_prescription: snapshot.doctor_confirm_prescription,
    doctor_confirmed_at: snapshot.doctor_confirmed_at,
  };
}
