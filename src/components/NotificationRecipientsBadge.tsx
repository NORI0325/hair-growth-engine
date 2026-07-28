import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenant";
import { Bell, Mail, MessageCircle, AlertTriangle, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Recipient {
  name?: string;
  email?: string;
  line_user_id?: string;
  channels?: string[];
}

interface Props {
  variant?: "dashboard" | "settings";
}

const NotificationRecipientsBadge = ({ variant = "dashboard" }: Props) => {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [legacyEmail, setLegacyEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("notification_recipients, owner_notification_email")
        .eq("id", tenantId)
        .maybeSingle();
      const list: Recipient[] = Array.isArray(data?.notification_recipients)
        ? (data!.notification_recipients as Recipient[])
        : [];
      setRecipients(list);
      setLegacyEmail((data?.owner_notification_email as string | null) ?? null);
      setLoading(false);
    })();
  }, [tenantId]);

  if (loading) return null;

  const total =
    recipients.length +
    (legacyEmail && !recipients.some((r) => r.email?.toLowerCase() === legacyEmail.toLowerCase()) ? 1 : 0);

  const isEmpty = total === 0;

  return (
    <div
      className={`mb-6 border rounded-md p-4 ${
        isEmpty ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          {isEmpty ? (
            <AlertTriangle className="w-4 h-4 text-destructive" />
          ) : (
            <Bell className="w-4 h-4 text-primary" />
          )}
          <h3 className="font-semibold text-sm">
            予約通知の配信先{" "}
            <span className="text-xs text-muted-foreground">（現在 {total} 名）</span>
          </h3>
        </div>
        {variant === "dashboard" && (
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link to="/settings">
              <SettingsIcon className="w-3 h-3 mr-1" />
              編集
            </Link>
          </Button>
        )}
      </div>

      {isEmpty ? (
        <p className="text-xs text-destructive">
          通知先が未設定です。新規予約・キャンセルが入っても誰にも届きません。今すぐ設定してください。
        </p>
      ) : (
        <>
          <ul className="space-y-1.5 mb-2">
            {recipients.map((r, i) => {
              const channels = r.channels?.length ? r.channels : ["email"];
              return (
                <li
                  key={i}
                  className="flex items-center gap-2 text-xs px-2 py-1.5 bg-secondary/40 rounded"
                >
                  <span className="font-medium truncate flex-1">
                    {r.name || r.email || r.line_user_id || `通知先 #${i + 1}`}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {channels.includes("email") && r.email && (
                      <span
                        title={r.email}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-background border border-border"
                      >
                        <Mail className="w-3 h-3" />
                        メール
                      </span>
                    )}
                    {channels.includes("line") && r.line_user_id && (
                      <span
                        title={r.line_user_id}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#06c755]/10 text-[#06c755] border border-[#06c755]/30"
                      >
                        <MessageCircle className="w-3 h-3" />
                        LINE
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
            {legacyEmail &&
              !recipients.some((r) => r.email?.toLowerCase() === legacyEmail.toLowerCase()) && (
                <li className="flex items-center gap-2 text-xs px-2 py-1.5 bg-secondary/40 rounded">
                  <span className="font-medium truncate flex-1">{legacyEmail}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-background border border-border">
                    <Mail className="w-3 h-3" />
                    代表メール
                  </span>
                </li>
              )}
          </ul>
          <p className="text-[10px] text-muted-foreground">
            退職スタッフや誤った宛先が無いか、定期的にご確認ください。
          </p>
        </>
      )}
    </div>
  );
};

export default NotificationRecipientsBadge;
