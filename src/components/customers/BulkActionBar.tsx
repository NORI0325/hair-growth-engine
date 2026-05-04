import { Button } from "@/components/ui/button";
import { MessageCircle, Download, X, CheckSquare } from "lucide-react";

interface Props {
  count: number;
  total: number;
  onClear: () => void;
  onSelectAll: () => void;
  onLineBroadcast: () => void;
  onExportCsv: () => void;
}

const BulkActionBar = ({ count, total, onClear, onSelectAll, onLineBroadcast, onExportCsv }: Props) => {
  if (count === 0) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-foreground text-background border border-foreground shadow-2xl px-5 py-3 flex items-center gap-4 animate-in slide-in-from-bottom-4">
      <div className="flex items-center gap-3 pr-4 border-r border-background/20">
        <CheckSquare className="w-4 h-4 text-gold" />
        <span className="font-serif-en text-sm tabular-nums">{count}</span>
        <span className="text-xs opacity-70">名選択中</span>
        {count < total && (
          <button onClick={onSelectAll} className="text-[10px] underline opacity-70 hover:opacity-100">
            全{total}名選択
          </button>
        )}
      </div>
      <Button
        size="sm"
        onClick={onLineBroadcast}
        className="rounded-none bg-gold hover:bg-gold/90 text-foreground text-[11px] tracking-wider"
      >
        <MessageCircle className="w-3.5 h-3.5 mr-1.5" />
        一斉送信
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onExportCsv}
        className="rounded-none text-background hover:bg-background/10 text-[11px] tracking-wider"
      >
        <Download className="w-3.5 h-3.5 mr-1.5" />
        CSV
      </Button>
      <button onClick={onClear} className="opacity-60 hover:opacity-100 transition-opacity">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default BulkActionBar;
