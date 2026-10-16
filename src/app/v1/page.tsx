"use client";

import MigrationDashboard from "@/components/MigrationDashboard";
import Link from "next/link";
import { useEffect, useState } from "react";
import "./v1.css";

// "Back to version 2" returns to the extension page that opened this one (`?back=`), else the full-screen app.
// Only a plain app path is accepted, so the link can never point at another site.
const DEFAULT_BACK = "/fullscreen-extension";
const SAFE_BACK = /^\/[a-z0-9-]+$/;

/** Version 1 (classic): the credential-based dashboard from before the redesign, kept as it was. */
export default function V1Page() {
	const [back, setBack] = useState(DEFAULT_BACK);
	useEffect(() => {
		const requested = new URLSearchParams(window.location.search).get("back");
		if (requested && SAFE_BACK.test(requested)) setBack(requested);
	}, []);

	return (
		<div className="v1-app">
			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					justifyContent: "space-between",
					alignItems: "center",
					gap: "8px 16px",
					padding: "12px 20px",
					borderBottom: "1px solid var(--border-panel)",
					fontSize: "0.85rem",
					color: "var(--text-muted)",
				}}
			>
				<span>Content Transfer v1 (classic): connects with client credentials</span>
				<Link href={back} style={{ color: "var(--primary-color)", fontWeight: 600 }}>
					Back to version 2
				</Link>
			</div>
			<div style={{ padding: "20px" }}>
				<MigrationDashboard title="Content Transfer v1 (classic)" />
			</div>
		</div>
	);
}
