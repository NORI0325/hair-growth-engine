import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useTenant, hasMinRole, TenantRole } from "@/hooks/useTenant";
import { Loader2 } from "lucide-react";

interface Props {
  role: TenantRole;
  children: ReactNode;
  fallback?: ReactNode;
}

const RequireRole = ({ role, children, fallback }: Props) => {
  const { data, isLoading } = useTenant();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!data || !hasMinRole(data.role, role)) {
    if (fallback) return <>{fallback}</>;
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};

export default RequireRole;
