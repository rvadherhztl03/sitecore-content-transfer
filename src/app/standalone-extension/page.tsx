// src/app/standalone-extension/page.tsx
"use client";

import { useState, useEffect } from "react";
import type { ApplicationContext } from "@sitecore-marketplace-sdk/client";
import { useMarketplaceClient } from "@/src/utils/hooks/useMarketplaceClient";
import MigrationDashboard from "@/src/components/MigrationDashboard";

function StandaloneExtension() {
	const { client, error, isInitialized } = useMarketplaceClient();
	const [appContext, setAppContext] = useState<ApplicationContext>();

	useEffect(() => {
		if (!error && isInitialized && client) {
			client
				.query("application.context")
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
		<div style={{ padding: "20px", minHeight: "100vh" }}>
			{/* Small top banner showing connection status */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					backgroundColor: "rgba(255, 255, 255, 0.03)",
					border: "1px solid rgba(255, 255, 255, 0.05)",
					borderRadius: "8px",
					padding: "10px 20px",
					marginBottom: "20px",
					fontSize: "0.85rem",
					color: "var(--text-muted)",
				}}
			>
				<div>
					Extension ID: <span style={{ color: "#fff", fontWeight: "bold" }}>{appContext?.id || "local-development"}</span>
				</div>
				<div>
					SDK Connection Status:{" "}
					{isInitialized ? (
						<span style={{ color: "var(--success)", fontWeight: "bold" }}>● CONNECTED TO SITECORE</span>
					) : (
						<span style={{ color: "var(--warning)", fontWeight: "bold" }}>○ INITIALIZING SDK...</span>
					)}
				</div>
			</div>

			<MigrationDashboard title='Sitecore Content Transfer (BETA)' />

			{error && (
				<div
					style={{
						marginTop: "20px",
						padding: "15px",
						backgroundColor: "var(--error-bg)",
						border: "1px solid var(--error)",
						borderRadius: "8px",
						color: "var(--error)",
					}}
				>
					<strong>Marketplace SDK Error:</strong> {String(error)}
				</div>
			)}
		</div>
	);
}

export default StandaloneExtension;
