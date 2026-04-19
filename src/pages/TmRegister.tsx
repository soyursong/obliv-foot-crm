import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { getSelectedClinic } from '@/lib/clinic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { ArrowLeft, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';

const SOURCE_OPTIONS = [
  { value: 'meta', label: '메타 광고' },
  { value: 'naver', label: '네이버 예약' },
  { value: 'instagram', label: '인스타그램' },
  { value: 'youtube', label: '유튜브' },
  { value: 'referral', label: '지인소개' },
  { value: 'phone_inquiry', label: '전화문의' },
  { value: 'kakao', label: '카카오톡' },
  { value: 'other', label: '기타' },
];

interface BulkRow {
  name: string;
  phone: string;
  source?: string;
  treatment?: string;
  memo?: string;
  isDuplicate?: boolean;
}

export default function TmRegister() {
  const navigate = useNavigate();
  const [clinicId, setClinicId] = useState('');
  const [callerId, setCallerId] = useState('');
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);

  // Individual form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('');
  const [treatment, setTreatment] = useState('');
  const [memo, setMemo] = useState('');
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Bulk upload
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/admin'); return; }
      setCallerId(session.user.id);
      const clinic = await getSelectedClinic();
      if (clinic) setClinicId(clinic.id);
    })();
  }, [navigate]);

  useEffect(() => {
    if (!clinicId) return;
    (async () => {
      const { data } = await supabase.from('services').select('id, name').eq('clinic_id', clinicId).eq('active', true);
      setServices((data || []) as { id: string; name: string }[]);
    })();
  }, [clinicId]);

  const checkDuplicate = async (phoneVal: string) => {
    if (!phoneVal || phoneVal.length < 8 || !clinicId) { setDupWarning(null); return; }
    const digits = phoneVal.replace(/\D/g, '');

    const [{ data: leadDup }, { data: custDup }] = await Promise.all([
      supabase.from('leads').select('id, name').eq('clinic_id', clinicId).eq('phone', digits).limit(1),
      supabase.from('customers').select('id, name').eq('clinic_id', clinicId).eq('phone', digits).limit(1),
    ]);

    if ((leadDup && leadDup.length > 0) || (custDup && custDup.length > 0)) {
      const dupName = (leadDup?.[0] as any)?.name || (custDup?.[0] as any)?.name || '';
      setDupWarning(`⚠️ 동일 번호 발견: ${dupName}`);
    } else {
      setDupWarning(null);
    }
  };

  const handleRegister = async (continueMode: boolean) => {
    if (!name.trim() || !phone.trim() || !clinicId) {
      toast.error('이름과 전화번호를 입력해주세요');
      return;
    }
    setSaving(true);
    const digits = phone.replace(/\D/g, '');
    const { error } = await supabase.from('leads').insert({
      clinic_id: clinicId,
      name: name.trim(),
      phone: digits,
      source: source || 'manual',
      interested_treatment: treatment || null,
      memo: memo || null,
      status: 'new',
      assigned_to: callerId,
      assigned_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      toast.error('등록 실패: ' + error.message);
      return;
    }
    toast.success('리드 등록 완료');
    if (continueMode) {
      setName('');
      setPhone('');
      setMemo('');
      setDupWarning(null);
    } else {
      navigate('/tm');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<any>(ws);

    const rows: BulkRow[] = json.map((row: any) => ({
      name: String(row['고객명'] || row['name'] || row['이름'] || '').trim(),
      phone: String(row['전화번호'] || row['phone'] || row['연락처'] || '').replace(/\D/g, ''),
      source: String(row['유입경로'] || row['source'] || '').trim() || undefined,
      treatment: String(row['시술'] || row['treatment'] || row['관심시술'] || '').trim() || undefined,
      memo: String(row['메모'] || row['memo'] || '').trim() || undefined,
    })).filter((r: BulkRow) => r.name && r.phone);

    // Check duplicates
    if (rows.length > 0 && clinicId) {
      const phones = rows.map(r => r.phone);
      const { data: existing } = await supabase.from('leads').select('phone').eq('clinic_id', clinicId).in('phone', phones);
      const existingPhones = new Set((existing || []).map((e: any) => e.phone));
      rows.forEach(r => { r.isDuplicate = existingPhones.has(r.phone); });
    }

    setBulkRows(rows);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleBulkUpload = async () => {
    if (bulkRows.length === 0 || !clinicId) return;
    setBulkUploading(true);
    const inserts = bulkRows.filter(r => !r.isDuplicate).map(r => ({
      clinic_id: clinicId,
      name: r.name,
      phone: r.phone,
      source: r.source || 'excel_upload',
      interested_treatment: r.treatment || null,
      memo: r.memo || null,
      status: 'new' as const,
      assigned_to: callerId,
      assigned_at: new Date().toISOString(),
    }));

    if (inserts.length === 0) {
      toast.error('등록할 신규 리드가 없습니다 (전부 중복)');
      setBulkUploading(false);
      return;
    }

    const { error } = await supabase.from('leads').insert(inserts);
    setBulkUploading(false);
    if (error) {
      toast.error('업로드 실패: ' + error.message);
      return;
    }
    toast.success(`${inserts.length}건 등록 완료`);
    setBulkRows([]);
  };

  return (
    <div className="min-h-screen bg-muted/50">
      <header className="bg-card border-b border-border px-4 py-3 flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/tm')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> TM
        </Button>
        <h1 className="text-lg font-bold">리드 등록</h1>
      </header>

      <div className="max-w-2xl mx-auto p-6">
        <Tabs defaultValue="individual">
          <TabsList className="mb-4">
            <TabsTrigger value="individual">개별 등록</TabsTrigger>
            <TabsTrigger value="excel">엑셀 업로드</TabsTrigger>
          </TabsList>

          <TabsContent value="individual">
            <div className="bg-card rounded-lg border p-6 space-y-4">
              <div>
                <label className="text-sm font-medium">고객명 *</label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="홍길동" />
              </div>
              <div>
                <label className="text-sm font-medium">전화번호 *</label>
                <Input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  onBlur={() => checkDuplicate(phone)}
                  placeholder="01012345678"
                  type="tel"
                />
                {dupWarning && (
                  <p className="text-xs text-orange-600 mt-1">{dupWarning}</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium">유입경로</label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {SOURCE_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">관심 시술</label>
                <Select value={treatment} onValueChange={setTreatment}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {services.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">메모</label>
                <Textarea value={memo} onChange={e => setMemo(e.target.value)} rows={3} placeholder="메모" />
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => handleRegister(false)} disabled={saving}>
                  등록
                </Button>
                <Button className="flex-1 bg-accent text-accent-foreground" onClick={() => handleRegister(true)} disabled={saving}>
                  등록 + 계속
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="excel">
            <div className="bg-card rounded-lg border p-6 space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-3">
                  필수 컬럼: <strong>고객명, 전화번호</strong><br />
                  선택 컬럼: 유입경로, 시술, 메모
                </p>
                <div className="flex items-center gap-3">
                  <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
                  <Button variant="outline" onClick={() => fileRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-1" /> 파일 선택
                  </Button>
                  {bulkRows.length > 0 && (
                    <span className="text-sm text-muted-foreground">{bulkRows.length}건 로드됨</span>
                  )}
                </div>
              </div>

              {bulkRows.length > 0 && (
                <>
                  <div className="max-h-80 overflow-auto border rounded">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>이름</TableHead>
                          <TableHead>전화번호</TableHead>
                          <TableHead>유입경로</TableHead>
                          <TableHead>시술</TableHead>
                          <TableHead>상태</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bulkRows.map((r, i) => (
                          <TableRow key={i} className={r.isDuplicate ? 'bg-orange-50' : ''}>
                            <TableCell>{r.name}</TableCell>
                            <TableCell>{r.phone}</TableCell>
                            <TableCell>{r.source || '-'}</TableCell>
                            <TableCell>{r.treatment || '-'}</TableCell>
                            <TableCell>
                              {r.isDuplicate ? (
                                <span className="text-xs text-orange-600 font-medium">중복</span>
                              ) : (
                                <span className="text-xs text-green-600">신규</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      신규: {bulkRows.filter(r => !r.isDuplicate).length}건 / 중복: {bulkRows.filter(r => r.isDuplicate).length}건
                    </span>
                    <Button className="bg-accent text-accent-foreground" onClick={handleBulkUpload} disabled={bulkUploading}>
                      업로드 확정
                    </Button>
                  </div>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
