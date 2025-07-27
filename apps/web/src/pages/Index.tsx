import { Navigate } from "react-router-dom";

const Index = () => {
  // This is a fallback - users should be directed to the proper routes
  return <Navigate to="/" replace />;
};

export default Index;
