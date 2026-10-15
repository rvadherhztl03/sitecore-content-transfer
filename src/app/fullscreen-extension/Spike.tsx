// THROWAWAY Phase 0 spike: lets a human run real SDK calls inside XM Cloud and paste back raw output.
// Shown only when NEXT_PUBLIC_SPIKE=1. Delete after findings are recorded.
"use client";

import { useRef, useState } from "react";
import type { ClientSDK } from "@sitecore-marketplace-sdk/client";

const CHILDREN_QUERY = `query GetItemChildren($path: String!) {
  item(where: { path: $path, database: "master" }) {
    itemId
    name
    path
    children(first: 1000) {
      nodes { itemId name path children(first: 1) { nodes { itemId } } }
    }
  }
}`;

type Kind = "preview" | "live";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Blob -> { blobSize }, Response -> { status, headers }, anything else is plain JSON.
function replacer(_k: string, v: Any) {
	if (typeof Blob !== "undefined" && v instanceof Blob) return { blobSize: v.size };
	if (v instanceof ArrayBuffer) return { arrayBufferByteLength: v.byteLength };
	if (typeof Response !== "undefined" && v instanceof Response) {
		return { status: v.status, headers: Object.fromEntries(v.headers) };
	}
	if (v instanceof Error) return { name: v.name, message: v.message };
	return v;
}

