/**
 * ClinicSettings — 병원·원장 정보 설정 페이지
 *
 * T-20260516-foot-CLINIC-DOC-INFO
 * AC-2: /admin/clinic-settings
 *   - 섹션 A: 병원 기본정보 (병원명/주소/전화/사업자등록번호/개설일)
 *   - 섹션 B: 원장(의사) 정보 CRUD + 직인 이미지 업로드
 *   - 다중 의사 등록 지원 (is_default 기본 의사 지정)
 */

import { useEffect, useRef, useState } from 'react';
import { Building2, Stethoscope, Plus, Trash2, Upload, Star, StarOff, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';

// ── 타입 ──

interface ClinicDoctor {
  id: string;
  clinic_id: string;
  name: string;
  license_no: string | null;
  specialist_no: string | null;
  seal_image_url: string | null;
  is_default: boolean;
  sort_order: number;
  active: boolean;
}

interface DoctorForm {
  id: string | null;        // null = 신규
  name: string;
  license_no: string;
  specialist_no: string;
  seal_image_url: string | null;
  is_default: boolean;
  _sealFile?: File | null;  // 업로드 대기 파일
  _sealPreview?: string | null; // 미리보기 URL
}

function emptyDoctorForm(): DoctorForm {
  return {
    id: null,
    name: '',
    license_no: '',
    specialist_no: '',
    seal_image_url: null,
    is_default: false,
    _sealFile: null,
    _sealPreview: null,
  };
}

// ── 메인 컴포넌트 ──

export default function ClinicSettings() {
  const clinic = useClinic();
  const { profile } = useAuth();

  // 섹션 A — 병원 기본정보
  const [clinicForm, setClinicForm] = useState({
    name: '',
    address: '',
    phone: '',
    business_no: '',
    established_date: '',
  });
  const [clinicSaving, setClinicSaving] = useState(false);

  // 섹션 B — 의사 목록
  const [doctors, setDoctors] = useState<ClinicDoctor[]>([]);
  const [doctorForms, setDoctorForms] = useState<DoctorForm[]>([]);
  const [doctorSaving, setDoctorSaving] = useState<Record<string, boolean>>({});
  const [addingDoctor, setAddingDoctor] = useState(false);
  const [newDoctorForm, setNewDoctorForm] = useState<DoctorForm>(emptyDoctorForm());

  const sealFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const newSealFileInputRef = useRef<HTMLInputElement | null>(null);

  // 권한 체크
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager';

  // ── 데이터 로드 ──
  const loadData = async () => {
    if (!clinic?.id) return;

    const [{ data: clinicData }, { data: doctorData }] = await Promise.all([
      supabase
        .from('clinics')
        .select('id, name, address, phone, business_no, established_date')
        .eq('id', clinic.id)
        .maybeSingle(),
      supabase
        .from('clinic_doctors')
        .select('*')
        .eq('clinic_id', clinic.id)
        .eq('active', true)
        .order('sort_order')
        .order('created_at'),
    ]);

    if (clinicData) {
      setClinicForm({
        name: clinicData.name ?? '',
        address: clinicData.address ?? '',
        phone: clinicData.phone ?? '',
        business_no: clinicData.business_no ?? '',
        established_date: clinicData.established_date ?? '',
      });
    }

    if (doctorData) {
      setDoctors(doctorData as ClinicDoctor[]);
      setDoctorForms(
        (doctorData as ClinicDoctor[]).map((d) => ({
          id: d.id,
          name: d.name,
          license_no: d.license_no ?? '',
          specialist_no: d.specialist_no ?? '',
          seal_image_url: d.seal_image_url ?? null,
          is_default: d.is_default,
          _sealFile: null,
          _sealPreview: null,
        })),
      );
    }
  };

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  // ── 직인 이미지 업로드 헬퍼 ──
  const uploadSealImage = async (
    file: File,
    clinicId: string,
    doctorIdOrTemp: string,
  ): Promise<string | null> => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
    const path = `seals/${clinicId}/${doctorIdOrTemp}.${ext}`;
    const { error } = await supabase.storage.from('documents').upload(path, file, {
      upsert: true,
      contentType: file.type || 'image/png',
    });
    if (error) {
      toast.error(`직인 이미지 업로드 실패: ${error.message}`);
      return null;
    }
    return path;
  };

  // ── 섹션 A 저장 ──
  const handleSaveClinic = async () => {
    if (!clinic?.id || !canEdit) return;
    setClinicSaving(true);
    try {
      const { error } = await supabase
        .from('clinics')
        .update({
          name: clinicForm.name.trim() || undefined,
          address: clinicForm.address.trim() || null,
          phone: clinicForm.phone.trim() || null,
          business_no: clinicForm.business_no.trim() || null,
          established_date: clinicForm.established_date || null,
        })
        .eq('id', clinic.id);

      if (error) {
        toast.error(`저장 실패: ${error.message}`);
        return;
      }
      toast.success('병원 기본정보가 저장되었습니다');
      await loadData();
    } finally {
      setClinicSaving(false);
    }
  };

  // ── 의사 정보 저장 (기존) ──
  const handleSaveDoctor = async (form: DoctorForm, idx: number) => {
    if (!clinic?.id || !canEdit || !form.id) return;
    const key = form.id;
    setDoctorSaving((prev) => ({ ...prev, [key]: true }));
    try {
      let sealUrl = form.seal_image_url;

      // 직인 이미지 새로 선택된 경우
      if (form._sealFile) {
        sealUrl = await uploadSealImage(form._sealFile, clinic.id, form.id);
        if (!sealUrl) return;
      }

      // is_default가 true이면 다른 의사들의 is_default를 false로
      if (form.is_default) {
        await supabase
          .from('clinic_doctors')
          .update({ is_default: false })
          .eq('clinic_id', clinic.id)
          .neq('id', form.id);
      }

      const { error } = await supabase
        .from('clinic_doctors')
        .update({
          name: form.name.trim(),
          license_no: form.license_no.trim() || null,
          specialist_no: form.specialist_no.trim() || null,
          seal_image_url: sealUrl,
          is_default: form.is_default,
          sort_order: idx,
        })
        .eq('id', form.id);

      if (error) {
        toast.error(`저장 실패: ${error.message}`);
        return;
      }
      toast.success(`${form.name} 원장님 정보가 저장되었습니다`);
      await loadData();
    } finally {
      setDoctorSaving((prev) => ({ ...prev, [key]: false }));
    }
  };

  // ── 의사 삭제 (soft delete) ──
  const handleDeleteDoctor = async (doctorId: string, name: string) => {
    if (!canEdit) return;
    if (!window.confirm(`${name} 원장님 정보를 삭제하시겠습니까?`)) return;
    const { error } = await supabase
      .from('clinic_doctors')
      .update({ active: false })
      .eq('id', doctorId);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success(`${name} 원장님 정보가 삭제되었습니다`);
    await loadData();
  };

  // ── 의사 추가 (신규) ──
  const handleAddDoctor = async () => {
    if (!clinic?.id || !canEdit) return;
    if (!newDoctorForm.name.trim()) { toast.error('성명을 입력해주세요'); return; }
    setAddingDoctor(true);
    try {
      // 신규 ID 미리 생성 (직인 이미지 경로용)
      const tempId = crypto.randomUUID();
      let sealUrl: string | null = null;

      if (newDoctorForm._sealFile) {
        sealUrl = await uploadSealImage(newDoctorForm._sealFile, clinic.id, tempId);
        if (!sealUrl) return;
      }

      // 이 의사가 기본이면 기존 기본 해제
      if (newDoctorForm.is_default) {
        await supabase
          .from('clinic_doctors')
          .update({ is_default: false })
          .eq('clinic_id', clinic.id);
      }

      const { error } = await supabase.from('clinic_doctors').insert({
        id: tempId,
        clinic_id: clinic.id,
        name: newDoctorForm.name.trim(),
        license_no: newDoctorForm.license_no.trim() || null,
        specialist_no: newDoctorForm.specialist_no.trim() || null,
        seal_image_url: sealUrl,
        is_default: newDoctorForm.is_default,
        sort_order: doctors.length,
        active: true,
      });

      if (error) { toast.error(`추가 실패: ${error.message}`); return; }
      toast.success(`${newDoctorForm.name} 원장님 정보가 추가되었습니다`);
      setNewDoctorForm(emptyDoctorForm());
      setAddingDoctor(false);
      await loadData();
    } finally {
      setAddingDoctor(false);
    }
  };

  // ── 직인 서명 URL 생성 ──
  const getSealSignedUrl = async (path: string): Promise<string | null> => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  };

  // ── 직인 이미지 미리보기 ──
  const handleSealFileChange = async (
    file: File,
    isNew: boolean,
    idx?: number,
  ) => {
    const preview = URL.createObjectURL(file);
    if (isNew) {
      setNewDoctorForm((prev) => ({ ...prev, _sealFile: file, _sealPreview: preview }));
    } else if (idx !== undefined) {
      setDoctorForms((prev) =>
        prev.map((f, i) => (i === idx ? { ...f, _sealFile: file, _sealPreview: preview } : f)),
      );
    }
  };

  if (!clinic) {
    return <div className="p-6 text-sm text-muted-foreground">클리닉 정보를 불러오는 중…</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 space-y-6 max-w-2xl">
      <h1 className="text-lg font-bold flex items-center gap-2">
        <Building2 className="h-5 w-5 text-teal-600" />
        병원·원장 정보 설정
      </h1>

      {/* ── 섹션 A: 병원 기본정보 ── */}
      <section className="rounded-lg border bg-card p-4 space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
          <Building2 className="h-4 w-4" /> 병원 기본정보
        </h2>

        <div className="grid grid-cols-1 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">병원명</Label>
            <Input
              value={clinicForm.name}
              onChange={(e) => setClinicForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="오블리브 종로점"
              disabled={!canEdit}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">주소</Label>
            <Input
              value={clinicForm.address}
              onChange={(e) => setClinicForm((p) => ({ ...p, address: e.target.value }))}
              placeholder="서울시 종로구 관철동..."
              disabled={!canEdit}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">전화번호</Label>
              <Input
                value={clinicForm.phone}
                onChange={(e) => setClinicForm((p) => ({ ...p, phone: e.target.value }))}
                placeholder="02-1234-5678"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">사업자등록번호</Label>
              <Input
                value={clinicForm.business_no}
                onChange={(e) => setClinicForm((p) => ({ ...p, business_no: e.target.value }))}
                placeholder="123-45-67890"
                disabled={!canEdit}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">개설일</Label>
            <Input
              type="date"
              value={clinicForm.established_date}
              onChange={(e) => setClinicForm((p) => ({ ...p, established_date: e.target.value }))}
              disabled={!canEdit}
            />
          </div>
        </div>

        {canEdit && (
          <Button
            onClick={handleSaveClinic}
            disabled={clinicSaving}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white"
            size="sm"
          >
            {clinicSaving ? '저장 중…' : '병원정보 저장'}
          </Button>
        )}
      </section>

      {/* ── 섹션 B: 원장(의사) 정보 ── */}
      <section className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
            <Stethoscope className="h-4 w-4" /> 원장(의사) 정보
          </h2>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-8"
              onClick={() => setAddingDoctor(true)}
            >
              <Plus className="h-3.5 w-3.5" /> 의사 추가
            </Button>
          )}
        </div>

        {/* 신규 의사 추가 폼 */}
        {addingDoctor && (
          <div className="rounded-md border border-dashed border-teal-400 bg-teal-50/40 p-4 space-y-3">
            <div className="text-xs font-semibold text-teal-700 mb-1">새 의사 정보 입력</div>
            <DoctorFormFields
              form={newDoctorForm}
              onChange={(patch) => setNewDoctorForm((prev) => ({ ...prev, ...patch }))}
              onSealFileChange={(file) => handleSealFileChange(file, true)}
              fileInputRef={(el) => { newSealFileInputRef.current = el; }}
              onSignedUrl={getSealSignedUrl}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleAddDoctor}
                disabled={addingDoctor && !newDoctorForm.name.trim()}
                className="bg-teal-600 hover:bg-teal-700 text-white"
              >
                추가
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setAddingDoctor(false); setNewDoctorForm(emptyDoctorForm()); }}
              >
                취소
              </Button>
            </div>
          </div>
        )}

        {/* 등록된 의사 목록 */}
        {doctorForms.length === 0 && !addingDoctor && (
          <p className="text-xs text-muted-foreground text-center py-4">
            등록된 의사 정보가 없습니다. [의사 추가]를 눌러 등록하세요.
          </p>
        )}

        <div className="space-y-4">
          {doctorForms.map((form, idx) => (
            <div key={form.id ?? idx} className="rounded-md border bg-background p-4 space-y-3">
              {/* 헤더 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{doctors[idx]?.name || form.name || '—'}</span>
                  {form.is_default && (
                    <span className="text-[10px] rounded-full bg-teal-100 text-teal-700 px-2 py-0 font-medium">
                      기본 의사
                    </span>
                  )}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    {/* 기본 의사 토글 */}
                    <button
                      title={form.is_default ? '기본 의사 해제' : '기본 의사로 지정'}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-amber-500 transition"
                      onClick={() =>
                        setDoctorForms((prev) =>
                          prev.map((f, i) =>
                            i === idx ? { ...f, is_default: !f.is_default } : f,
                          ),
                        )
                      }
                    >
                      {form.is_default
                        ? <Star className="h-4 w-4 text-amber-500" />
                        : <StarOff className="h-4 w-4" />}
                    </button>
                    {/* 순서 위/아래 */}
                    <button
                      title="위로"
                      disabled={idx === 0}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground disabled:opacity-30 transition"
                      onClick={() => {
                        if (idx === 0) return;
                        setDoctorForms((prev) => {
                          const next = [...prev];
                          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                          return next;
                        });
                      }}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      title="아래로"
                      disabled={idx === doctorForms.length - 1}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground disabled:opacity-30 transition"
                      onClick={() => {
                        if (idx === doctorForms.length - 1) return;
                        setDoctorForms((prev) => {
                          const next = [...prev];
                          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                          return next;
                        });
                      }}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {/* 삭제 */}
                    <button
                      title="삭제"
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-red-500 transition"
                      onClick={() => form.id && handleDeleteDoctor(form.id, form.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              <DoctorFormFields
                form={form}
                onChange={(patch) =>
                  setDoctorForms((prev) =>
                    prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
                  )
                }
                onSealFileChange={(file) => handleSealFileChange(file, false, idx)}
                fileInputRef={(el) => { sealFileInputRefs.current[form.id ?? idx.toString()] = el; }}
                onSignedUrl={getSealSignedUrl}
                disabled={!canEdit}
              />

              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={!!doctorSaving[form.id ?? '']}
                  onClick={() => handleSaveDoctor(form, idx)}
                >
                  {doctorSaving[form.id ?? ''] ? '저장 중…' : '저장'}
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── 의사 정보 입력 폼 (재사용) ──

function DoctorFormFields({
  form,
  onChange,
  onSealFileChange,
  fileInputRef,
  onSignedUrl,
  disabled = false,
}: {
  form: DoctorForm;
  onChange: (patch: Partial<DoctorForm>) => void;
  onSealFileChange: (file: File) => void;
  fileInputRef: (el: HTMLInputElement | null) => void;
  onSignedUrl: (path: string) => Promise<string | null>;
  disabled?: boolean;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (form.seal_image_url && !form._sealPreview) {
      onSignedUrl(form.seal_image_url).then(setSignedUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.seal_image_url]);

  const previewSrc = form._sealPreview ?? signedUrl;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">성명 *</Label>
          <Input
            value={form.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="홍길동"
            disabled={disabled}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">면허번호</Label>
            <Input
              value={form.license_no}
              onChange={(e) => onChange({ license_no: e.target.value })}
              placeholder="12345"
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">전문의자격번호</Label>
            <Input
              value={form.specialist_no}
              onChange={(e) => onChange({ specialist_no: e.target.value })}
              placeholder="S-67890"
              disabled={disabled}
            />
          </div>
        </div>

        {/* 직인 이미지 업로드 */}
        <div className="space-y-1">
          <Label className="text-xs">직인 이미지 (PNG/JPG)</Label>
          <div className="flex items-center gap-3">
            {previewSrc ? (
              <img
                src={previewSrc}
                alt="직인 미리보기"
                className="h-14 w-14 rounded border object-contain bg-white p-0.5"
              />
            ) : (
              <div className="h-14 w-14 rounded border bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                미등록
              </div>
            )}
            {!disabled && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs h-8"
                  onClick={() => inputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {previewSrc ? '변경' : '업로드'}
                </Button>
                <input
                  ref={(el) => { inputRef.current = el; fileInputRef(el); }}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onSealFileChange(file);
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
