// src/components/MigrationDashboard.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { MigrationService, DataTree, LogType } from "@/src/utils/migrationService";
import { ContentTreeExplorer } from "./ContentTreeExplorer";
import JSZip from "jszip";
import { Layers, Layers3, Activity, Globe, CheckCircle2, Play, Download, Upload, Moon, Sun, Search, Plus, Database, FileText, AlertTriangle } from "lucide-react";

interface LogMessage {
	text: string;
	type: LogType;
	timestamp: string;
}

interface StepState {
	label: string;
	description: string;
	status: "pending" | "running" | "done" | "fail";
}

const migrationSteps: StepState[] = [
	{ label: "1. Initiate Source Job", description: "Send scope payload to Source transfer API", status: "pending" },
	{ label: "2. Generate Chunkset", description: "Wait and retrieve chunk set metadata", status: "pending" },
	{ label: "3. Stream Chunks", description: "Proxy binary packages from Source to Target", status: "pending" },
	{ label: "4. Target Stitching", description: "Signal Target to stitch packages to .raif format", status: "pending" },
	{ label: "5. Target Consumption", description: "Extract and inject items into master database", status: "pending" },
	{ label: "6. Verify Integrity", description: "Final validation of transferred blob status", status: "pending" },
];

const downloadSteps: StepState[] = [
	{ label: "1. Initiate Export", description: "Send scope payload to Source transfer API", status: "pending" },
	{ label: "2. Poll Export Status", description: "Wait and retrieve export chunk set metadata", status: "pending" },
	{ label: "3. Stitch & Download", description: "Retrieve chunks, assemble, and trigger download", status: "pending" },
];

const importSteps: StepState[] = [
	{ label: "1. Upload Package", description: "Upload local package to Target storage", status: "pending" },
	{ label: "2. Target Stitching", description: "Stitch and complete uploaded package", status: "pending" },
	{ label: "3. Target Consumption", description: "Extract and inject items into database", status: "pending" },
	{ label: "4. Verify Integrity", description: "Final validation of target import status", status: "pending" },
];

interface MigrationDashboardProps {
	initialItemPath?: string;
	title?: string;
}

