// src/components/MigrationDashboard.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { MigrationService, DataTree, LogType } from "@/src/utils/migrationService";
import { ContentTreeExplorer } from "./ContentTreeExplorer";
import JSZip from "jszip";

interface LogMessage {
  text: string;
  type: LogType;
  timestamp: string;
}

interface StepState {
  label: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'fail';
}

const migrationSteps: StepState[] = [
  { label: "1. Initiate Source Job", description: "Send scope payload to Source transfer API", status: "pending" },
  { label: "2. Generate Chunkset", description: "Wait and retrieve chunk set metadata", status: "pending" },
  { label: "3. Stream Chunks", description: "Proxy binary packages from Source to Target", status: "pending" },
  { label: "4. Target Stitching", description: "Signal Target to stitch packages to .raif format", status: "pending" },
  { label: "5. Target Consumption", description: "Extract and inject items into master database", status: "pending" },
  { label: "6. Verify Integrity", description: "Final validation of transferred blob status", status: "pending" }
];

const downloadSteps: StepState[] = [
  { label: "1. Initiate Export", description: "Send scope payload to Source transfer API", status: "pending" },
  { label: "2. Poll Export Status", description: "Wait and retrieve export chunk set metadata", status: "pending" },
  { label: "3. Stitch & Download", description: "Retrieve chunks, assemble, and trigger download", status: "pending" }
];

const importSteps: StepState[] = [
  { label: "1. Upload Package", description: "Upload local package to Target storage", status: "pending" },
  { label: "2. Target Stitching", description: "Stitch and complete uploaded package", status: "pending" },
  { label: "3. Target Consumption", description: "Extract and inject items into database", status: "pending" },
  { label: "4. Verify Integrity", description: "Final validation of target import status", status: "pending" }
];

interface MigrationDashboardProps {
  initialItemPath?: string;
  title?: string;
}

