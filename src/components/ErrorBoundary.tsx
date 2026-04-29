import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4 border border-destructive/30 p-10 bg-destructive/5">
            <AlertTriangle className="w-10 h-10 mx-auto text-destructive/80" />
            <p className="eyebrow text-[10px] text-destructive">— Something went wrong —</p>
            <h2 className="font-serif text-lg">{this.props.fallbackTitle || "画面の表示中にエラーが発生しました"}</h2>
            <p className="text-xs text-muted-foreground break-words">
              {this.state.error?.message || "原因不明のエラー"}
            </p>
            <div className="flex gap-2 justify-center pt-2">
              <Button onClick={this.reset} variant="outline" className="rounded-none">
                <RefreshCw className="w-3.5 h-3.5 mr-2" />再試行
              </Button>
              <Button onClick={() => window.location.reload()} className="rounded-none">
                ページを再読込
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