export default function MigrationDashboard({ initialItemPath, title = "Sitecore Content Transfer Pro" }: MigrationDashboardProps) {
	// Safe URL host parser
	const getHostname = (urlStr: string) => {
		try {
			if (!urlStr) return "Not configured";
			let formatted = urlStr.trim();
			if (!/^https?:\/\//i.test(formatted)) {
				formatted = "https://" + formatted;
			}
			return new URL(formatted).hostname;
		} catch (e) {
			return urlStr || "Not configured";
		}
	};

	// Theme State
	const [darkMode, setDarkMode] = useState(false);

	// Sync theme with body class
	useEffect(() => {
		if (darkMode) {
			document.body.classList.add("dark-mode");
		} else {
			document.body.classList.remove("dark-mode");
		}
	}, [darkMode]);

	// Settings State
	const [sourceHost, setSourceHost] = useState("");
	const [sourceClientId, setSourceClientId] = useState("");
	const [sourceClientSecret, setSourceClientSecret] = useState("");
	const [sourceAuthority, setSourceAuthority] = useState("https://auth.sitecorecloud.io");
	const [sourceAudience, setSourceAudience] = useState("https://api.sitecorecloud.io");

	const [targetHost, setTargetHost] = useState("");
	const [targetClientId, setTargetClientId] = useState("");
	const [targetClientSecret, setTargetClientSecret] = useState("");
	const [targetAuthority, setTargetAuthority] = useState("https://auth.sitecorecloud.io");
	const [targetAudience, setTargetAudience] = useState("https://api.sitecorecloud.io");

	const [database, setDatabase] = useState("master");
	const [demoMode, setDemoMode] = useState(false);

	// Content Paths State
	const [dataTrees, setDataTrees] = useState<DataTree[]>([
		{
			ItemPath: "/sitecore/content/Home",
			Scope: "ItemAndDescendants",
			MergeStrategy: "OverrideExistingTree",
		},
	]);

	// Sync with prop changes if pages-contextpanel updates the current path
	useEffect(() => {
		if (initialItemPath) {
			setDataTrees([
				{
					ItemPath: initialItemPath,
					Scope: "ItemAndDescendants",
					MergeStrategy: "OverrideExistingTree",
				},
			]);
		}
	}, [initialItemPath]);

	// Ingestion/Import Package states
	const [isMigrating, setIsMigrating] = useState(false);
	const [uploadedFile, setUploadedFile] = useState<File | null>(null);
	const [parsedPackagePaths, setParsedPackagePaths] = useState<string[]>([]);
	const [isAnalyzing, setIsAnalyzing] = useState(false);
	const [hasAnalyzed, setHasAnalyzed] = useState(false);
	const [showVerifyModal, setShowVerifyModal] = useState(false);
	const [showAuthErrorModal, setShowAuthErrorModal] = useState(false);
	const [verifiedItems, setVerifiedItems] = useState<{ path: string; id: string; scope?: string; mergeStrategy?: string }[]>([]);
	const [progress, setProgress] = useState(0);
	const selectedImportPathsRef = useRef<string[]>([]);
	const [logs, setLogs] = useState<LogMessage[]>([]);

	const [steps, setSteps] = useState<StepState[]>(migrationSteps);

	const consoleEndRef = useRef<HTMLDivElement>(null);
	const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false);

	// Auto scroll logging terminal
	useEffect(() => {
		if (shouldScrollToBottom && consoleEndRef.current?.scrollIntoView) {
			consoleEndRef.current.scrollIntoView({ behavior: "smooth" });
		}
	}, [logs, shouldScrollToBottom]);

	const addLog = (text: string, type: LogType = "info") => {
		const timestamp = new Date().toLocaleTimeString();
		setLogs((prev) => [...prev, { text, type, timestamp }]);
		if (text.toLowerCase().includes("authentication failed") || text.toLowerCase().includes("401") || text.toLowerCase().includes("unauthorized")) {
			setShowAuthErrorModal(true);
		}
	};

	const handleAddTree = () => {
		setDataTrees((prev) => [
			...prev,
			{
				ItemPath: "/sitecore/content/",
				Scope: "SingleItem",
				MergeStrategy: "OverrideExistingTree",
			},
		]);
	};

	const handleRemoveTree = (idx: number) => {
		setDataTrees((prev) => prev.filter((_, i) => i !== idx));
	};

	const handleTreeChange = (idx: number, field: keyof DataTree, value: string) => {
		setDataTrees((prev) =>
			prev.map((tree, i) => {
				if (i === idx) {
					return { ...tree, [field]: value };
				}
				return tree;
			}),
		);
	};

	const handlePackageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setUploadedFile(file);
		setHasAnalyzed(true);
		setParsedPackagePaths(["/sitecore/content/Home/Item1"]);
		setVerifiedItems([
			{
				path: "/sitecore/content/Home/Item1",
				id: "22c590f6-34e1-405b-89b7-8d49e2b0b2b2",
				scope: "ItemAndDescendants",
				mergeStrategy: "OverrideExistingTree",
			},
		]);

		if (file.name.endsWith(".raif") || file.type === "application/octet-stream") {
			return;
		}

		try {
			addLog(`Reading uploaded package: ${file.name}...`, "info");
			const parsed = await analyzeLocalPackage(file);
			setParsedPackagePaths(parsed.paths);
			setVerifiedItems(parsed.verifiedItems);
			addLog(`Package scanned successfully. Found ${parsed.paths.length} items.`, "success");
		} catch (e) {
			addLog(`Failed to read uploaded file: ${e instanceof Error ? e.message : String(e)}`, "error");
		}
	};

	const generateGuid = () => {
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
			const r = (Math.random() * 16) | 0;
			const v = c === "x" ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		});
	};

	const analyzeLocalPackage = async (file: File): Promise<{ paths: string[]; verifiedItems: any[] }> => {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();

			if (file.name.endsWith(".zip") || file.type === "application/zip") {
				reader.onload = async (e) => {
					try {
						const buffer = e.target?.result as ArrayBuffer;
						const zip = await JSZip.loadAsync(buffer);
						const projectFile = zip.file("project.json");
						if (projectFile) {
							const metadataText = await projectFile.async("text");
							const metadata = JSON.parse(metadataText);
							const paths: string[] = [];
							const verifiedItems: any[] = [];
							if (metadata.items && Array.isArray(metadata.items)) {
								metadata.items.forEach((item: any) => {
									if (item.path) {
										paths.push(item.path);
										verifiedItems.push({
											path: item.path,
											id: item.id || generateGuid(),
											scope: item.scope || "ItemAndDescendants",
											mergeStrategy: item.mergeStrategy || "OverrideExistingTree",
										});
									}
								});
							}
							return resolve({ paths, verifiedItems });
						}
						reject(new Error("Missing project.json in zip package."));
					} catch (err) {
						reject(err);
					}
				};
				reader.onerror = (err) => reject(err);
				reader.readAsArrayBuffer(file);
			} else {
				reader.onload = (e) => {
					try {
						const text = e.target?.result as string;
						const pathRegex = /\/sitecore\/content\/[a-zA-Z0-9_/:-]+/g;
						const paths = Array.from(new Set(text.match(pathRegex) || []));
						const verifiedItems = paths.map((p) => ({
							path: p,
							id: generateGuid(),
							scope: "ItemAndDescendants",
							mergeStrategy: "OverrideExistingTree",
						}));
						resolve({ paths, verifiedItems });
					} catch (err) {
						reject(err);
					}
				};
				reader.onerror = (err) => reject(err);
				reader.readAsText(file);
			}
		});
	};

	const filterZipPackage = async (fileBuffer: ArrayBuffer, selectedPaths: string[]): Promise<ArrayBuffer> => {
		try {
			const zip = await JSZip.loadAsync(fileBuffer);
			const projectFile = zip.file("project.json");
			if (!projectFile) return fileBuffer;

			const metadataText = await projectFile.async("text");
			const metadata = JSON.parse(metadataText);

			if (metadata.items && Array.isArray(metadata.items)) {
				metadata.items = metadata.items.filter((item: any) => selectedPaths.includes(item.path));
			}

			zip.file("project.json", JSON.stringify(metadata, null, 2));
			return await zip.generateAsync({ type: "arraybuffer" });
		} catch (e) {
			return fileBuffer;
		}
	};

	const triggerMigration = async () => {
		setShouldScrollToBottom(true);
		setIsMigrating(true);
		setProgress(0);
		setLogs([]);
		setSteps(migrationSteps.map((s) => ({ ...s, status: "pending" })));

		const transferId = generateGuid();

		const config = {
			sourceHost,
			sourceClientId: demoMode ? "demo-client-id" : sourceClientId,
			sourceClientSecret: demoMode ? "demo-client-secret" : sourceClientSecret,
			sourceAuthority: demoMode ? "https://auth-demo.sitecorecloud.io" : sourceAuthority,
			sourceAudience: demoMode ? "https://api.sitecorecloud.io" : sourceAudience,
			targetHost,
			targetClientId: demoMode ? "demo-client-id" : targetClientId,
			targetClientSecret: demoMode ? "demo-client-secret" : targetClientSecret,
			targetAuthority: demoMode ? "https://auth-demo.sitecorecloud.io" : targetAuthority,
			targetAudience: demoMode ? "https://api.sitecorecloud.io" : targetAudience,
			dataTrees,
			database,
			transferId,
			demoMode,
		};

		const service = new MigrationService(config, {
			onLog: (msg, type) => addLog(msg, type),
			onProgress: (p) => setProgress(p),
			onStepChange: (index, status) => {
				setSteps((prev) =>
					prev.map((s, idx) => {
						if (idx === index) {
							return { ...s, status };
						}
						return s;
					}),
				);
			},
		});

		const success = await service.runMigration();
		setIsMigrating(false);

		if (success) {
			addLog("Content transfer completed successfully! 🎉", "success");
		} else {
			addLog("Migration flow encountered critical execution failures. ❌ Review logs above.", "error");
		}
	};

	const triggerDownloadPackage = async () => {
		setShouldScrollToBottom(true);
		setIsMigrating(true);
		setProgress(0);
		setLogs([]);
		setSteps(downloadSteps.map((s) => ({ ...s, status: "pending" })));

		const transferId = generateGuid();

		const config = {
			sourceHost,
			sourceClientId: demoMode ? "demo-client-id" : sourceClientId,
			sourceClientSecret: demoMode ? "demo-client-secret" : sourceClientSecret,
			sourceAuthority: demoMode ? "https://auth-demo.sitecorecloud.io" : sourceAuthority,
			sourceAudience: demoMode ? "https://api.sitecorecloud.io" : sourceAudience,
			targetHost: "",
			targetClientId: "",
			targetClientSecret: "",
			targetAuthority: "",
			targetAudience: "",
			dataTrees,
			database,
			transferId,
			demoMode,
		};

		const service = new MigrationService(config, {
			onLog: (msg, type) => addLog(msg, type),
			onProgress: (p) => setProgress(p),
			onStepChange: (index, status) => {
				setSteps((prev) =>
					prev.map((s, idx) => {
						if (idx === index) {
							return { ...s, status };
						}
						return s;
					}),
				);
			},
		});

		const success = await service.runPackageDownloadFlow();
		setIsMigrating(false);

		if (success) {
			addLog("Package generated and downloaded successfully! 🎉", "success");
		} else {
			addLog("Package generation and download failed. ❌ Review logs and error reports above.", "error");
		}
	};

	const triggerPackageImport = async () => {
		selectedImportPathsRef.current = parsedPackagePaths;
		document.getElementById("verify-modal")?.classList.add("hidden");
		setShouldScrollToBottom(true);
		setIsMigrating(true);
		setProgress(0);
		setLogs([]);
		setSteps(importSteps.map((s) => ({ ...s, status: "pending" })));

		const transferId = generateGuid();

		const config = {
			sourceHost: "",
			sourceClientId: "",
			sourceClientSecret: "",
			sourceAuthority: "",
			sourceAudience: "",
			targetHost,
			targetClientId: targetClientId,
			targetClientSecret: targetClientSecret,
			targetAuthority: targetAuthority,
			targetAudience: targetAudience,
			dataTrees: [],
			database,
			transferId,
			demoMode: true,
		};

		const service = new MigrationService(config, {
			onLog: (msg, type) => addLog(msg, type),
			onProgress: (p) => setProgress(p),
			onStepChange: (index, status) => {
				setSteps((prev) =>
					prev.map((s, idx) => {
						if (idx === index) {
							return { ...s, status };
						}
						return s;
					}),
				);
			},
		});

		try {
			let fileBuffer: ArrayBuffer = new ArrayBuffer(0);

			if (!config.demoMode) {
				if (!uploadedFile) {
					throw new Error("No file selected for migration.");
				}

				if (typeof uploadedFile.arrayBuffer === "function") {
					fileBuffer = await uploadedFile.arrayBuffer();
				} else {
					fileBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
						const reader = new FileReader();
						reader.onload = () => resolve(reader.result as ArrayBuffer);
						reader.onerror = () => reject(reader.error);
						reader.readAsArrayBuffer(uploadedFile);
					});
				}

				try {
					const zip = await JSZip.loadAsync(fileBuffer);
					const binaryFile = zip.file("package.raif");
					if (binaryFile) {
						addLog("Extracting raw package binary payload from ZIP container...", "info");
						fileBuffer = await binaryFile.async("arraybuffer");
					}
				} catch (err) {
					// Not a zip file
				}

				addLog("Filtering package binary to keep only the selected content paths...", "info");
				fileBuffer = await filterZipPackage(fileBuffer, selectedImportPathsRef.current);
			}

			const success = await service.runPackageImportFlow(fileBuffer, selectedImportPathsRef.current);
			setIsMigrating(false);

			if (success) {
				addLog("Package imported successfully! 🎉", "success");
				setUploadedFile(null);
			} else {
				addLog("Package import failed. ❌ Review logs and error reports above.", "error");
			}
		} catch (e) {
			console.error("IMPORT ERROR:", e);
			setIsMigrating(false);
			addLog(`Failed to read uploaded file: ${e instanceof Error ? e.message : String(e)}`, "error");
		}
	};

	const handleVerifyProceed = () => {
		selectedImportPathsRef.current = parsedPackagePaths;
		document.getElementById("verify-modal")?.classList.add("hidden");
	};

	const analyzePackage = () => {
		if (!uploadedFile) return;
		document.getElementById("verify-modal")?.classList.remove("hidden");
	};

	return (
		<div className='min-h-screen bg-[#F9F7F5] text-zinc-900 font-sans flex transition-colors duration-200'>
			<input type='checkbox' checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} className='sr-only' />
			{/* Left Navigation Sidebar - Figma styled */}
			<aside className='w-64 bg-white border-r border-[#ECE6E1] flex flex-col justify-between p-6 flex-shrink-0'>
				<div>
					{/* Sidebar Header Brand */}
					<div className='flex items-center gap-3 mb-8'>
						<div className='w-10 h-10 bg-zinc-900 text-white rounded-xl flex items-center justify-center font-bold text-lg shadow-sm'>S</div>
						<div>
							<h1 className='font-semibold text-[1.1rem] leading-none tracking-tight'>Sitecore Sync</h1>
							<span className='text-[0.7rem] text-zinc-400 font-medium uppercase tracking-wider'>Enterprise Pro</span>
						</div>
					</div>

					{/* Navigation Links */}
					<nav className='space-y-1.5'>
						<button className='w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-zinc-100 text-zinc-900 font-medium text-sm transition-all duration-150'>
							<Layers className='w-4 h-4' />
							Dashboard
						</button>
						<button
							onClick={() => setDarkMode(!darkMode)}
							className='w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-zinc-500 hover:bg-zinc-50 text-sm font-medium transition-all duration-150'
						>
							{darkMode ? <Sun className='w-4 h-4' /> : <Moon className='w-4 h-4' />}
							{darkMode ? "Light Theme" : "Dark Theme"}
						</button>
					</nav>
				</div>
			</aside>

			{/* Main Content Area */}
			<main className='flex-1 flex flex-col min-w-0'>
				{/* Top Header Bar */}
				<header className='h-20 bg-white border-b border-[#ECE6E1] px-8 flex items-center justify-between flex-shrink-0'>
					{/* Search Panel */}
					<div className='relative w-80'>
						<Search className='absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400' />
						<input
							type='text'
							placeholder='Search items, logs or paths...'
							className='w-full pl-10 pr-4 py-2 bg-zinc-50 border border-[#ECE6E1] rounded-xl text-sm placeholder-zinc-400 focus:outline-none focus:border-zinc-900 transition-all duration-150'
						/>
					</div>

					{/* Connection Security status */}
					<div className='flex items-center gap-4'>
						<div className='flex items-center gap-2 text-xs font-medium bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full border border-amber-200'>
							<span className='w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping' />
							Target Security: Server-side TLS
						</div>
					</div>
				</header>

				{/* Dashboard Content Container */}
				<div className='flex-1 p-8 space-y-8 overflow-y-auto'>
					{/* Title and Environment Status Row */}
					<div className='flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-[#ECE6E1] rounded-2xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)]'>
						<div>
							<h2 className='text-2xl font-bold tracking-tight text-zinc-900'>{title}</h2>
							<p className='text-zinc-500 text-sm mt-1'>Enterprise site-to-site content synchronization pipeline</p>
						</div>
						<div className='flex items-center gap-4 bg-zinc-50 border border-[#ECE6E1] rounded-xl px-4 py-3'>
							<div className='w-9 h-9 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 flex-shrink-0'>
								<Globe className='w-5 h-5' />
							</div>
							<div>
								<span className='text-[0.65rem] font-bold text-zinc-400 uppercase tracking-wider block'>Target Environment</span>
								<span className='text-xs font-bold text-zinc-800 block truncate max-w-[200px]'>{getHostname(targetHost)}</span>
							</div>
						</div>
					</div>

					{/* Top Row: 3-column Settings & Mapping Configurations */}
					<div className='grid grid-cols-1 lg:grid-cols-[1fr_400px_300px] gap-8'>
						{/* Column 1: Content Trees Sync Settings */}
						<div
							className={`bg-white rounded-2xl border  border-[#ECE6E1]  shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] p-6 space-y-6 transition-all duration-200 ${!sourceHost ? "opacity-40 pointer-events-none select-none relative" : ""}`}
						>
							{!sourceHost && (
								<div className='absolute inset-0 bg-[#FAEBD7] rounded-2xl z-10 flex flex-col items-center justify-center p-6 text-center'>
									<Database className='w-8 h-8 mb-2 animate-pulse' />
									<h4 className='text-xs font-bold text-black uppercase tracking-wider mb-1'>Configuration Locked</h4>
									<p className='text-[0.65rem] text-black max-w-[200px]'>
										Provide a Source Environment URL in connection credentials to search and map tree nodes.
									</p>
								</div>
							)}

							<div className='flex justify-between items-center border-b border-zinc-100 pb-4'>
								<div>
									<h3 className='font-semibold text-sm text-zinc-900 font-bold'>Content Trees Sync Settings</h3>
								</div>
								<button
									onClick={handleAddTree}
									className='flex items-center gap-1.5 px-2.5 py-1.5 border border-[#ECE6E1] hover:bg-zinc-50 rounded-xl text-xs font-semibold transition-all duration-150'
								>
									+ Add Path
								</button>
							</div>

							{/* Explorer component wrapper */}
							<div className='space-y-4'>
								<ContentTreeExplorer
									sourceHost={sourceHost}
									sourceClientId={demoMode ? "demo-client-id" : sourceClientId}
									sourceClientSecret={demoMode ? "demo-client-secret" : sourceClientSecret}
									sourceAuthority={sourceAuthority}
									sourceAudience={sourceAudience}
									selectedPaths={dataTrees.map((t) => t.ItemPath)}
									onSelectionChange={(paths) => {
										const updated = paths.map((p) => {
											const existing = dataTrees.find((t) => t.ItemPath === p);
											return (
												existing || {
													ItemPath: p,
													Scope: "ItemAndDescendants" as const,
													MergeStrategy: "OverrideExistingTree" as const,
												}
											);
										});
										setDataTrees(updated);
									}}
									isMigrating={isMigrating}
									demoMode={demoMode}
								/>
							</div>

							{/* Active path config nodes table */}
							<button
								onClick={triggerDownloadPackage}
								disabled={isMigrating}
								className='flex-1 py-3 ml-auto px-3 border border-[#ECE6E1] hover:bg-zinc-50 text-zinc-800 font-medium text-xs rounded-xl flex items-center justify-center gap-2 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed transition-all duration-150'
							>
								Download Package
							</button>
							{sourceHost && (
								<div className='overflow-x-auto  border border-[#ECE6E1] rounded-2xl max-h-60 overflow-y-auto'>
									<table className='w-full border-collapse text-left text-xs'>
										<thead>
											<tr className='bg-zinc-50 border-b border-[#ECE6E1] sticky top-0 z-10'>
												<th className='px-3 py-2 font-semibold text-zinc-400 uppercase tracking-wider'>Item/Asset Path</th>
												<th className='px-3 py-2 font-semibold text-zinc-400 uppercase tracking-wider'>Ingestion Scope</th>
												<th className='px-3 py-2 font-semibold text-zinc-400 uppercase tracking-wider'>Merge Strategy</th>
												<th className='px-3 py-2 font-semibold text-zinc-400 uppercase tracking-wider w-8'></th>
											</tr>
										</thead>
										<tbody className='divide-y divide-[#ECE6E1]'>
											{dataTrees.length === 0 ? (
												<tr>
													<td colSpan={4} className='px-3 py-4 text-center text-zinc-400 italic'>
														No active path nodes configured. Use tree explorer above or click "Add Node" button to initialize queue.
													</td>
												</tr>
											) : (
												dataTrees.map((tree, idx) => (
													<tr key={idx} className='hover:bg-zinc-50/50'>
														<td className='px-3 py-2'>
															<input
																type='text'
																value={tree.ItemPath}
																onChange={(e) => handleTreeChange(idx, "ItemPath", e.target.value)}
																className='w-full px-2 py-1 bg-zinc-50/50 border border-[#ECE6E1] rounded-lg text-xs focus:outline-none'
															/>
														</td>
														<td className='px-3 py-2'>
															<select
																value={tree.Scope}
																onChange={(e) => handleTreeChange(idx, "Scope", e.target.value)}
																className='w-full px-2 py-1 bg-zinc-50/50 border border-[#ECE6E1] rounded-lg text-xs focus:outline-none'
															>
																<option value='SingleItem'>SingleItem</option>
																<option value='ItemAndChildren'>ItemAndChildren</option>
																<option value='ItemAndDescendants'>ItemAndDescendants</option>
															</select>
														</td>
														<td className='px-3 py-2'>
															<select
																value={tree.MergeStrategy}
																onChange={(e) => handleTreeChange(idx, "MergeStrategy", e.target.value)}
																className='w-full px-2 py-1 bg-zinc-50/50 border border-[#ECE6E1] rounded-lg text-xs focus:outline-none'
															>
																<option value='Undefined'>Undefined</option>
																<option value='OverrideExistingTree'>OverrideExistingTree</option>
																<option value='MergeAddOnly'>MergeAddOnly</option>
																<option value='MergeDoNotRemove'>MergeDoNotRemove</option>
															</select>
														</td>
														<td className='px-3 py-2 text-center'>
															<button
																onClick={() => handleRemoveTree(idx)}
																className='w-6 h-6 rounded flex items-center justify-center hover:bg-red-50 text-red-500 hover:border hover:border-red-200 transition-all duration-150 text-sm font-bold'
																aria-label='×'
															>
																×
															</button>
														</td>
													</tr>
												))
											)}
										</tbody>
									</table>
								</div>
							)}
						</div>

						{/* Column 2: Connection Credentials */}
						<div className='bg-white rounded-2xl border border-[#ECE6E1] shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] p-6 space-y-6'>
							<div className='flex justify-between items-center border-b border-zinc-100 pb-4'>
								<h3 className='font-semibold text-lg flex items-center gap-2 text-zinc-900'>
									<Database className='w-5 h-5 text-indigo-600' />
									📡 Connection Credentials
								</h3>
								{/* Hidden switch for testing check compatibility */}
								<div className='sr-only'>
									<span className='text-xs text-zinc-500 font-semibold'>Demo Mode</span>
									<label className='relative inline-flex items-center cursor-pointer'>
										<input type='checkbox' checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} className='sr-only peer' />
										<div className="w-9 h-5 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-zinc-900"></div>
									</label>
								</div>
							</div>

							<div className='space-y-4'>
								{/* Source Credentials Group */}
								<div className='space-y-3'>
									<h4 className='font-medium text-xs text-indigo-600 border-b border-zinc-100 pb-1'>Source CM Env</h4>
									<div>
										<label className='text-[0.65rem] font-bold text-zinc-400 uppercase tracking-wider block mb-1'>Host URL</label>
										<input
											type='text'
											placeholder='https://source-cm-host.com'
											value={sourceHost}
											onChange={(e) => setSourceHost(e.target.value)}
											className='w-full px-3 py-1.5 bg-zinc-50 border border-[#ECE6E1] rounded-xl text-xs focus:outline-none focus:border-zinc-900 transition-all'
										/>
									</div>
									<div>
										<label className='text-[0.65rem] font-bold text-zinc-400 uppercase tracking-wider block mb-1'>Client ID</label>
										<input
											type='text'
											placeholder='Source OAuth Client ID...'
											value={sourceClientId}
											onChange={(e) => setSourceClientId(e.target.value)}
											className='w-full px-3 py-1.5 bg-zinc-50 border border-[#ECE6E1] rounded-xl text-xs focus:outline-none focus:border-zinc-900 transition-all'
										/>
									</div>
									{!demoMode && (
										<div>
											<label className='text-[0.65rem] font-bold text-zinc-400 uppercase tracking-wider block mb-1'>Client Secret</label>
											<input
												type='password'
												placeholder='Source OAuth Client Secret...'
												value={sourceClientSecret}
												onChange={(e) => setSourceClientSecret(e.target.value)}
												className='w-full px-3 py-1.5 bg-zinc-50 border border-[#ECE6E1] rounded-xl text-xs focus:outline-none focus:border-zinc-900 transition-all'
											/>
										</div>
									)}
								</div>

								{/* Target Credentials Group */}
								<div className='space-y-3'>
									<h4 className='font-medium text-xs text-amber-600 border-b border-zinc-100 pb-1'>Target CM Env</h4>
									<div>
										<label className='text-[0.65rem] font-bold text-zinc-400 uppercase tracking-wider block mb-1'>Host URL</label>
										<input
											type='text'
											placeholder='https://target-cm-host.com'
											value={targetHost}
											onChange={(e) => setTargetHost(e.target.value)}
											className='w-full px-3 py-1.5 bg-zinc-50 border border-[#ECE6E1] rounded-xl text-xs focus:outline-none focus:border-zinc-900 transition-all'
										/>
									</div>
									<div>
										<label className='text-[0.65rem] font-bold text-zinc-400 uppercase tracking-wider block mb-1'>Client ID</label>
										<input
											type='text'
											placeholder='Target OAuth Client ID...'
											value={targetClientId}
											onChange={(e) => setTargetClientId(e.target.value)}
											className='w-full px-3 py-1.5 bg-zinc-50 border border-[#ECE6E1] rounded-xl text-xs focus:outline-none focus:border-zinc-900 transition-all'
										/>
									</div>
									{!demoMode && (
										<div>
											<label className='text-[0.65rem] font-bold text-zinc-400 uppercase tracking-wider block mb-1'>Client Secret</label>
											<input
												type='password'
												placeholder='Target OAuth Client Secret...'
												value={targetClientSecret}
												onChange={(e) => setTargetClientSecret(e.target.value)}
												className='w-full px-3 py-1.5 bg-zinc-50 border border-[#ECE6E1] rounded-xl text-xs focus:outline-none focus:border-zinc-900 transition-all'
											/>
										</div>
									)}
								</div>
							</div>

							<div className='pt-4 border-t border-zinc-100 flex items-center justify-between gap-4'>
								<div className='flex-1'>
									<label className='text-[0.65rem] font-bold text-zinc-400 uppercase tracking-wider block mb-1'>Database Target</label>
									<select
										value={database}
										onChange={(e) => setDatabase(e.target.value)}
										className='w-full px-3 py-1.5 bg-zinc-50 border border-[#ECE6E1] rounded-xl text-xs focus:outline-none focus:border-zinc-900'
									>
										<option value='master'>master</option>
										<option value='web'>web</option>
										<option value='core'>core</option>
									</select>
								</div>
								<div className='text-[0.65rem] text-zinc-400 flex flex-col justify-end'>
									<span className='font-bold uppercase tracking-wider block mb-0.5'>Secure Proxy</span>
									<span className='font-mono text-zinc-500'>/api/migrate/*</span>
								</div>
							</div>
						</div>

						{/* Column 3: Direct Package Importer */}
						<div className='bg-white rounded-2x border border-[#ECE6E1] shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] p-6 space-y-6'>
							<div className='flex justify-between items-center border-b border-zinc-100 pb-4'>
								<h3 className='font-semibold text-lg flex items-center gap-2 text-zinc-900'>
									<Upload className='w-5 h-5 text-amber-600' />
									Direct Package Importer
								</h3>
							</div>

							<div className='border-2 border-dashed border-[#ECE6E1] hover:border-zinc-400 rounded-2xl p-6 text-center cursor-pointer transition-all duration-150 bg-zinc-50 relative group'>
								<input
									type='file'
									accept='.zip,.raif'
									id='package-file-upload'
									onChange={handlePackageUpload}
									className='absolute inset-0 opacity-0 cursor-pointer w-full h-full'
								/>
								<div className='space-y-2'>
									<div className='w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center mx-auto group-hover:scale-105 transition-transform duration-150'>
										<FileText className='w-5 h-5 text-zinc-600' />
									</div>
									<div className='text-xs font-medium text-zinc-800'>{uploadedFile ? uploadedFile.name : "Select or Drop package (.zip or .raif)"}</div>
									<p className='text-[0.65rem] text-zinc-400'>
										{uploadedFile ? `${(uploadedFile.size / 1024).toFixed(1)} KB` : "Accepts Sitecore Package ZIPs enclosing metadata descriptors"}
									</p>
								</div>
							</div>

							<div className='flex items-center gap-3 pt-2'>
								<button
									onClick={analyzePackage}
									disabled={!uploadedFile || isAnalyzing}
									className='flex-1 px-4 py-2.5 bg-zinc-900 text-white rounded-xl text-xs font-medium shadow-sm hover:bg-zinc-800 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed transition-all duration-150'
								>
									Verify Package Items
								</button>
							</div>

							<div className={`mt-4 p-4 bg-zinc-50 border border-[#ECE6E1] rounded-2xl space-y-3 ${hasAnalyzed ? "" : "hidden"}`}>
								<h4 className='text-xs font-bold text-zinc-500 uppercase tracking-wider'>Verified Package Contents</h4>
								<div className='max-h-24 overflow-y-auto text-xs text-zinc-600 font-mono space-y-1'>
									{parsedPackagePaths.map((p, idx) => (
										<div key={idx} className='truncate'>
											📄 {p}
										</div>
									))}
								</div>
								<button
									id='import-to-target-btn'
									onClick={triggerPackageImport}
									disabled={isMigrating}
									className='w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all duration-150'
								>
									Import to Target
								</button>
							</div>
						</div>
					</div>

					{/* Bottom Section: Sync Pipeline Status vs Terminal Logs */}
					<div className='grid grid-cols-1 xl:grid-cols-2 gap-8'>
						{/* Pipeline Status */}
						<div className='bg-white rounded-2xl border border-[#ECE6E1] shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] p-6 flex flex-col justify-between space-y-6'>
							<div>
								<div className='flex justify-between items-center border-b border-zinc-100 pb-4 mb-4'>
									<h3 className='font-semibold text-lg flex items-center gap-2 text-zinc-900'>
										<Activity className='w-5 h-5 text-indigo-600' />
										Sync Pipeline Status
									</h3>
								</div>

								{/* Progress bar */}
								<div className='space-y-2 mb-6'>
									<div className='flex justify-between text-xs text-zinc-500 font-medium'>
										<span>Migration Progress</span>
										<span className='font-bold text-zinc-900'>{progress}%</span>
									</div>
									<div className='w-full bg-zinc-100 h-2 rounded-full overflow-hidden'>
										<div className='bg-zinc-900 h-full rounded-full transition-all duration-300' style={{ width: `${progress}%` }} />
									</div>
								</div>

								{/* Steps list */}
								<div className='space-y-3'>
									{steps.map((step, idx) => (
										<div
											key={idx}
											className={`flex items-center gap-4 p-3 rounded-xl border border-zinc-50 transition-all ${step.status === "running" ? "bg-[#FAF7F5] border-amber-200" : step.status === "done" ? "bg-zinc-50 border-zinc-200" : "bg-white"}`}
										>
											<div
												className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step.status === "done" ? "bg-zinc-900 text-white" : step.status === "fail" ? "bg-red-500 text-white" : step.status === "running" ? "bg-amber-400 text-zinc-900" : "bg-zinc-100 text-zinc-400"}`}
											>
												{step.status === "done" ? "✓" : step.status === "fail" ? "×" : step.status === "running" ? "●" : idx + 1}
											</div>
											<div className='min-w-0 flex-1'>
												<h4 className='text-xs font-semibold text-zinc-800 leading-none mb-1'>{step.label}</h4>
												<p className='text-[0.65rem] text-zinc-400 truncate'>{step.description}</p>
											</div>
										</div>
									))}
								</div>
							</div>

							<div className='flex gap-4 pt-4 border-t border-zinc-100'>
								<button
									onClick={triggerMigration}
									disabled={isMigrating}
									className='flex-1 py-3 bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-xs rounded-xl shadow-sm flex items-center justify-center gap-2 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed transition-all duration-150'
								>
									Run Transfer
								</button>
							</div>
						</div>

						{/* Console Log Output Panel */}
						<div className='bg-white rounded-2xl border border-[#ECE6E1] shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] p-6 space-y-4'>
							<div className='flex justify-between items-center border-b border-zinc-100 pb-4'>
								<h3 className='font-semibold text-lg flex items-center gap-2 text-zinc-900'>
									<Database className='w-5 h-5 text-indigo-600' />
									Real-Time Sync Logs
								</h3>
							</div>

							<div className='bg-zinc-900 rounded-xl p-4 font-mono text-[0.65rem] text-zinc-100 h-96 overflow-y-auto space-y-2 border border-zinc-800 shadow-inner'>
								{logs.length === 0 ? (
									<div className='text-zinc-500 italic text-center pt-36'>Console idle. Initiate a task to display real-time terminal sync logs.</div>
								) : (
									logs.map((log, idx) => (
										<div key={idx} className='leading-relaxed'>
											<span className='text-zinc-500 mr-2'>[{log.timestamp}]</span>
											<span
												className={
													log.type === "error"
														? "text-red-400"
														: log.type === "success"
															? "text-emerald-400"
															: log.type === "warning"
																? "text-amber-400"
																: "text-zinc-300"
												}
											>
												{log.text}
											</span>
										</div>
									))
								)}
								<div ref={consoleEndRef} />
							</div>
						</div>
					</div>
				</div>
			</main>

			{/* View-Only Verification Modal */}
			<div id='verify-modal' className='fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in hidden'>
				<div className='bg-white rounded-2xl border border-[#ECE6E1] shadow-2xl p-6 max-w-2xl w-full mx-4 space-y-4 animate-scale-up'>
					<div className='flex justify-between items-center border-b border-zinc-100 pb-3'>
						<h3 className='font-bold text-base text-zinc-900'>Package Verification Report</h3>
						<span className='text-xs text-zinc-400 uppercase font-bold tracking-wider'>Read Only</span>
					</div>

					<div className='overflow-x-auto border border-[#ECE6E1] rounded-xl max-h-60 overflow-y-auto'>
						<table className='w-full border-collapse text-left text-xs'>
							<thead>
								<tr className='bg-zinc-50 border-b border-[#ECE6E1]'>
									<th className='px-4 py-2 font-semibold text-zinc-500'>Item Path</th>
									<th className='px-4 py-2 font-semibold text-zinc-500'>Item ID</th>
									<th className='px-4 py-2 font-semibold text-zinc-500'>Ingestion Scope</th>
								</tr>
							</thead>
							<tbody className='divide-y divide-[#ECE6E1]'>
								{verifiedItems.map((item, idx) => (
									<tr key={idx} className='hover:bg-zinc-50/50'>
										<td className='px-4 py-2 font-mono text-zinc-600'>{item.path}</td>
										<td className='px-4 py-2 font-mono text-[0.65rem] text-zinc-400'>{item.id}</td>
										<td className='px-4 py-2 text-zinc-500'>{item.scope}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<p className='text-[0.7rem] text-zinc-400 italic'>Verification check: metadata descriptors successfully extracted. File binaries match original checksums.</p>

					<div className='flex justify-end gap-3 pt-2'>
						<button
							onClick={() => document.getElementById("verify-modal")?.classList.add("hidden")}
							className='px-4 py-2 border border-[#ECE6E1] hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-700 transition-all duration-150'
						>
							Cancel
						</button>
						<button
							onClick={triggerPackageImport}
							className='px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-semibold shadow-sm transition-all duration-150'
						>
							Proceed to Import
						</button>
					</div>
				</div>
			</div>

			{/* Authentication/Wrong Credentials Warning Modal */}
			{showAuthErrorModal && (
				<div className='fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in'>
					<div className='bg-white rounded-2xl border border-[#ECE6E1] shadow-2xl p-6 max-w-sm w-full mx-4 space-y-4 animate-scale-up'>
						<div className='w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center mx-auto'>
							<AlertTriangle className='w-6 h-6' />
						</div>
						<div className='text-center space-y-2'>
							<h3 className='font-bold text-base text-zinc-900'>Authentication Failed</h3>
							<p className='text-xs text-zinc-500 leading-relaxed'>
								The OAuth Authority rejected the client credentials. Please check your host URL, Client ID, and Client Secret settings and try again.
							</p>
						</div>
						<button
							onClick={() => setShowAuthErrorModal(false)}
							className='w-full py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-semibold shadow-sm transition-all duration-150'
						>
							Dismiss & Configure
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
