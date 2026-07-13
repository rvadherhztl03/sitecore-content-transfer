// src/components/ContentTreeExplorer.tsx
"use client";

import React, { useState, useEffect } from "react";

export interface TreeNode {
  id: string;
  name: string;
  path: string;
  hasChildren: boolean;
  children?: TreeNode[];
  isExpanded?: boolean;
}

interface ContentTreeExplorerProps {
  sourceHost: string;
  sourceClientId: string;
  sourceClientSecret: string;
  sourceAuthority: string;
  sourceAudience: string;
  selectedPaths: string[];
  onSelectionChange: (paths: string[]) => void;
  isMigrating: boolean;
  demoMode: boolean;
  onAuthError?: () => void;
}

const CLIENT_MOCK_DB: Record<string, { id: string; name: string; path: string; hasChildren: boolean }[]> = {
  '/sitecore': [
    { id: 'content', name: 'content', path: '/sitecore/content', hasChildren: true },
    { id: 'media', name: 'media library', path: '/sitecore/media library', hasChildren: true },
    { id: 'templates', name: 'templates', path: '/sitecore/templates', hasChildren: true }
  ],
  '/sitecore/content': [
    { id: 'hztl', name: 'HztlFoundation', path: '/sitecore/content/HztlFoundation', hasChildren: true }
  ],
  '/sitecore/content/HztlFoundation': [
    { id: 'brandx', name: 'BrandX', path: '/sitecore/content/HztlFoundation/BrandX', hasChildren: true }
  ],
  '/sitecore/content/HztlFoundation/BrandX': [
    { id: 'home', name: 'Home', path: '/sitecore/content/HztlFoundation/BrandX/Home', hasChildren: true }
  ],
  '/sitecore/content/HztlFoundation/BrandX/Home': [
    { id: 'demo1', name: 'CKDemoPage 1', path: '/sitecore/content/HztlFoundation/BrandX/Home/CKDemoPage 1', hasChildren: false },
    { id: 'demo2', name: 'CKDemoPage 2', path: '/sitecore/content/HztlFoundation/BrandX/Home/CKDemoPage 2', hasChildren: false },
    { id: 'products', name: 'Products', path: '/sitecore/content/HztlFoundation/BrandX/Home/Products', hasChildren: true },
    { id: 'about', name: 'About Us', path: '/sitecore/content/HztlFoundation/BrandX/Home/About Us', hasChildren: false }
  ],
  '/sitecore/content/HztlFoundation/BrandX/Home/Products': [
    { id: 'prod-a', name: 'Product A', path: '/sitecore/content/HztlFoundation/BrandX/Home/Products/Product A', hasChildren: false },
    { id: 'prod-b', name: 'Product B', path: '/sitecore/content/HztlFoundation/BrandX/Home/Products/Product B', hasChildren: false }
  ],
  '/sitecore/media library': [
    { id: 'images', name: 'Images', path: '/sitecore/media library/Images', hasChildren: true }
  ],
  '/sitecore/media library/Images': [
    { id: 'hero', name: 'Hero Banner', path: '/sitecore/media library/Images/Hero Banner', hasChildren: false },
    { id: 'logo-img', name: 'Logo', path: '/sitecore/media library/Images/Logo', hasChildren: false }
  ],
  '/sitecore/templates': [
    { id: 'project-tpl', name: 'Project', path: '/sitecore/templates/Project', hasChildren: true }
  ],
  '/sitecore/templates/Project': [
    { id: 'page-tpl', name: 'Page', path: '/sitecore/templates/Project/Page', hasChildren: false }
  ]
};

