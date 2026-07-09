// src/app/pages-contextpanel-extension/page.tsx
"use client";

import { useState, useEffect } from "react";
import type { ApplicationContext, PagesContext } from "@sitecore-marketplace-sdk/client";
import { useMarketplaceClient } from "@/src/utils/hooks/useMarketplaceClient";
import MigrationDashboard from "@/src/components/MigrationDashboard";

function PagesContextPanel() {
  const { client, error, isInitialized } = useMarketplaceClient();
  const [pagesContext, setPagesContext] = useState<PagesContext>();
  const [appContext, setAppContext] = useState<ApplicationContext>();

  useEffect(() => {
    if (!error && isInitialized && client) {
      client.query("application.context")
        .then((res) => {
          console.log("Success retrieving application.context:", res.data);
          setAppContext(res.data);
        })
        .catch((error) => {
          console.error("Error retrieving application.context:", error);
        });
      
      client.query("pages.context", {
        subscribe: true,
        onSuccess: (res) => {
          console.log("Success retrieving pages.context:", res);
          setPagesContext(res);
        },
      }).catch((error) => {
        console.error("Error retrieving pages.context:", error);
      });
    } else if (error) {
      console.error("Error initializing Marketplace client:", error);
    }
  }, [client, error, isInitialized]);

  const activePagePath = pagesContext?.pageInfo?.path;

  return (
    <div style={{ padding: "20px", minHeight: "100vh" }}>
      {/* Context info banner */}
      <div style={{ 
        backgroundColor: "rgba(0, 242, 254, 0.05)",
        border: "1px solid rgba(0, 242, 254, 0.15)",
        borderRadius: "8px",
        padding: "15px 20px",
        marginBottom: "20px",
        fontSize: "0.9rem"
      }}>
        <h3 style={{ color: "var(--primary)", fontSize: "1rem", marginBottom: "8px" }}>
          🎯 Context-Aware Migration Panel
        </h3>
        {activePagePath ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div>
              Active Page: <strong style={{ color: "#fff" }}>{pagesContext?.pageInfo?.name}</strong>
            </div>
            <div>
              Sitecore Path: <code style={{ color: "var(--secondary)", backgroundColor: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: "4px", fontSize: "0.8rem" }}>{activePagePath}</code>
            </div>
            <div>
              Language: <span style={{ color: "#fff" }}>{pagesContext?.pageInfo?.language}</span>
            </div>
          </div>
        ) : (
          <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
            No page context selected in Pages Editor. Select a page to pre-populate migration path.
          </div>
        )}
      </div>

      <MigrationDashboard 
        initialItemPath={activePagePath} 
        title="Sitecore Content Transfer (Context Panel)" 
      />

      {error && (
        <div style={{ 
          marginTop: "20px", 
          padding: "15px", 
          backgroundColor: "var(--error-bg)", 
          border: "1px solid var(--error)", 
          borderRadius: "8px", 
          color: "var(--error)" 
        }}>
          <strong>Marketplace SDK Error:</strong> {String(error)}
        </div>
      )}
    </div>
  );
}

export default PagesContextPanel;
