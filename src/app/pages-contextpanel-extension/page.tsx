"use client";

import { useEffect, useState } from "react";
import type { PagesContext } from "@sitecore-marketplace-sdk/client";
import { PanelFlow } from "@/components/transfer/PanelFlow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMarketplaceClient } from "@/utils/hooks/useMarketplaceClient";

export default function PagesContextPanel() {
	const { client, error } = useMarketplaceClient();
	const [page, setPage] = useState<PagesContext>();

	useEffect(() => {
		if (!client) return;
		client
			.query("pages.context", { subscribe: true, onSuccess: (res: PagesContext) => setPage(res) })
			.catch((e) => console.error("Error retrieving pages.context:", e));
	}, [client]);

	if (error) {
		return (
			<Alert variant="danger">
				<AlertDescription>{`Couldn't connect to Sitecore: ${error.message}`}</AlertDescription>
			</Alert>
		);
	}

	return <PanelFlow client={client} pageName={page?.pageInfo?.name} pagePath={page?.pageInfo?.path} />;
}