export function ContentTreeExplorer({
  sourceHost,
  sourceClientId,
  sourceClientSecret,
  sourceAuthority,
  sourceAudience,
  selectedPaths,
  onSelectionChange,
  isMigrating,
  demoMode,
  onAuthError
}: ContentTreeExplorerProps) {
  // Tree Root State
  const [tree, setTree] = useState<TreeNode>({
    id: "root",
    name: "sitecore",
    path: "/sitecore",
    hasChildren: true,
    isExpanded: false,
    children: []
  });

  const [loadingNodes, setLoadingNodes] = useState<Record<string, boolean>>({});

  // Reset tree when connection changes or mode changes
  useEffect(() => {
    setTree({
      id: "root",
      name: "sitecore",
      path: "/sitecore",
      hasChildren: true,
      isExpanded: false,
      children: []
    });
  }, [sourceHost, demoMode]);

  const fetchChildren = async (nodePath: string): Promise<TreeNode[]> => {
    try {
      const res = await fetch("/api/migrate/children", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceHost,
          sourceClientId: demoMode ? "demo-client-id" : sourceClientId,
          sourceClientSecret: demoMode ? "demo-client-secret" : sourceClientSecret,
          sourceAuthority: demoMode ? "https://auth-demo.sitecorecloud.io" : sourceAuthority,
          sourceAudience: demoMode ? "https://api.sitecorecloud.io" : sourceAudience,
          parentId: nodePath
        })
      });

      if (!res.ok) {
        if (demoMode) {
          console.warn(`[ContentTreeExplorer] API fetch for ${nodePath} failed with HTTP ${res.status}. Falling back to mock client database.`);
          return CLIENT_MOCK_DB[nodePath] || [];
        }
        const errorData = await res.json();
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      return await res.json();
    } catch (e) {
      if (demoMode) {
        console.warn(`[ContentTreeExplorer] Network error fetching ${nodePath}:`, e, `. Falling back to mock client database.`);
        return CLIENT_MOCK_DB[nodePath] || [];
      }
      throw e;
    }
  };

  const toggleExpand = async (node: TreeNode) => {
    if (isMigrating) return;

    // Collapse if already expanded
    if (node.isExpanded) {
      updateNode(tree, node.path, { isExpanded: false });
      return;
    }

    // Set loading indicator
    setLoadingNodes(prev => ({ ...prev, [node.path]: true }));

    try {
      // Fetch children from API route
      const fetchedChildren = await fetchChildren(node.path);

      // Format new nodes
      const childrenNodes: TreeNode[] = fetchedChildren.map(c => ({
        id: c.id,
        name: c.name,
        path: c.path,
        hasChildren: c.hasChildren,
        isExpanded: false,
        children: []
      }));

      updateNode(tree, node.path, {
        isExpanded: true,
        children: childrenNodes
      });
    } catch (e) {
      console.error("[ContentTreeExplorer] Error expanding node:", e);
      const errMsg = e instanceof Error ? e.message : String(e);
      if (
        errMsg.toLowerCase().includes("auth") || 
        errMsg.toLowerCase().includes("credential") || 
        errMsg.toLowerCase().includes("token") || 
        errMsg.toLowerCase().includes("401") || 
        errMsg.toLowerCase().includes("unauthorized")
      ) {
        if (onAuthError) {
          onAuthError();
        } else {
          alert(`Entered credentials are not valid! Please add correct ones.`);
        }
      } else {
        alert(`Failed to retrieve children from live Sitecore environment: ${errMsg}`);
      }
    } finally {
      setLoadingNodes(prev => ({ ...prev, [node.path]: false }));
    }
  };

  const updateNode = (
    currentNode: TreeNode,
    targetPath: string,
    updates: Partial<TreeNode>
  ): boolean => {
    if (currentNode.path === targetPath) {
      Object.assign(currentNode, updates);
      setTree({ ...tree }); // force component re-render
      return true;
    }

    if (currentNode.children) {
      for (const child of currentNode.children) {
        if (updateNode(child, targetPath, updates)) {
          return true;
        }
      }
    }
    return false;
  };

  const handleCheckboxChange = (nodePath: string, isChecked: boolean) => {
    if (isMigrating) return;

    let updatedPaths = [...selectedPaths];
    if (isChecked) {
      if (!updatedPaths.includes(nodePath)) {
        updatedPaths.push(nodePath);
      }
    } else {
      updatedPaths = updatedPaths.filter(p => p !== nodePath);
    }

    onSelectionChange(updatedPaths);
  };

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const isChecked = selectedPaths.includes(node.path);
    const isLoading = loadingNodes[node.path];

    return (
      <div key={node.path} style={{ marginLeft: `${depth * 14}px` }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 6px",
          borderRadius: "4px",
          backgroundColor: isChecked ? "var(--step-active-bg)" : "transparent",
          transition: "background-color 0.2s",
          marginBottom: "2px"
        }}>
          {/* Chevron expander button */}
          {node.hasChildren ? (
            <button
              onClick={() => toggleExpand(node)}
              disabled={isMigrating || isLoading}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-main)",
                cursor: "pointer",
                padding: "2px 6px",
                marginRight: "4px",
                fontSize: "0.75rem",
                width: "20px",
                textAlign: "center"
              }}
            >
              {isLoading ? "⏳" : node.isExpanded ? "▼" : "▶"}
            </button>
          ) : (
            <span style={{ width: "24px", display: "inline-block" }}></span>
          )}

          {/* Node check box */}
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => handleCheckboxChange(node.path, e.target.checked)}
            disabled={isMigrating}
            style={{
              marginRight: "10px",
              cursor: "pointer",
              accentColor: "var(--primary-color)"
            }}
          />

          {/* Node text and icon */}
          <span style={{
            fontSize: "0.85rem",
            color: "var(--text-main)",
            fontFamily: "monospace",
            userSelect: "none"
          }}>
            {node.hasChildren ? "📁 " : "📄 "}
            {node.name}
          </span>
        </div>

        {/* Child expansion list */}
        {node.isExpanded && node.children && (
          <div style={{ marginTop: "2px" }}>
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      background: "var(--bg-app)",
      border: "1px solid var(--border-panel)",
      borderRadius: "4px",
      padding: "12px",
      maxHeight: "350px",
      overflowY: "auto"
    }}>
      {renderNode(tree)}
    </div>
  );
}
export default ContentTreeExplorer;
