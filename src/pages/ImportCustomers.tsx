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

interface ParsedRow {
  full_name: string;
  email: string | null;
  phone: string | null;
  last_visit_date: string | null;
  visit_count: number;
  total_spent: number;
}

const ImportCustomers = () => {
  const { user } = useAuth();
  const locationId = useCurrentLocationId();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  const parseCSV = (text: string): ParsedRow[] => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase());

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

    const rows: ParsedRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      const name = nameIdx >= 0 ? cols[nameIdx] : "";
      if (!name) continue;

      let lastVisit: string | null = null;
      if (lastVisitIdx >= 0 && cols[lastVisitIdx]) {
        const d = new Date(cols[lastVisitIdx].replace(/\//g, "-"));
        if (!isNaN(d.getTime())) lastVisit = d.toISOString().split("T")[0];
      }

      rows.push({
        full_name: name,
        email: emailIdx >= 0 && cols[emailIdx] ? cols[emailIdx] : null,
        phone: phoneIdx >= 0 && cols[phoneIdx] ? cols[phoneIdx] : null,
        last_visit_date: lastVisit,
        visit_count: countIdx >= 0 ? parseInt(cols[countIdx]) || 0 : 0,
        total_spent: spentIdx >= 0 ? parseInt(cols[spentIdx].replace(/[^0-9]/g, "")) || 0 : 0,
      });
    }
    return rows;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setImported(0);
    setErrors([]);
    try {
      const text = await f.text();
      const rows = parseCSV(text);
      setParsed(rows);
      if (rows.length === 0) toast.error("有効な顧客データが見つかりませんでした");
      else toast.success(`${rows.length}件の顧客を読み込みました`);
    } catch {
      toast.error("ファイルの読み込みに失敗しました");
    }
  };

  const handleImport = async () => {
    if (!user || parsed.length === 0) return;
    if (!locationId) { toast.error("店舗が選択されていません"); return; }
    setImporting(true);
    const errs: string[] = [];
    let success = 0;

    const batchSize = 100;
    for (let i = 0; i < parsed.length; i += batchSize) {
      const batch = parsed.slice(i, i + batchSize).map(r => ({
        ...r,
        owner_id: user.id,
        location_id: locationId,
        imported_from: "csv",
        last_imported_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("customers").insert(batch);
      if (error) errs.push(`${i + 1}〜${i + batch.length}行目: ${error.message}`);
      else { success += batch.length; setImported(success); }
    }

    setImporting(false);
    setErrors(errs);
    if (success > 0) toast.success(`${success}件の顧客を登録しました`);
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
