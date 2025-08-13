import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import { useUser } from "@clerk/clerk-react";

export function DebugAuth() {
  const { user, isLoaded } = useUser();
  const debugResult = useQuery(api.debug.debugAuth);

  if (!isLoaded) {
    return <div>Loading Clerk...</div>;
  }

  return (
    <div style={{ 
      position: 'fixed', 
      top: '10px', 
      right: '10px', 
      background: 'white', 
      border: '1px solid #ccc', 
      padding: '20px', 
      borderRadius: '8px',
      maxWidth: '400px',
      fontSize: '12px',
      zIndex: 9999
    }}>
      <h3>Auth Debug Info</h3>
      
      <div style={{ marginBottom: '10px' }}>
        <strong>Clerk User:</strong>
        <pre>{user ? `ID: ${user.id}\nEmail: ${user.primaryEmailAddress?.emailAddress}` : 'Not logged in'}</pre>
      </div>

      <div>
        <strong>Convex Auth Result:</strong>
        <pre>{debugResult ? JSON.stringify(debugResult, null, 2) : 'Loading...'}</pre>
      </div>
    </div>
  );
}