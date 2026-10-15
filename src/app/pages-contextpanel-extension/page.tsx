"use client";

import { useEffect, useState } from "react";
import type { PagesContext } from "@sitecore-marketplace-sdk/client";
import { Workspace } from "@/components/transfer/Workspace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
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

	const path: string | undefined = page?.pageInfo?.path;
	return (
		<>
			{path && (
				<Card style="outline" padding="sm" className="mx-4 mt-4 gap-1">
					<CardTitle>{page?.pageInfo?.name}</CardTitle>
					<CardDescription className="font-mono break-all">{path}</CardDescription>
				</Card>
			)}
			<Workspace client={client} compact initialItemPath={path} />
		</>
	);
}
