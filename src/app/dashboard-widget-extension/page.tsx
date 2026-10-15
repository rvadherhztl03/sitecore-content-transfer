"use client";

import { useEffect, useState } from "react";
import { useMarketplaceClient } from "@/utils/hooks/useMarketplaceClient";
import { ApplicationContext } from "@sitecore-marketplace-sdk/client";

function DashboardWidget() {
  const { client, isInitialized, error } = useMarketplaceClient();
  const [appContext, setAppContext] = useState<ApplicationContext>();

  useEffect(() => {
    if (!error && isInitialized && client) {
      console.log("Marketplace client initialized successfully.");
      // Make a query to retrieve the application context
      client.query("application.context")
        .then((res) => {
          console.log("Success retrieving application.context:", res.data);
          setAppContext(res.data);
        })
        .catch((error) => {
          console.error("Error retrieving application.context:", error);
        });
    } else if (error) {
      console.error("Error initializing Marketplace client:", error);
    }
  }, [client, error, isInitialized]);

  return (
    <div style={{ padding: "10px", border: "1px solid #ddd", borderRadius: "8px" }}>
      {isInitialized ? (
        <>  
          <h1>Welcome to {appContext?.name}</h1>
          <p>This is a dashboard widget extension.</p>
          <div className="application-context">
            <h3>Application Context:</h3>
            <ul className="context-details">
              <li><strong>Name:</strong> {appContext?.name}</li>
              <li><strong>ID:</strong> {appContext?.id}</li>
              <li><strong>Icon URL:</strong> {appContext?.iconUrl}</li>
              <li><strong>Installation ID:</strong> {appContext?.installationId}</li>
              <li><strong>State:</strong> {appContext?.state}</li>
              <li><strong>Type:</strong> {appContext?.type}</li>
              <li><strong>URL:</strong> {appContext?.url}</li>
            </ul>
          </div>
        </>
      ) : (
        <p>Loading widget...</p>
      )}
      {error && <p style={{ color: "red" }}>Error: {String(error)}</p>}
    </div>
  );
}

export default DashboardWidget;
