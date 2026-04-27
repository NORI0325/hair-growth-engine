import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileText, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

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
      if (rows.length === 0) {
        toast.error("有効な顧客データが見つかりませんでした");
      } else {
        toast.success(`${rows.length}件の顧客を読み込みました`);
      }
    } catch (err) {
      toast.error("ファイルの読み込みに失敗しました");
    }
  };

  const handleImport = async () => {
    if (!user || parsed.length === 0) return;
    setImporting(true);
    const errs: string[] = [];
    let success = 0;

    const batchSize = 100;
    for (let i = 0; i < parsed.length; i += batchSize) {
      const batch = parsed.slice(i, i + batchSize).map(r => ({ ...r, owner_id: user.id }));
      const { error } = await supabase.from("customers").insert(batch);
      if (error) {
        errs.push(`${i + 1}〜${i + batch.length}行目: ${error.message}`);
      } else {
        success += batch.length;
        setImported(success);
      }
    }

    setImporting(false);
    setErrors(errs);
    if (success > 0) toast.success(`${success}件の顧客を登録しました`);
    if (errs.length > 0) toast.error(`${errs.length}件のエラーが発生しました`);
  };

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">顧客インポート</h1>
        <p className="text-muted-foreground">Excel/CSVファイルから顧客データを一括登録できます</p>
      </div>

      <Card className="shadow-soft mb-6">
        <CardHeader>
          <CardTitle>CSVファイルをアップロード</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
            <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <Label htmlFor="csv-upload" className="cursor-pointer">
              <span className="text-primary font-medium">ファイルを選択</span>
              <span className="text-muted-foreground"> またはドロップ</span>
              <Input id="csv-upload" type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            </Label>
            <p className="text-xs text-muted-foreground mt-2">CSV形式（UTF-8推奨）</p>
          </div>

          {file && (
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <FileText className="w-5 h-5 text-primary" />
              <div className="flex-1">
                <div className="font-medium text-sm">{file.name}</div>
                <div className="text-xs text-muted-foreground">{parsed.length}件の顧客データ</div>
              </div>
            </div>
          )}

          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">対応する列名（自動マッピング）：</p>
            <ul className="list-disc list-inside space-y-0.5 ml-2">
              <li>氏名 / name / 名前 <span className="text-destructive">（必須）</span></li>
              <li>email / メール</li>
              <li>phone / 電話</li>
              <li>最終来店 / last_visit / 来店日</li>
              <li>来店回数 / visit_count</li>
              <li>累計 / total_spent / 売上</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {parsed.length > 0 && (
        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle>プレビュー（最初の5件）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 mb-4">
              {parsed.slice(0, 5).map((r, i) => (
                <div key={i} className="text-sm p-3 bg-muted rounded-lg">
                  <div className="font-medium">{r.full_name}</div>
                  <div className="text-muted-foreground text-xs">
                    {r.email || "-"} / {r.phone || "-"} / 最終来店: {r.last_visit_date || "-"} / 来店{r.visit_count}回
                  </div>
                </div>
              ))}
            </div>

            <Button onClick={handleImport} disabled={importing} className="w-full" size="lg">
              {importing ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{imported}/{parsed.length} 登録中...</>
              ) : (
                <><CheckCircle2 className="w-4 h-4 mr-2" />{parsed.length}件を登録する</>
              )}
            </Button>

            {errors.length > 0 && (
              <div className="mt-4 p-3 bg-destructive/10 rounded-lg">
                <div className="flex items-center gap-2 mb-2 text-destructive font-medium text-sm">
                  <AlertCircle className="w-4 h-4" />エラー
                </div>
                {errors.map((e, i) => (
                  <div key={i} className="text-xs text-destructive">{e}</div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </AppLayout>
  );
};

export default ImportCustomers;
