"use client";

import { Workspace } from "@/components/transfer/Workspace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMarketplaceClient } from "@/utils/hooks/useMarketplaceClient";

export default function StandaloneExtension() {
	const { client, error } = useMarketplaceClient();
	if (error) {
		return (
			<Alert variant="danger">
				<AlertDescription>{`Couldn't connect to Sitecore: ${error.message}`}</AlertDescription>
			</Alert>
		);
	}
	return <Workspace client={client} />;
}
