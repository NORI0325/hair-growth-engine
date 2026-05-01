import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSubscription, isActiveSubscription } from "@/hooks/useSubscription";
import { Loader2 } from "lucide-react";

const RequireActiveSubscription = ({ children }: { children: ReactNode }) => {
  const { data, isLoading } = useSubscription();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!isActiveSubscription(data)) {
    return <Navigate to="/billing?reason=inactive" replace />;
  }
  return <>{children}</>;
};

export default RequireActiveSubscription;
