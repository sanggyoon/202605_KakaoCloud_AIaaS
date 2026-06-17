#!/usr/bin/env node
"use strict";

const fs = require("fs");

function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) {
    console.error("Usage: node ua-tour-analyze.js <input.json> <output.json>");
    process.exit(1);
  }

  const raw = fs.readFileSync(inPath, "utf8");
  const data = JSON.parse(raw);
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const layers = data.layers || [];

  const nodeById = new Map();
  for (const n of nodes) nodeById.set(n.id, n);

  // --- adjacency ---
  const fanIn = new Map();
  const fanOut = new Map();
  for (const n of nodes) {
    fanIn.set(n.id, 0);
    fanOut.set(n.id, 0);
  }
  // forward edges (imports/calls) for BFS
  const fwd = new Map();
  for (const n of nodes) fwd.set(n.id, []);

  // bidirectional pair tracking for clusters
  const edgeSet = new Set();
  const undirectedCount = new Map(); // "a|b" sorted -> count

  for (const e of edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    fanOut.set(e.source, (fanOut.get(e.source) || 0) + 1);
    fanIn.set(e.target, (fanIn.get(e.target) || 0) + 1);
    if (e.type === "imports" || e.type === "calls") {
      fwd.get(e.source).push(e.target);
    }
    edgeSet.add(e.source + "||" + e.target + "||" + e.type);
    const key = [e.source, e.target].sort().join("|");
    undirectedCount.set(key, (undirectedCount.get(key) || 0) + 1);
  }

  const nameOf = (id) => (nodeById.get(id) || {}).name || id;
  const sumOf = (id) => (nodeById.get(id) || {}).summary || "";
  const typeOf = (id) => (nodeById.get(id) || {}).type || "";

  // --- A. fan-in ranking ---
  const fanInRanking = nodes
    .map((n) => ({ id: n.id, fanIn: fanIn.get(n.id) || 0, name: n.name }))
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 20);

  // --- B. fan-out ranking ---
  const fanOutRanking = nodes
    .map((n) => ({ id: n.id, fanOut: fanOut.get(n.id) || 0, name: n.name }))
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, 20);

  // --- C. entry point candidates ---
  const fanOutVals = nodes.map((n) => fanOut.get(n.id) || 0).sort((a, b) => a - b);
  const fanInVals = nodes.map((n) => fanIn.get(n.id) || 0).sort((a, b) => a - b);
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  const fanOutTop10 = pct(fanOutVals, 0.9);
  const fanInBottom25 = pct(fanInVals, 0.25);

  const entryNames = new Set([
    "index.ts", "index.js", "main.ts", "main.js", "app.ts", "app.js",
    "server.ts", "server.js", "mod.rs", "main.go", "main.py", "main.rs",
    "manage.py", "app.py", "wsgi.py", "asgi.py", "run.py", "__main__.py",
    "Application.java", "Main.java", "Program.cs", "config.ru", "index.php",
    "App.swift", "Application.kt", "main.cpp", "main.c",
  ]);

  const entryScores = [];
  for (const n of nodes) {
    let score = 0;
    const fp = n.filePath || "";
    const depth = fp ? fp.split("/").length : 99;
    if (n.type === "document") {
      const base = (n.name || "").toLowerCase();
      if (base === "readme.md" && depth <= 1) score += 5;
      else if (base.endsWith(".md") && depth <= 1) score += 2;
    } else if (n.type === "file") {
      if (entryNames.has(n.name)) score += 3;
      if (depth <= 2) score += 1;
      if ((fanOut.get(n.id) || 0) >= fanOutTop10 && fanOutTop10 > 0) score += 1;
      if ((fanIn.get(n.id) || 0) <= fanInBottom25) score += 1;
    }
    if (score > 0) entryScores.push({ id: n.id, score, name: n.name, summary: sumOf(n.id), type: n.type });
  }
  entryScores.sort((a, b) => b.score - a.score);
  const entryPointCandidates = entryScores.slice(0, 5);

  // --- D. BFS from top CODE entry point ---
  let startNode = null;
  for (const c of entryScores) {
    if (typeOf(c.id) === "file") { startNode = c.id; break; }
  }
  if (!startNode && entryScores.length) startNode = entryScores[0].id;

  const order = [];
  const depthMap = {};
  if (startNode) {
    const q = [startNode];
    depthMap[startNode] = 0;
    while (q.length) {
      const cur = q.shift();
      order.push(cur);
      for (const nb of fwd.get(cur) || []) {
        if (!(nb in depthMap)) {
          depthMap[nb] = depthMap[cur] + 1;
          q.push(nb);
        }
      }
    }
  }
  const byDepth = {};
  for (const [id, d] of Object.entries(depthMap)) {
    (byDepth[d] = byDepth[d] || []).push(id);
  }

  // --- E. non-code inventory ---
  const nonCodeFiles = { documentation: [], infrastructure: [], data: [], config: [] };
  for (const n of nodes) {
    const entry = { id: n.id, name: n.name, type: n.type, summary: sumOf(n.id) };
    if (n.type === "document") nonCodeFiles.documentation.push(entry);
    else if (["service", "pipeline", "resource"].includes(n.type)) nonCodeFiles.infrastructure.push(entry);
    else if (["table", "schema", "endpoint"].includes(n.type)) nonCodeFiles.data.push(entry);
    else if (n.type === "config") nonCodeFiles.config.push(entry);
  }

  // --- F. clusters from bidirectional relationships ---
  const biPairs = [];
  for (const e of edges) {
    if (e.type !== "imports" && e.type !== "calls") continue;
    const rev = e.target + "||" + e.source + "||" + e.type;
    if (edgeSet.has(rev) && e.source < e.target) {
      biPairs.push([e.source, e.target]);
    }
  }
  // also use high mutual undirected connectivity as fallback seeds
  const clusters = [];
  const used = new Set();
  // helper: neighbors (any direction)
  const neigh = new Map();
  for (const n of nodes) neigh.set(n.id, new Set());
  for (const e of edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    neigh.get(e.source).add(e.target);
    neigh.get(e.target).add(e.source);
  }
  function buildCluster(seed) {
    const members = new Set(seed);
    let changed = true;
    while (changed && members.size < 5) {
      changed = false;
      let best = null, bestCount = 1;
      for (const cand of nodeById.keys()) {
        if (members.has(cand)) continue;
        let c = 0;
        for (const m of members) if (neigh.get(cand).has(m)) c++;
        if (c >= 2 && c > bestCount) { best = cand; bestCount = c; }
      }
      if (best) { members.add(best); changed = true; }
    }
    return members;
  }
  for (const [a, b] of biPairs) {
    if (used.has(a) || used.has(b)) continue;
    const members = buildCluster([a, b]);
    for (const m of members) used.add(m);
    // count edges within cluster
    let ec = 0;
    for (const e of edges) {
      if (members.has(e.source) && members.has(e.target)) ec++;
    }
    clusters.push({ nodes: [...members], edgeCount: ec });
  }
  // fallback: dense undirected pairs if too few clusters
  if (clusters.length < 5) {
    const dense = [...undirectedCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
    for (const [key] of dense) {
      const [a, b] = key.split("|");
      if (used.has(a) || used.has(b)) continue;
      const members = buildCluster([a, b]);
      for (const m of members) used.add(m);
      let ec = 0;
      for (const e of edges) if (members.has(e.source) && members.has(e.target)) ec++;
      clusters.push({ nodes: [...members], edgeCount: ec });
      if (clusters.length >= 10) break;
    }
  }
  clusters.sort((a, b) => b.edgeCount - a.edgeCount);
  const topClusters = clusters.slice(0, 10);

  // --- G. layers ---
  const layerOut = {
    count: layers.length,
    list: layers.map((l) => ({ id: l.id, name: l.name, description: l.description || "" })),
  };

  // --- H. node summary index ---
  const nodeSummaryIndex = {};
  for (const n of nodes) {
    nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary || "" };
  }

  // enrich entry candidates with summaries
  const entryPointCandidatesOut = entryPointCandidates.map((c) => ({
    id: c.id, score: c.score, name: c.name, summary: c.summary,
  }));

  const result = {
    scriptCompleted: true,
    entryPointCandidates: entryPointCandidatesOut,
    fanInRanking,
    fanOutRanking,
    bfsTraversal: { startNode, order, depthMap, byDepth },
    nonCodeFiles,
    clusters: topClusters,
    layers: layerOut,
    nodeSummaryIndex,
    totalNodes: nodes.length,
    totalEdges: edges.length,
  };

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.error("OK: wrote " + outPath);
  process.exit(0);
}

try { main(); } catch (e) {
  console.error("FATAL: " + (e && e.stack ? e.stack : e));
  process.exit(1);
}
