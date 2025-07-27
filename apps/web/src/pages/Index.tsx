import { GenniApp } from "@/components/GenniApp";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const Index = () => {
  return (
    <ProtectedRoute>
      <GenniApp />
    </ProtectedRoute>
  );
};

export default Index;