export default function Spike({ client }: { client: ClientSDK | null }) {
	const [out, setOut] = useState("");
	const [busy, setBusy] = useState(false);
	const [srcIdx, setSrcIdx] = useState(0);
	const [tgtIdx, setTgtIdx] = useState(1);
	const [kind, setKind] = useState<Kind>("preview");
	const [itemPath, setItemPath] = useState("");
	const [mediaPath, setMediaPath] = useState("");
	const resources = useRef<Any[]>([]);
	const c = client as Any;

	const log = (label: string, value?: unknown) => {
		const body = value === undefined ? "" : JSON.stringify(value, replacer, 2);
		setOut((prev) => `${prev}\n=== ${label} ===\n${body}\n`);
	};

	// Normalise to the raw hey-api result { data, error, response } for both queries and mutations.
	const op = async (type: "query" | "mutate", key: string, params: Any) => {
		try {
			const r = await c[type](key, { params });
			if (type === "mutate") return r;
			return r?.data ?? { data: undefined, error: r?.error };
		} catch (e) {
			return { data: undefined, error: e, response: undefined };
		}
	};
	const logRes = (label: string, r: Any) => log(label, { data: r?.data, error: r?.error, response: r?.response });

	const loadContext = async () => {
		const res = await c.query("application.context");
		resources.current = res?.data?.resourceAccess ?? [];
		log("application.context resourceAccess", { resourceAccess: resources.current, error: res?.error });
	};
	const ensureContext = async () => {
		if (!resources.current.length) await loadContext();
		return resources.current;
	};

	const tree = async (k: Kind) => {
		const ra = await ensureContext();
		const sitecoreContextId = ra[srcIdx]?.context?.[k];
		const r = await op("mutate", "xmc.authoring.graphql", {
			query: { sitecoreContextId },
			body: { query: CHILDREN_QUERY, variables: { path: "/sitecore" } },
		});
		log(`Tree (${k}) sitecoreContextId=${sitecoreContextId}`);
		logRes(`Tree (${k}) result`, r);
	};

	const transfer = async () => {
		const ra = await ensureContext();
		const src = ra[srcIdx];
		const tgt = ra[tgtIdx];
		const paths = [itemPath, mediaPath].map((p) => p.trim()).filter(Boolean);
		if (!src || !tgt || !paths.length) return log("Transfer aborted: need valid source/target index and at least one item path");
		if (srcIdx === tgtIdx) return log("Transfer aborted: source index equals target index");
		const srcCtx = src.context?.[kind];
		const tgtCtx = tgt.context?.[kind];
		if (!srcCtx || !tgtCtx) return log("Transfer aborted: missing context id", { kind, srcCtx, tgtCtx });
		const tgtName = tgt.tenantDisplayName ?? tgt.tenantName ?? tgt.tenantId;
		if (!window.confirm(`This writes ${paths.join(", ")} into ${tgtName}. Continue?`)) return log("Transfer cancelled by user");

		const transferId = crypto.randomUUID();
		log("Transfer start", { transferId, kind, srcCtx, tgtCtx, paths, target: tgtName });

		try {
			const created = await op("mutate", "xmc.contentTransfer.createContentTransfer", {
				query: { sitecoreContextId: srcCtx },
				body: {
					transferId,
					configuration: {
						dataTrees: paths.map((itemPath) => ({ itemPath, scope: "SingleItem", mergeStrategy: "OverrideExistingItem" })),
					},
				},
			});
			logRes("createContentTransfer", created);

			let status: Any;
			for (let i = 1; i <= 40; i++) {
				status = await op("query", "xmc.contentTransfer.getContentTransferStatus", {
					path: { transferId },
					query: { sitecoreContextId: srcCtx },
				});
				logRes(`getContentTransferStatus #${i}`, status);
				const state = status?.data?.State;
				if (state === "Completed" || state === "Failed" || status?.error) break;
				await sleep(3000);
			}

			const chunkSets: Any[] = status?.data?.ChunkSetsMetadata ?? [];
			log("chunk sets", { count: chunkSets.length, chunkSets });

			let fileName: string | undefined;
			let lastChunksetId: string | undefined;
			let ok = true;
			for (const cs of chunkSets) {
				const chunksetId: string = cs.ChunkSetId ?? cs.ChunksetId;
				lastChunksetId = chunksetId;
				for (let chunkId = 0; chunkId < cs.ChunkCount; chunkId++) {
					const got = await op("query", "xmc.contentTransfer.getChunk", {
						path: { transferId, chunksetId, chunkId },
						query: { sitecoreContextId: srcCtx },
					});
					const h = got?.response?.headers;
					const header = (n: string) => h?.get?.(n) ?? null;
					const disposition: string | null = header("content-disposition");
					log(`getChunk ${chunksetId}/${chunkId}`, {
						dataTag: Object.prototype.toString.call(got?.data),
						size: got?.data?.size ?? null,
						byteLength: got?.data?.byteLength ?? null,
						"content-disposition": disposition,
						"content-type": header("content-type"),
						"content-length": header("content-length"),
						error: got?.error,
						response: got?.response,
					});
					if (got?.error || !(got?.data instanceof Blob)) {
						log(`getChunk ${chunksetId}/${chunkId} failed or data is not a Blob: skipping saveChunk, complete, consume and verify`);
						ok = false;
						break;
					}
					const isMedia = /IsMedia=true/i.test(disposition ?? "");
					const saved = await op("mutate", "xmc.contentTransfer.saveChunk", {
						path: { transferId, chunksetId, chunkId },
						query: { isMedia, sitecoreContextId: tgtCtx },
						body: got.data,
					});
					logRes(`saveChunk ${chunksetId}/${chunkId} (isMedia=${isMedia})`, saved);
				}
				if (!ok) break;
				const done = await op("mutate", "xmc.contentTransfer.completeChunkSetTransfer", {
					path: { transferId, chunksetId },
					query: { sitecoreContextId: tgtCtx },
				});
				logRes(`completeChunkSetTransfer ${chunksetId}`, done);
				fileName = done?.data?.ContentTransferFileName;
			}

			if (ok && lastChunksetId) {
				const consume = (name?: string) =>
					op("query", "xmc.contentTransfer.consumeFile", {
						query: { databaseName: "master", fileName: name, sitecoreContextId: tgtCtx },
					});
				let used = fileName;
				let consumed = await consume(used);
				logRes(`consumeFile fileName=${used}`, consumed);
				if (consumed?.error) {
					used = `contentTransfer-${transferId}-${lastChunksetId}.raif`;
					consumed = await consume(used);
					logRes(`consumeFile (retry) fileName=${used}`, consumed);
				}

				for (let i = 1; i <= 40; i++) {
					const bs = await op("query", "xmc.contentTransfer.getBlobState", {
						query: { fileName: used, sitecoreContextId: tgtCtx },
					});
					logRes(`getBlobState #${i}`, bs);
					await sleep(3000);
				}
			}
		} finally {
			logRes("deleteContentTransfer (source)", await op("mutate", "xmc.contentTransfer.deleteContentTransfer", {
				path: { transferId },
				query: { sitecoreContextId: srcCtx },
			}));
			logRes("deleteContentTransfer (target)", await op("mutate", "xmc.contentTransfer.deleteContentTransfer", {
				path: { transferId },
				query: { sitecoreContextId: tgtCtx },
			}));
			log("Transfer finished", { transferId });
		}
	};

	const run = (fn: () => Promise<void>) => async () => {
		setBusy(true);
		try {
			await fn();
		} catch (e) {
			log("UNCAUGHT", e);
		} finally {
			setBusy(false);
		}
	};

	const input = { padding: 4, marginRight: 8 } as const;
	return (
		<div style={{ padding: 20, fontFamily: "sans-serif", color: "#fff" }}>
			<h2>SDK spike (throwaway)</h2>
			<p>client: {client ? "ready" : "not ready"}</p>
			<div style={{ marginBottom: 12 }}>
				<button disabled={busy || !client} onClick={run(loadContext)}>Context</button>{" "}
				<button disabled={busy || !client} onClick={run(() => tree("preview"))}>Tree (preview)</button>{" "}
				<button disabled={busy || !client} onClick={run(() => tree("live"))}>Tree (live)</button>
			</div>
			<fieldset style={{ marginBottom: 12 }}>
				<legend>Test transfer</legend>
				<label>source index <input style={{ ...input, width: 50 }} type="number" value={srcIdx} onChange={(e) => setSrcIdx(+e.target.value)} /></label>
				<label>target index <input style={{ ...input, width: 50 }} type="number" value={tgtIdx} onChange={(e) => setTgtIdx(+e.target.value)} /></label>
				<label>context kind{" "}
					<select style={input} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
						<option value="preview">preview</option>
						<option value="live">live</option>
					</select>
				</label>
				<div style={{ marginTop: 8 }}>
					<label>item path <input style={{ ...input, width: 360 }} value={itemPath} onChange={(e) => setItemPath(e.target.value)} placeholder="/sitecore/content/..." /></label>
				</div>
				<div style={{ marginTop: 8 }}>
					<label>media item path (optional) <input style={{ ...input, width: 360 }} value={mediaPath} onChange={(e) => setMediaPath(e.target.value)} placeholder="/sitecore/media library/..." /></label>
				</div>
				<div style={{ marginTop: 8 }}>
					<button disabled={busy || !client} onClick={run(transfer)}>Run test transfer</button>
				</div>
			</fieldset>
			<div style={{ marginBottom: 8 }}>
				<button onClick={() => navigator.clipboard.writeText(out)}>Copy output</button>{" "}
				<button onClick={() => setOut("")}>Clear</button> {busy && "running..."}
			</div>
			<pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#111", padding: 12, maxHeight: "60vh", overflow: "auto" }}>{out}</pre>
		</div>
	);
}
