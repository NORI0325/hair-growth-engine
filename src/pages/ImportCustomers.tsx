import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileText, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";
import Papa from "papaparse";

type Gender = "female" | "male" | "other" | "unknown";

interface ParsedRow {
  full_name: string;
  email: string | null;
  phone: string | null;
  last_visit_date: string | null;
  visit_count: number;
  total_spent: number;
  gender: Gender;
}

function normalizeGender(s: string | undefined): Gender {
  const v = (s || "").trim();
  if (!v) return "unknown";
  if (/女/.test(v) || /female/i.test(v) || v === "F") return "female";
  if (/男/.test(v) || /male/i.test(v) || v === "M") return "male";
  if (/その他|other/i.test(v)) return "other";
  return "unknown";
}

function normalizePhone(s: string | null | undefined): string {
  return (s || "").replace(/[^\d]/g, "");
}

function normalizeCsvDate(value: string | undefined): string | null {
  const match = (value || "").trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface ExistingCustomer {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  gender: Gender | null;
  last_visit_date: string | null;
  visit_count: number;
  total_spent: number;
  location_id: string | null;
}

type CustomerLookupColumn = "phone" | "email" | "full_name";
type CustomerUpdatePayload = {
  phone: string | null;
  email: string | null;
  gender: Gender;
  last_visit_date: string | null;
  visit_count: number;
  total_spent: number;
  imported_from: string;
  last_imported_at: string;
};

const ImportCustomers = () => {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  const parseCSV = (text: string): { rows: ParsedRow[]; parseErrors: string[] } => {
    const result = Papa.parse<string[]>(text, {
      skipEmptyLines: "greedy",
      transform: (value) => value.trim(),
    });
    const table = result.data;
    if (table.length < 2) return { rows: [], parseErrors: [] };
    const headers = table[0].map(h => h.replace(/^\uFEFF/, "").trim().toLowerCase());

    const findIdx = (...keys: string[]) => {
      for (const k of keys) {
        const i = headers.findIndex(h => h.includes(k));
        if (i >= 0) return i;
      }
      return -1;
    };

    const nameIdx = findIdx("氏名", "name", "名前");
    const emailIdx = findIdx("email", "メール", "mail");
    const phoneIdx = findIdx("phone", "電話", "tel");
    const lastVisitIdx = findIdx("最終来店", "last_visit", "lastvisit", "来店日");
    const countIdx = findIdx("来店回数", "visit_count", "回数");
    const spentIdx = findIdx("累計", "total_spent", "金額", "売上");
    const genderIdx = findIdx("性別", "gender", "sex");

    const rows: ParsedRow[] = [];
    for (let i = 1; i < table.length; i++) {
      const cols = table[i];
      const name = nameIdx >= 0 ? cols[nameIdx] : "";
      if (!name) continue;

      rows.push({
        full_name: name,
        email: emailIdx >= 0 && cols[emailIdx] ? cols[emailIdx] : null,
        phone: phoneIdx >= 0 && cols[phoneIdx] ? cols[phoneIdx] : null,
        last_visit_date: lastVisitIdx >= 0 ? normalizeCsvDate(cols[lastVisitIdx]) : null,
        visit_count: countIdx >= 0 ? parseInt(cols[countIdx]) || 0 : 0,
        total_spent: spentIdx >= 0 ? parseInt(cols[spentIdx].replace(/[^0-9]/g, "")) || 0 : 0,
        gender: normalizeGender(genderIdx >= 0 ? cols[genderIdx] : ""),
      });
    }
    return {
      rows,
      parseErrors: result.errors.slice(0, 20).map(error =>
        `${typeof error.row === "number" ? `${error.row + 1}行目: ` : ""}${error.message}`
      ),
    };
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setImported(0);
    setErrors([]);
    try {
      const text = await f.text();
      const { rows, parseErrors } = parseCSV(text);
      setParsed(rows);
      setErrors(parseErrors);
      if (rows.length === 0) toast.error("有効な顧客データが見つかりませんでした");
      else if (parseErrors.length > 0) toast.warning(`${rows.length}件を読み込みましたが、CSV形式の警告があります`);
      else toast.success(`${rows.length}件の顧客を読み込みました`);
    } catch {
      toast.error("ファイルの読み込みに失敗しました");
    }
  };

  const handleImport = async () => {
    if (!user || !tenantId || parsed.length === 0) return;
    if (!locationId) { toast.error("店舗が選択されていません"); return; }
    setImporting(true);
    const errs: string[] = [];
    let inserted = 0;
    let updated = 0;
    const nowIso = new Date().toISOString();

    const blank = (value: unknown) => value === null || value === undefined || value === "" || value === "unknown";

    // 既存顧客を一括取得（電話 / メール / 氏名 で検索）
    const phones = [...new Set(parsed.map(r => normalizePhone(r.phone)).filter(Boolean))];
    const emails = [...new Set(parsed.map(r => (r.email || "").trim().toLowerCase()).filter(Boolean))];
    const names = [...new Set(parsed.map(r => r.full_name))];

    const SELECT_COLS = "id, full_name, phone, email, birthday, gender, last_visit_date, visit_count, total_spent, location_id";
    const fetchBy = async (col: CustomerLookupColumn, values: string[]) => {
      const map = new Map<string, ExistingCustomer[]>();
      const CHUNK = 300;
      for (let i = 0; i < values.length; i += CHUNK) {
        const slice = values.slice(i, i + CHUNK);
        const { data, error } = await supabase.from("customers")
          .select(SELECT_COLS)
          .eq("owner_id", tenantId)
          .in(col, slice);
        if (error) throw new Error(`既存顧客の照合に失敗しました: ${error.message}`);
        for (const row of (data || []) as ExistingCustomer[]) {
          const key = String((row as unknown as Record<string, unknown>)[col] || "");
          if (!key) continue;
          map.set(key, [...(map.get(key) || []), row]);
        }
      }
      return map;
    };

    let byPhone: Map<string, ExistingCustomer[]>;
    let byEmail: Map<string, ExistingCustomer[]>;
    let byName: Map<string, ExistingCustomer[]>;
    try {
      [byPhone, byEmail, byName] = await Promise.all([
        phones.length ? fetchBy("phone", phones) : Promise.resolve(new Map<string, ExistingCustomer[]>()),
        emails.length ? fetchBy("email", emails) : Promise.resolve(new Map<string, ExistingCustomer[]>()),
        names.length ? fetchBy("full_name", names) : Promise.resolve(new Map<string, ExistingCustomer[]>()),
      ]);
    } catch (error) {
      setImporting(false);
      const message = error instanceof Error ? error.message : "既存顧客の照合に失敗しました";
      setErrors([message]);
      toast.error(message);
      return;
    }

    // 1件ずつ判定（バッチではなく確実に穴埋め）
    for (let i = 0; i < parsed.length; i++) {
      const r = parsed[i];
      const phone = normalizePhone(r.phone);
      const email = (r.email || "").trim().toLowerCase();

      const strongMatches = new Map<string, ExistingCustomer>();
      for (const match of phone ? (byPhone.get(phone) || []) : []) strongMatches.set(match.id, match);
      for (const match of email ? (byEmail.get(email) || []) : []) strongMatches.set(match.id, match);
      if (strongMatches.size > 1) {
        errs.push(`${i + 2}行目(${r.full_name}): 電話番号とメールが別々の既存顧客に一致したため取り込みを停止しました`);
        continue;
      }

      let existing = strongMatches.values().next().value as ExistingCustomer | undefined;
      if (!existing && !phone && !email) {
        const sameLocationNames = (byName.get(r.full_name) || []).filter(row => row.location_id === locationId);
        if (sameLocationNames.length > 1) {
          errs.push(`${i + 2}行目(${r.full_name}): 同名顧客が複数いるため自動更新できません`);
          continue;
        }
        existing = sameLocationNames[0];
      }

      if (existing) {
        // 穴埋め型 UPDATE
        const payload: CustomerUpdatePayload = {
          phone: blank(phone) ? existing.phone : phone,
          email: blank(email) ? existing.email : email,
          gender: blank(r.gender) ? (existing.gender || "unknown") : r.gender,
          last_visit_date: (() => {
            if (blank(r.last_visit_date)) return existing.last_visit_date;
            if (!existing.last_visit_date) return r.last_visit_date;
            return r.last_visit_date! > existing.last_visit_date ? r.last_visit_date : existing.last_visit_date;
          })(),
          visit_count: Math.max(existing.visit_count || 0, r.visit_count),
          total_spent: Math.max(existing.total_spent || 0, r.total_spent),
          imported_from: "csv",
          last_imported_at: nowIso,
        };
        const { error } = await supabase
          .from("customers")
          .update(payload)
          .eq("owner_id", tenantId)
          .eq("id", existing.id);
        if (error) errs.push(`${i + 2}行目(${r.full_name}): ${error.message}`);
        else { updated++; setImported(inserted + updated); }
      } else {
        const { data: created, error } = await supabase.from("customers").insert({
          full_name: r.full_name,
          phone: phone || null,
          email: email || null,
          last_visit_date: r.last_visit_date,
          visit_count: r.visit_count,
          total_spent: r.total_spent,
          gender: r.gender,
          owner_id: tenantId,
          location_id: locationId,
          imported_from: "csv",
          last_imported_at: nowIso,
          first_imported_at: nowIso,
        }).select(SELECT_COLS).single();
        if (error) errs.push(`${i + 2}行目(${r.full_name}): ${error.message}`);
        else {
          const customer = created as ExistingCustomer;
          if (phone) byPhone.set(phone, [...(byPhone.get(phone) || []), customer]);
          if (email) byEmail.set(email, [...(byEmail.get(email) || []), customer]);
          byName.set(r.full_name, [...(byName.get(r.full_name) || []), customer]);
          inserted++;
          setImported(inserted + updated);
        }
      }
    }

    setImporting(false);
    setErrors(errs);
    const total = inserted + updated;
    if (total > 0) toast.success(`新規 ${inserted}件 / 更新 ${updated}件 を取り込みました`);
    if (errs.length > 0) toast.error(`${errs.length}件のエラーが発生しました`);
  };

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.03 — Import"
        title="顧客インポート"
        description="眠れる資産を、一括で迎え入れる。"
      />

      <div className="grid lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-10">
          <div className="border border-dashed border-border p-16 text-center bg-secondary/20 hover:border-gold/40 transition-colors">
            <Upload className="w-6 h-6 mx-auto mb-4 text-muted-foreground stroke-[1.5]" />
            <Label htmlFor="csv-upload" className="cursor-pointer">
              <span className="font-serif text-base text-gold gold-underline">ファイルを選択</span>
              <span className="text-muted-foreground text-sm"> または、ここにドロップしてください</span>
              <Input id="csv-upload" type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            </Label>
            <p className="text-[11px] text-muted-foreground mt-3">CSV形式・UTF-8</p>
          </div>

          {file && (
            <div className="flex items-center gap-4 py-4 border-y border-border">
              <FileText className="w-4 h-4 text-gold stroke-[1.5]" />
              <div className="flex-1">
                <div className="font-serif text-sm">{file.name}</div>
                <div className="text-[11px] text-muted-foreground mt-1">{parsed.length} 件のデータ</div>
              </div>
            </div>
          )}

          {parsed.length > 0 && (
            <div>
              <p className="eyebrow mb-4">— Preview / プレビュー（先頭5件）—</p>
              <div className="border-t border-border">
                {parsed.slice(0, 5).map((r, i) => (
                  <div key={i} className="py-4 border-b border-border/60">
                    <div className="font-serif text-sm">{r.full_name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {r.email || "—"} · {r.phone || "—"} · 最終来店 {r.last_visit_date || "—"} · {r.visit_count}回
                    </div>
                  </div>
                ))}
              </div>

              <Button onClick={handleImport} disabled={importing} className="w-full mt-8 rounded-none py-6 text-xs tracking-luxury bg-primary hover:bg-primary-glow shadow-elegant" size="lg">
                {importing ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />{imported} / {parsed.length} 件 取込中...</>
                ) : (
                  <>{parsed.length}件 のお客様を取り込む <span className="ml-2 opacity-60 text-[10px]">IMPORT</span></>
                )}
              </Button>

              {errors.length > 0 && (
                <div className="mt-6 p-4 border border-destructive/40">
                  <div className="flex items-center gap-2 mb-2 text-destructive text-xs font-serif">
                    <AlertCircle className="w-3.5 h-3.5" />エラー
                  </div>
                  {errors.map((e, i) => <div key={i} className="text-xs text-destructive">{e}</div>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Side: column reference */}
        <div className="lg:col-span-1">
          <p className="eyebrow mb-4">— 対応する列名 / Column Mapping —</p>
          <div className="border-t border-border">
            {[
              { jp: "氏名 / name", req: true },
              { jp: "email / メール" },
              { jp: "phone / 電話" },
              { jp: "最終来店 / last_visit" },
              { jp: "来店回数 / visit_count" },
              { jp: "累計 / total_spent" },
              { jp: "性別 / gender" },
            ].map((col, i) => (
              <div key={i} className="py-3 border-b border-border/60 flex justify-between items-center">
                <span className="text-xs font-serif">{col.jp}</span>
                {col.req && <span className="text-[10px] font-serif text-destructive">必須</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default ImportCustomers;