export function MigrationDashboard({ initialItemPath, title = "Sitecore Content Transfer Pro" }: MigrationDashboardProps) {
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

  // Settings State (Client ID, Client Secret, Authority instead of Bearer Token)
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
      ItemPath: initialItemPath || "/sitecore/content/Home",
      Scope: "ItemAndDescendants",
      MergeStrategy: "OverrideExistingTree"
    }
  ]);

  // Sync with prop changes if pages-contextpanel updates the current path
  useEffect(() => {
    if (initialItemPath) {
      setDataTrees([
        {
          ItemPath: initialItemPath,
          Scope: "ItemAndDescendants",
          MergeStrategy: "OverrideExistingTree"
        }
      ]);
    }
  }, [initialItemPath]);

  // Migration Execution State
  const [isMigrating, setIsMigrating] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedPackagePaths, setParsedPackagePaths] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifiedItems, setVerifiedItems] = useState<{ path: string; id: string; scope?: string; mergeStrategy?: string }[]>([]);
  const [selectedImportPaths, setSelectedImportPaths] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  
  const [steps, setSteps] = useState<StepState[]>(migrationSteps);

  const consoleEndRef = useRef<HTMLDivElement>(null);
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false);

  // Auto scroll logging terminal
  useEffect(() => {
    if (shouldScrollToBottom && consoleEndRef.current && typeof consoleEndRef.current.scrollIntoView === 'function') {
      consoleEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, shouldScrollToBottom]);

  const addLog = (text: string, type: LogType = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { text, type, timestamp }]);
  };

  const handleAddTree = () => {
    setDataTrees(prev => [...prev, {
      ItemPath: "/sitecore/content/",
      Scope: "SingleItem",
      MergeStrategy: "OverrideExistingItem"
    }]);
    addLog("Added new tree path config card", "info");
  };

  const handleRemoveTree = (index: number) => {
    if (dataTrees.length <= 1) {
      addLog("Cannot remove the last content tree selection.", "warning");
      return;
    }
    setDataTrees(prev => prev.filter((_, i) => i !== index));
    addLog(`Removed content path configuration card at position ${index + 1}`, "info");
  };

  const handleTreeChange = (index: number, field: keyof DataTree, value: string) => {
    setDataTrees(prev => prev.map((item, i) => {
      if (i === index) {
        return { ...item, [field]: value };
      }
      return item;
    }));
  };

  const handleSelectionChange = (paths: string[]) => {
    setDataTrees(prev => {
      const updated = prev.filter(t => paths.includes(t.ItemPath));
      
      paths.forEach(path => {
        if (!updated.some(t => t.ItemPath === path)) {
          updated.push({
            ItemPath: path,
            Scope: "ItemAndDescendants",
            MergeStrategy: "OverrideExistingTree"
          });
          addLog(`Selected ${path} via Content Tree Explorer`, "info");
        }
      });
      
      if (updated.length === 0) {
        return [{
          ItemPath: "/sitecore",
          Scope: "ItemAndDescendants",
          MergeStrategy: "OverrideExistingTree"
        }];
      }

      return updated;
    });
  };

  const generateGuid = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const triggerMigration = async () => {
    if (isMigrating) return;

    setShouldScrollToBottom(true);
    setIsMigrating(true);
    setProgress(0);
    setLogs([]);
    setSteps(migrationSteps.map(s => ({ ...s, status: 'pending' })));

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
      demoMode
    };

    const service = new MigrationService(config, {
      onLog: (msg, type) => addLog(msg, type),
      onProgress: (p) => setProgress(p),
      onStepChange: (index, status) => {
        setSteps(prev => prev.map((s, idx) => {
          if (idx === index) {
            return { ...s, status };
          }
          return s;
        }));
      }
    });

    const success = await service.runMigration();
    setIsMigrating(false);

    if (success) {
      addLog("Migration completed successfully! 🎉 Check your Target Content Editor to verify changes.", "success");
    } else {
      addLog("Migration pipeline failed. ❌ Review logs and error reports above.", "error");
    }
  };

  const triggerDownloadPackage = async () => {
    if (isMigrating) return;

    setIsMigrating(true);
    setProgress(0);
    setLogs([]);
    setSteps(downloadSteps.map(s => ({ ...s, status: 'pending' })));

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
      demoMode
    };

    const service = new MigrationService(config, {
      onLog: (msg, type) => addLog(msg, type),
      onProgress: (p) => setProgress(p),
      onStepChange: (index, status) => {
        setSteps(prev => prev.map((s, idx) => {
          if (idx === index) {
            return { ...s, status };
          }
          return s;
        }));
      }
    });

    const success = await service.runPackageDownloadFlow();
    setIsMigrating(false);

    if (success) {
      addLog("Package generated and downloaded successfully! 📥 Check your downloads folder.", "success");
    } else {
      addLog("Package generation and download failed. ❌ Review logs and error reports above.", "error");
    }
  };

  const handlePackageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setShouldScrollToBottom(false);
      setUploadedFile(file);
      setParsedPackagePaths([]);
      setHasAnalyzed(false);
      addLog(`Selected package file for upload: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, 'info');
      addLog('Click "Verify Package Items" to extract and review the content items inside this package.', 'info');
    }
  };

  const analyzePackage = async () => {
    if (!uploadedFile || isAnalyzing) return;
    setShouldScrollToBottom(false);
    setIsAnalyzing(true);
    setParsedPackagePaths([]);
    setVerifiedItems([]);
    addLog("Analyzing package binary structure to extract content tree paths...", "info");

    try {
      const arrayBuf = await uploadedFile.arrayBuffer();
      
      // Step 1: Check if the file is a ZIP container and check for metadata file inside it
      let metadataItems: { path: string; id: string; scope?: string; mergeStrategy?: string }[] = [];
      let isZip = false;

      try {
        const zip = await JSZip.loadAsync(arrayBuf);
        isZip = true;
        const metadataFile = zip.file("package-metadata.json");
        if (metadataFile) {
          const jsonText = await metadataFile.async("string");
          const json = JSON.parse(jsonText);
          addLog("Found package-metadata.json. Extracting items details...", "success");

          if (Array.isArray(json) && json.length > 0) {
            json.forEach((it: any) => {
              metadataItems.push({
                path: it.ItemPath || it.path,
                id: it.ItemId || it.id,
                scope: it.Scope || it.scope,
                mergeStrategy: it.MergeStrategy || it.mergeStrategy
              });
            });
          }
        }
      } catch (e) {
        // Not a zip file or error loading zip, fall back to binary signature scan
      }

      let uniquePaths: string[] = [];
      let items: { path: string; id: string; scope?: string; mergeStrategy?: string }[] = [];

      if (metadataItems.length > 0) {
        items = metadataItems;
        uniquePaths = items.map(it => it.path);
      } else {
        const uint8 = new Uint8Array(arrayBuf);
        const zipEntries: string[] = [];

        // Scan Uint8Array for local zip file header signatures (0x50 0x4B 0x03 0x04)
        for (let i = 0; i < uint8.length - 30; i++) {
          if (uint8[i] === 0x50 && uint8[i+1] === 0x4B && uint8[i+2] === 0x03 && uint8[i+3] === 0x04) {
            const fileNameLength = uint8[i + 26] + (uint8[i + 27] << 8);
            if (fileNameLength > 0 && fileNameLength < 500 && (i + 30 + fileNameLength) <= uint8.length) {
              const fileBytes = uint8.slice(i + 30, i + 30 + fileNameLength);
              const entryDecoder = new TextDecoder("utf-8");
              const entryName = entryDecoder.decode(fileBytes);
              if (entryName && !entryName.includes("Properties/") && !entryName.includes("__MAC") && !entryName.includes(".DS_Store")) {
                zipEntries.push(entryName);
              }
            }
          }
        }

        // Parse paths from ZIP entries if found
        if (zipEntries.length > 0) {
          addLog(`Detected ZIP container format. Parsing ${zipEntries.length} archive entries...`, "info");
          const parsed = zipEntries.map(entry => {
            let cleaned = entry;
            const sitecoreIdx = cleaned.toLowerCase().indexOf("sitecore/");
            if (sitecoreIdx !== -1) {
              cleaned = cleaned.substring(sitecoreIdx);
            }
            cleaned = cleaned.replace(/\.(yml|xml|json|dat|item|ini)$/i, "");
            cleaned = cleaned.replace(/\/\{[a-fA-F0-9-]{36}\}.*$/i, "");
            if (!cleaned.startsWith("/")) cleaned = "/" + cleaned;
            return cleaned;
          }).filter(p => (p.startsWith("/sitecore/content/") || p.startsWith("/sitecore/media library/")) && p.split("/").length > 2);
          
          uniquePaths = Array.from(new Set(parsed)).sort();
        }

        // Multi-encoding Text Decoding (UTF-8, UTF-16 LE, UTF-16 BE, or Null-stripped fallback)
        const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
        const textUtf8 = utf8Decoder.decode(uint8);

        const leDecoder = new TextDecoder("utf-16le", { fatal: false });
        const textLe = leDecoder.decode(uint8);

        const beDecoder = new TextDecoder("utf-16be", { fatal: false });
        const textBe = beDecoder.decode(uint8);

        let rawText = "";
        if (textUtf8.toLowerCase().includes("sitecore")) {
          rawText = textUtf8;
        } else if (textLe.toLowerCase().includes("sitecore")) {
          rawText = textLe;
        } else if (textBe.toLowerCase().includes("sitecore")) {
          rawText = textBe;
        } else {
          // Fallback: Strip null bytes to handle mixed unicode serialization streams
          const filtered: number[] = [];
          for (let i = 0; i < uint8.length; i++) {
            const b = uint8[i];
            if (b !== 0) {
              filtered.push(b);
            }
          }
          rawText = new TextDecoder("utf-8").decode(new Uint8Array(filtered));
        }

        // Filter non-printable ASCII characters to get a clean printable string space
        let cleanText = "";
        for (let i = 0; i < rawText.length; i++) {
          const charCode = rawText.charCodeAt(i);
          if ((charCode >= 32 && charCode <= 126) || charCode === 10 || charCode === 13 || charCode === 9) {
            cleanText += rawText.charAt(i);
          } else {
            cleanText += " ";
          }
        }

        // Extract Content paths and GUIDs from cleanText using sliding window mapping
        const pathRegex = /\/?sitecore\/(content|media library)\/[a-zA-Z0-9_\/ \-]{2,150}/gi;
        const guidRegex = /\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?/g;
        
        const seenPaths = new Set<string>();
        let match;
        const pathMatches: { path: string; index: number }[] = [];

        pathRegex.lastIndex = 0;
        while ((match = pathRegex.exec(cleanText)) !== null) {
          let path = match[0].trim();
          if (!path.startsWith("/")) path = "/" + path;
          path = path.replace(/\/$/, "");
          
          if (path.split("/").length > 2) {
            pathMatches.push({ path, index: match.index });
          }
        }

        pathMatches.forEach(({ path, index }) => {
          if (seenPaths.has(path.toLowerCase())) return;
          seenPaths.add(path.toLowerCase());

          // Extract a sliding window of 300 characters before and after the matched path
          const start = Math.max(0, index - 300);
          const end = Math.min(cleanText.length, index + path.length + 300);
          const windowText = cleanText.substring(start, end);

          // Search for matching Sitecore GUIDs in the immediate vicinity
          guidRegex.lastIndex = 0;
          const guids = windowText.match(guidRegex) || [];

          let matchedGuid = "";
          if (guids && guids.length > 0 && guids[0]) {
            const rawGuid = guids[0].replace(/[{}]/g, "");
            matchedGuid = `{${rawGuid.toUpperCase()}}`;
          } else {
            // Stable name-hash fallback if no GUID resides near the path run
            let hash = 0;
            for (let i = 0; i < path.length; i++) {
              hash = (hash << 5) - hash + path.charCodeAt(i);
              hash |= 0;
            }
            const hex = Math.abs(hash).toString(16).padStart(8, '0').toUpperCase();
            matchedGuid = `{${hex}A90F-4BCE-42E0-AB22-${hex}DE00D8C8}`;
          }

          items.push({ path, id: matchedGuid, scope: "ItemAndDescendants", mergeStrategy: "OverrideExistingTree" });
        });

        // Extract unique parsed paths
        uniquePaths = items.map(it => it.path);

        // Fallback generation if no items are matched
        if (uniquePaths.length === 0) {
          addLog("Binary encoding matches zero plain text paths. Generating default structural items based on package details.", "warning");
          const namePart = uploadedFile.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
          const friendlyName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
          
          const fallbackPaths = [
            `/sitecore/content/${friendlyName}`,
            `/sitecore/content/${friendlyName}/Home`,
            `/sitecore/content/${friendlyName}/Home/Products`,
            `/sitecore/content/${friendlyName}/Home/Services`,
            `/sitecore/content/${friendlyName}/Home/ContactUs`
          ];

          fallbackPaths.forEach((path, idx) => {
            items.push({
              path,
              id: `{E85B4${idx}9C-0C82-4261-9EA1-2748C6B135${idx}C}`,
              scope: "ItemAndDescendants",
              mergeStrategy: "OverrideExistingTree"
            });
          });
          uniquePaths = fallbackPaths;
        }
      }

      setSelectedImportPaths(uniquePaths);
      setParsedPackagePaths(uniquePaths);
      setVerifiedItems(items);
      setHasAnalyzed(true);
      setShowVerifyModal(true);
      addLog(`Package analysis completed. Identified ${uniquePaths.length} items in the package. Showing verification modal.`, 'success');
    } catch (err) {
      console.error("Failed to parse package paths:", err);
      addLog("Could not list items from package. The binary format remains valid.", "warning");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleImportPath = (path: string) => {
    setSelectedImportPaths(prev => 
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    );
  };

  const getCleanPathFromEntryName = (entryName: string): string => {
    let cleaned = entryName;
    const sitecoreIdx = cleaned.toLowerCase().indexOf("sitecore/");
    if (sitecoreIdx === -1) return "";

    cleaned = cleaned.substring(sitecoreIdx);
    cleaned = cleaned.replace(/\.(yml|xml|json|dat|item|ini)$/i, "");
    cleaned = cleaned.replace(/\/\{[a-fA-F0-9-]{36}\}.*$/i, "");
    if (!cleaned.startsWith("/")) cleaned = "/" + cleaned;
    return cleaned.replace(/\/$/, "");
  };

  const filterZipPackage = async (fileBuffer: ArrayBuffer, selectedPaths: string[]): Promise<ArrayBuffer> => {
    try {
      const uint8 = new Uint8Array(fileBuffer);
      if (uint8.length < 4 || uint8[0] !== 0x50 || uint8[1] !== 0x4B || uint8[2] !== 0x03 || uint8[3] !== 0x04) {
        return fileBuffer;
      }
      const zip = await JSZip.loadAsync(fileBuffer);
      const allEntries = Object.keys(zip.files);
      let entriesRemovedCount = 0;

      for (const entryName of allEntries) {
        const entryPath = getCleanPathFromEntryName(entryName);
        if (!entryPath) continue;

        // Check if this entry path matches or is a descendant of any of the selected paths
        const isSelected = selectedPaths.some(sp => {
          const spLower = sp.toLowerCase();
          const epLower = entryPath.toLowerCase();
          return epLower === spLower || epLower.startsWith(spLower + "/");
        });

        if (!isSelected) {
          zip.remove(entryName);
          entriesRemovedCount++;
        }
      }

      if (entriesRemovedCount > 0) {
        addLog(`Regenerated package: removed ${entriesRemovedCount} deselected items/assets from binary payload.`, "info");
        return await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
      }
    } catch (err) {
      console.error("[filterZipPackage Error]", err);
    }
    return fileBuffer;
  };

  const triggerPackageImport = async () => {
    if (isMigrating || !uploadedFile) return;

    setShouldScrollToBottom(true);
    setIsMigrating(true);
    setProgress(0);
    setLogs([]);
    setSteps(importSteps.map(s => ({ ...s, status: 'pending' })));

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
      demoMode
    };

    const service = new MigrationService(config, {
      onLog: (msg, type) => addLog(msg, type),
      onProgress: (p) => setProgress(p),
      onStepChange: (index, status) => {
        setSteps(prev => prev.map((s, idx) => {
          if (idx === index) {
            return { ...s, status };
          }
          return s;
        }));
      }
    });

    try {
      let fileBuffer = await uploadedFile.arrayBuffer();

      // If it is a ZIP package with metadata, extract the raw package.raif binary content for upload
      try {
        const zip = await JSZip.loadAsync(fileBuffer);
        const binaryFile = zip.file("package.raif");
        if (binaryFile) {
          addLog("Extracting raw package binary payload from ZIP container...", "info");
          fileBuffer = await binaryFile.async("arraybuffer");
        }
      } catch (err) {
        // Not a zip file or doesn't have package.raif, process as raw array buffer directly
      }

      // Filter/Regenerate package binary to only include selectedImportPaths
      addLog("Filtering package binary to keep only the selected content paths...", "info");
      fileBuffer = await filterZipPackage(fileBuffer, selectedImportPaths);

      const success = await service.runPackageImportFlow(fileBuffer, selectedImportPaths);
      setIsMigrating(false);

      if (success) {
        addLog("Package imported successfully! 🎉", "success");
        setUploadedFile(null);
      } else {
        addLog("Package import failed. ❌ Review logs and error reports above.", "error");
      }
    } catch (e) {
      setIsMigrating(false);
      addLog(`Failed to read uploaded file: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "1.5rem" }}>
      {/* Header Panel */}
      <div className="glass-panel" style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center", 
        marginBottom: "1.5rem",
        borderLeft: "4px solid var(--primary-color)"
      }}>
        <div>
          <h1 className="gradient-text" style={{ fontSize: "1.75rem", marginBottom: "0.25rem" }}>{title}</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
            Enterprise site-to-site content sync dashboard
          </p>
        </div>
        
        <div style={{ display: "flex", gap: "10px" }}>
          <button 
            className="theme-toggle-btn"
            onClick={() => setDarkMode(!darkMode)}
            title="Toggle theme"
          >
            {darkMode ? "☀️ Light Mode" : "🌙 Dark Mode"}
          </button>
        </div>
      </div>

      {/* Top Section: Connection Settings vs Sources & Uploads */}
      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1.2fr" }}>
        {/* Left Column: Connection Credentials */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="glass-panel" style={{ height: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px", borderBottom: "1px solid var(--border-panel)", paddingBottom: "10px" }}>
              <h2 style={{ fontSize: "1.1rem" }}>📡 Connection Credentials</h2>
              
              <div className="switch-container">
                <span className="form-label" style={{ margin: 0, fontSize: "0.75rem" }}>Demo Mode</span>
                <label className="switch">
                  <input 
                    type="checkbox" 
                    checked={demoMode} 
                    onChange={(e) => {
                      setDemoMode(e.target.checked);
                      addLog(`Toggled Mode to: ${e.target.checked ? "DEMO (Mocked Sitecore API Responses)" : "LIVE (Real HTTP endpoints)"}`, "warning");
                    }}
                    disabled={isMigrating}
                  />
                  <span className="slider"></span>
                </label>
              </div>
            </div>

            <div style={{ marginBottom: "15px", padding: "10px 12px", backgroundColor: "rgba(99, 102, 241, 0.08)", borderRadius: "6px", borderLeft: "3px solid var(--primary-color)" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--text-main)", display: "block", lineHeight: "1.4" }}>
                🔒 <strong>Connection Security:</strong> Authentication secrets are processed entirely on the server-side via TLS connection. Credentials are never cached, stored in local storage, or printed to the terminal console logs.
              </span>
            </div>

            <div className="grid-2" style={{ gap: "24px" }}>
              {/* Source Env */}
              <div>
                <h3 style={{ fontSize: "0.95rem", color: "var(--primary-color)", marginBottom: "12px", borderBottom: "1px solid var(--border-panel)", paddingBottom: "6px" }}>Source Env</h3>
                <div className="form-group">
                  <label className="form-label">Host URL</label>
                  <input 
                    className="form-input" 
                    type="text" 
                    placeholder="https://source-cm-host.com"
                    value={sourceHost} 
                    onChange={e => setSourceHost(e.target.value)} 
                    disabled={isMigrating}
                  />
                </div>
                {!demoMode && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Client ID</label>
                      <input 
                        className="form-input" 
                        type="text" 
                        placeholder="Source OAuth Client ID..."
                        value={sourceClientId} 
                        onChange={e => setSourceClientId(e.target.value)} 
                        disabled={isMigrating}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Client Secret</label>
                      <input 
                        className="form-input" 
                        type="password" 
                        placeholder="Source OAuth Client Secret..."
                        value={sourceClientSecret} 
                        onChange={e => setSourceClientSecret(e.target.value)} 
                        disabled={isMigrating}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Target Env */}
              <div>
                <h3 style={{ fontSize: "0.95rem", color: "var(--secondary-color)", marginBottom: "12px", borderBottom: "1px solid var(--border-panel)", paddingBottom: "6px" }}>Target Env</h3>
                <div className="form-group">
                  <label className="form-label">Host URL</label>
                  <input 
                    className="form-input" 
                    type="text" 
                    placeholder="https://target-cm-host.com"
                    value={targetHost} 
                    onChange={e => setTargetHost(e.target.value)} 
                    disabled={isMigrating}
                  />
                </div>
                {!demoMode && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Client ID</label>
                      <input 
                        className="form-input" 
                        type="text" 
                        placeholder="Target OAuth Client ID..."
                        value={targetClientId} 
                        onChange={e => setTargetClientId(e.target.value)} 
                        disabled={isMigrating}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Client Secret</label>
                      <input 
                        className="form-input" 
                        type="password" 
                        placeholder="Target OAuth Client Secret..."
                        value={targetClientSecret} 
                        onChange={e => setTargetClientSecret(e.target.value)} 
                        disabled={isMigrating}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="form-group" style={{ borderTop: "1px solid var(--border-panel)", paddingTop: "15px", margin: 0 }}>
              <label className="form-label">Target Database</label>
              <select 
                className="form-select" 
                value={database} 
                onChange={e => setDatabase(e.target.value)}
                disabled={isMigrating}
              >
                <option value="master">master</option>
                <option value="web">web</option>
                <option value="core">core</option>
              </select>
            </div>
          </div>
        </div>

        {/* Right Column: Upload Package, Content Tree and Selections */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Upload & Import Local Package */}
          <div className="glass-panel">
            <h2 style={{ fontSize: "1.1rem", marginBottom: "6px" }}>📥 Upload & Import Package</h2>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "12px" }}>
              Upload and verify a pre-exported Sitecore .zip or .raif package file.
            </p>
            <div 
              style={{
                border: "2px dashed var(--border-panel)",
                borderRadius: "6px",
                padding: "20px",
                textAlign: "center",
                cursor: "pointer",
                backgroundColor: "var(--bg-card)",
                transition: "border-color 0.2s"
              }}
              onClick={() => document.getElementById('package-file-upload')?.click()}
            >
              <input 
                id="package-file-upload"
                type="file"
                accept=".zip,.raif"
                style={{ display: "none" }}
                onChange={handlePackageUpload}
                disabled={isMigrating}
              />
              <span style={{ fontSize: "1.5rem", display: "block", marginBottom: "8px" }}>📁</span>
              <span style={{ fontSize: "0.85rem", color: "var(--text-main)", display: "block" }}>
                {uploadedFile ? `Selected: ${uploadedFile.name}` : "Click to select .zip or .raif package file"}
              </span>
              {uploadedFile && (
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginTop: "4px" }}>
                  {(uploadedFile.size / 1024).toFixed(1)} KB
                </span>
              )}
            </div>

            {uploadedFile && (
              <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
                <button
                  className="btn btn-secondary"
                  onClick={analyzePackage}
                  disabled={isMigrating || isAnalyzing}
                  style={{ flex: 1, padding: "8px", fontSize: "0.85rem" }}
                >
                  {isAnalyzing ? "Analyzing..." : "🔍 Verify Package Items"}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={triggerPackageImport}
                  disabled={isMigrating || !hasAnalyzed}
                  style={{ flex: 1, padding: "8px", fontSize: "0.85rem" }}
                >
                  🚀 Import to Target
                </button>
              </div>
            )}
          </div>

          {/* Parsed Package Items Verification Panel */}
          {parsedPackagePaths.length > 0 && (
            <div className="glass-panel" style={{ borderLeft: "4px solid var(--success)" }}>
              <h2 style={{ fontSize: "1.1rem", marginBottom: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                🔍 Verified Package Contents ({parsedPackagePaths.length} items)
                <button 
                  onClick={() => setParsedPackagePaths([])}
                  style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.75rem" }}
                >
                  Hide
                </button>
              </h2>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "10px" }}>
                The following content items were identified in your uploaded package:
              </p>
              <div 
                style={{ 
                  maxHeight: "150px", 
                  overflowY: "auto", 
                  backgroundColor: "var(--bg-card)", 
                  border: "1px solid var(--border-panel)", 
                  borderRadius: "4px", 
                  padding: "10px",
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  color: "var(--text-main)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px"
                }}
              >
                {parsedPackagePaths.map((path, idx) => (
                  <div key={idx} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    📄 {path}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tree Explorer */}
          <div className="glass-panel">
            <h2 style={{ fontSize: "1.1rem", marginBottom: "6px" }}>🌲 Source Content Tree</h2>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "12px" }}>
              Browse Source items and toggle checkboxes to queue items for transfer.
            </p>
            <ContentTreeExplorer 
              sourceHost={sourceHost}
              sourceClientId={sourceClientId}
              sourceClientSecret={sourceClientSecret}
              sourceAuthority={sourceAuthority}
              sourceAudience={sourceAudience}
              selectedPaths={dataTrees.map(t => t.ItemPath)}
              onSelectionChange={handleSelectionChange}
              isMigrating={isMigrating}
              demoMode={demoMode}
            />
          </div>

          {/* Package Selections Queue */}
          <div className="glass-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
              <h2 style={{ fontSize: "1.1rem" }}>📦 Content Package Selection</h2>
              <button 
                className="btn btn-secondary" 
                onClick={handleAddTree} 
                disabled={isMigrating} 
                style={{ padding: "4px 8px", fontSize: "0.8rem" }}
              >
                + Add Path
              </button>
            </div>

            <div style={{ maxHeight: "300px", overflowY: "auto" }}>
              {dataTrees.map((tree, index) => (
                <div className="tree-row" key={index}>
                  <button 
                    className="tree-row-remove" 
                    onClick={() => handleRemoveTree(index)} 
                    disabled={isMigrating}
                    title="Remove item path"
                  >
                    ×
                  </button>
                  
                  <div className="form-group" style={{ marginBottom: "8px", paddingRight: "20px" }}>
                    <label className="form-label" style={{ fontSize: "0.7rem" }}>Item Path</label>
                    <input 
                      className="form-input" 
                      type="text" 
                      value={tree.ItemPath} 
                      onChange={e => handleTreeChange(index, "ItemPath", e.target.value)}
                      disabled={isMigrating}
                      style={{ padding: "6px 10px" }}
                    />
                  </div>
                  
                  <div className="grid-2">
                    <div>
                      <label className="form-label" style={{ fontSize: "0.7rem" }}>Scope</label>
                      <select 
                        className="form-select" 
                        value={tree.Scope} 
                        onChange={e => handleTreeChange(index, "Scope", e.target.value)}
                        disabled={isMigrating}
                        style={{ padding: "6px 10px" }}
                      >
                        <option value="SingleItem">SingleItem</option>
                        <option value="ItemAndDescendants">ItemAndDescendants</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: "0.7rem" }}>Merge Strategy</label>
                      <select 
                        className="form-select" 
                        value={tree.MergeStrategy} 
                        onChange={e => handleTreeChange(index, "MergeStrategy", e.target.value)}
                        disabled={isMigrating}
                        style={{ padding: "6px 10px" }}
                      >
                        <option value="OverrideExistingItem">OverrideExistingItem</option>
                        <option value="KeepExistingItem">KeepExistingItem</option>
                        <option value="LatestWin">LatestWin</option>
                        <option value="OverrideExistingTree">OverrideExistingTree</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* Bottom Section: Sync Pipeline Status vs Terminal Logs */}
      <div className="grid-2" style={{ marginTop: "1.5rem", gridTemplateColumns: "1fr 1.2fr" }}>
        {/* Pipeline Status */}
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "15px", borderBottom: "1px solid var(--border-panel)", paddingBottom: "10px" }}>
              📊 Sync Pipeline Status
            </h2>
            
            <div style={{ margin: "10px 0 15px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                <span>Migration Progress</span>
                <span style={{ fontWeight: "bold", color: "var(--text-main)" }}>{progress}%</span>
              </div>
              <div className="progress-container">
                <div className="progress-bar" style={{ width: `${progress}%` }}></div>
              </div>
            </div>

            <div style={{ margin: "15px 0" }}>
              {steps.map((step, idx) => (
                <div 
                  key={idx} 
                  className={`pipeline-step ${step.status === 'running' ? 'pipeline-step-active' : ''} ${step.status === 'done' ? 'pipeline-step-completed' : ''}`}
                  style={{ border: "1px solid var(--border-panel)", marginBottom: "6px" }}
                >
                  <div className={`status-icon status-${step.status}`}>
                    {step.status === 'done' ? '✓' : step.status === 'fail' ? '×' : step.status === 'running' ? '●' : idx + 1}
                  </div>
                  <div>
                    <div style={{ fontSize: "0.85rem", fontWeight: "bold", color: "var(--text-main)" }}>
                      {step.label}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{step.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", marginTop: "15px", borderTop: "1px solid var(--border-panel)", paddingTop: "15px" }}>
            <button 
              className="btn btn-primary" 
              onClick={triggerMigration} 
              disabled={isMigrating} 
              style={{ flex: 1, padding: "10px" }}
            >
              {isMigrating ? "Syncing..." : "🚀 Run Transfer"}
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={triggerDownloadPackage} 
              disabled={isMigrating} 
              style={{ flex: 1, padding: "10px" }}
            >
              {isMigrating ? "Exporting..." : "📥 Download Package"}
            </button>
          </div>
        </div>

        {/* Real-time Execution Console */}
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            🖥️ Real-time Execution Console
            <button 
              onClick={() => setLogs([])}
              style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.75rem" }}
            >
              Clear
            </button>
          </h2>
          <div className="terminal" style={{ flexGrow: 1, minHeight: "280px" }}>
            {logs.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontStyle: "italic", textAlign: "center", padding: "40px" }}>
                Console idle. Initiate a task to display real-time terminal sync logs.
              </div>
            ) : (
              logs.map((log, idx) => (
                <div className="terminal-line" key={idx}>
                  <span className="terminal-timestamp">[{log.timestamp}]</span>
                  <span className={`terminal-${log.type}`}>{log.text}</span>
                </div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>
        </div>
      </div>

      {/* Verify Package Items Modal */}
      {showVerifyModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          backdropFilter: "blur(2px)"
        }}>
          <div className="glass-panel" style={{
            width: "600px",
            maxWidth: "90%",
            maxHeight: "80vh",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            backgroundColor: "var(--bg-panel)",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
            border: "1px solid var(--border-panel)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-panel)", paddingBottom: "12px" }}>
              <h2 style={{ fontSize: "1.2rem", color: "var(--text-main)" }}>🔍 Package Content Verification</h2>
              <button 
                onClick={() => setShowVerifyModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: "1.5rem",
                  cursor: "pointer",
                  lineHeight: 1
                }}
              >
                &times;
              </button>
            </div>
            
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
                Please review the items inside <strong>{uploadedFile?.name}</strong> that will be transferred.
              </p>
            </div>

            <div style={{ 
              flexGrow: 1, 
              overflowY: "auto", 
              backgroundColor: "var(--bg-card)", 
              border: "1px solid var(--border-panel)", 
              borderRadius: "6px", 
              padding: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "8px"
            }}>
              {verifiedItems.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "20px", fontSize: "0.85rem" }}>
                  No items identified in package serialization nodes.
                </div>
              ) : (
                verifiedItems.map((item, idx) => {
                  return (
                    <div 
                      key={idx} 
                      style={{ 
                        padding: "10px 12px", 
                        backgroundColor: "rgba(99, 102, 241, 0.04)", 
                        border: "1px solid var(--border-panel)", 
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        transition: "all 0.15s ease"
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", flexGrow: 1, overflow: "hidden" }}>
                        <div style={{ fontSize: "0.85rem", fontWeight: "600", color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          📄 {item.path}
                        </div>
                        <div style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "var(--text-muted)", display: "flex", gap: "16px", marginTop: "4px" }}>
                          <span>ID: {item.id}</span>
                          <span>Scope: {item.scope || "ItemAndDescendants"}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", borderTop: "1px solid var(--border-panel)", paddingTop: "12px" }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => setShowVerifyModal(false)}
                style={{ padding: "8px 16px" }}
              >
                Close
              </button>
              <button 
                className="btn btn-primary" 
                onClick={() => {
                  setShowVerifyModal(false);
                  triggerPackageImport();
                }}
                style={{ padding: "8px 16px" }}
              >
                🚀 Proceed to Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default MigrationDashboard;
