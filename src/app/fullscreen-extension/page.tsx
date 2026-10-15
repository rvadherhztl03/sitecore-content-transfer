"use client";

import { App } from "@/components/transfer/App";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMarketplaceClient } from "@/utils/hooks/useMarketplaceClient";
import Spike from "./Spike";

export default function FullscreenExtension() {
	const { client, error } = useMarketplaceClient();

	if (process.env.NEXT_PUBLIC_SPIKE === "1") return <Spike client={client} />;

	if (error) {
		return (
			<Alert variant="danger">
				<AlertDescription>{`Couldn't connect to Sitecore: ${error.message}`}</AlertDescription>
			</Alert>
		);
	}
	return <App client={client} />;
}
