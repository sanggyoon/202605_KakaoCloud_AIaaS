#!/usr/bin/env node
"use strict";

function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) {
    console.error("Usage: node ua-tour-analyze.js <input.json> <output.json>");
    process.exit(1);
  }
  const fs = require("fs");
  const data = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const layers = data.layers || [];

  const nodeById = new Map();
  nodes.forEach((n) => nodeById.set(n.id, n));

  // --- Adjacency ---
  const fanIn = new Map();
  const fanOut = new Map();
  nodes.forEach((n) => { fanIn.set(n.id, 0); fanOut.set(n.id, 0); });
  const outAdj = new Map(); // for BFS (imports/calls)
  nodes.forEach((n) => outAdj.set(n.id, []));

  edges.forEach((e) => {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) return;
    fanOut.set(e.source, fanOut.get(e.source) + 1);
    fanIn.set(e.target, fanIn.get(e.target) + 1);
    if (e.type === "imports" || e.type === "calls") {
      outAdj.get(e.source).push(e.target);
    }
  });

  const nm = (id) => (nodeById.get(id) ? nodeById.get(id).name : id);
  const sm = (id) => (nodeById.get(id) ? nodeById.get(id).summary : "");

  // --- A. Fan-In ---
  const fanInRanking = [...fanIn.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id, c]) => ({ id, fanIn: c, name: nm(id) }));

  // --- B. Fan-Out ---
  const fanOutRanking = [...fanOut.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id, c]) => ({ id, fanOut: c, name: nm(id) }));

  // --- C. Entry point candidates ---
  const fanOutVals = [...fanOut.values()].sort((a, b) => b - a);
  const top10pctIdx = Math.max(0, Math.floor(fanOutVals.length * 0.1) - 1);
  const top10pctThreshold = fanOutVals.length ? fanOutVals[Math.min(top10pctIdx, fanOutVals.length - 1)] : 0;
  const fanInValsAsc = [...fanIn.values()].sort((a, b) => a - b);
  const bottom25Idx = Math.max(0, Math.floor(fanInValsAsc.length * 0.25) - 1);
  const bottom25Threshold = fanInValsAsc.length ? fanInValsAsc[Math.min(bottom25Idx, fanInValsAsc.length - 1)] : 0;

  const codeEntryNames = new Set([
    "index.ts","index.js","main.ts","main.js","app.ts","app.js","server.ts","server.js",
    "mod.rs","main.go","main.py","main.rs","manage.py","app.py","wsgi.py","asgi.py","run.py",
    "__main__.py","Application.java","Main.java","Program.cs","config.ru","index.php",
    "App.swift","Application.kt","main.cpp","main.c","page.tsx"
  ]);

  const entryScores = [];
  nodes.forEach((n) => {
    let score = 0;
    const isDoc = n.type === "document";
    const fp = n.filePath || "";
    const depth = fp.split("/").filter(Boolean).length;
    if (isDoc) {
      const base = (n.name || "").toLowerCase();
      if (base === "readme.md" && depth <= 1) score += 5;
      else if (base.endsWith(".md") && depth <= 1) score += 2;
    } else if (n.type === "file") {
      if (codeEntryNames.has(n.name)) score += 3;
      if (depth <= 2) score += 1;
      if (fanOut.get(n.id) >= top10pctThreshold && top10pctThreshold > 0) score += 1;
      if (fanIn.get(n.id) <= bottom25Threshold) score += 1;
    }
    if (score > 0) entryScores.push({ id: n.id, score, name: n.name, summary: sm(n.id) });
  });
  entryScores.sort((a, b) => b.score - a.score);
  const entryPointCandidates = entryScores.slice(0, 5);

  // --- D. BFS from top CODE entry point ---
  const codeEntry = entryScores.find((e) => {
    const t = nodeById.get(e.id);
    return t && t.type === "file";
  });
  let bfsTraversal = { startNode: null, order: [], depthMap: {}, byDepth: {} };
  if (codeEntry) {
    const start = codeEntry.id;
    const visited = new Set([start]);
    const depthMap = { [start]: 0 };
    const order = [start];
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      const d = depthMap[cur];
      (outAdj.get(cur) || []).forEach((t) => {
        if (!visited.has(t)) {
          visited.add(t);
          depthMap[t] = d + 1;
          order.push(t);
          queue.push(t);
        }
      });
    }
    const byDepth = {};
    Object.entries(depthMap).forEach(([id, d]) => {
      (byDepth[d] = byDepth[d] || []).push(id);
    });
    bfsTraversal = { startNode: start, order, depthMap, byDepth };
  }

  // --- E. Non-code inventory ---
  const nonCodeFiles = { documentation: [], infrastructure: [], data: [], config: [] };
  nodes.forEach((n) => {
    const rec = { id: n.id, name: n.name, type: n.type, summary: sm(n.id) };
    if (n.type === "document") nonCodeFiles.documentation.push(rec);
    else if (["service", "pipeline", "resource"].includes(n.type)) nonCodeFiles.infrastructure.push(rec);
    else if (["table", "schema", "endpoint"].includes(n.type)) nonCodeFiles.data.push(rec);
    else if (n.type === "config") nonCodeFiles.config.push(rec);
  });

  // --- F. Clusters from bidirectional edges ---
  const pairKey = (a, b) => [a, b].sort().join("||");
  const dirEdges = new Set();
  edges.forEach((e) => {
    if (e.type === "imports" || e.type === "calls" || e.type === "depends_on") {
      dirEdges.add(e.source + ">>" + e.target);
    }
  });
  const biPairs = [];
  const seenPair = new Set();
  dirEdges.forEach((k) => {
    const [a, b] = k.split(">>");
    if (dirEdges.has(b + ">>" + a)) {
      const pk = pairKey(a, b);
      if (!seenPair.has(pk)) { seenPair.add(pk); biPairs.push([a, b]); }
    }
  });
  // adjacency for cluster expansion (all directional edges, undirected)
  const undAdj = new Map();
  nodes.forEach((n) => undAdj.set(n.id, new Set()));
  edges.forEach((e) => {
    if (["imports", "calls", "depends_on"].includes(e.type)) {
      if (undAdj.has(e.source)) undAdj.get(e.source).add(e.target);
      if (undAdj.has(e.target)) undAdj.get(e.target).add(e.source);
    }
  });
  const clusters = [];
  const usedInCluster = new Set();
  biPairs.forEach(([a, b]) => {
    if (usedInCluster.has(a) && usedInCluster.has(b)) return;
    const members = new Set([a, b]);
    // expand: add nodes connected to 2+ members
    let changed = true;
    while (changed && members.size < 5) {
      changed = false;
      const candidates = new Map();
      members.forEach((m) => {
        (undAdj.get(m) || new Set()).forEach((t) => {
          if (!members.has(t)) candidates.set(t, (candidates.get(t) || 0) + 1);
        });
      });
      for (const [c, cnt] of candidates) {
        if (cnt >= 2 && members.size < 5) { members.add(c); changed = true; }
      }
    }
    // count edges within cluster
    let edgeCount = 0;
    edges.forEach((e) => {
      if (members.has(e.source) && members.has(e.target) &&
          ["imports", "calls", "depends_on"].includes(e.type)) edgeCount++;
    });
    members.forEach((m) => usedInCluster.add(m));
    clusters.push({ nodes: [...members], edgeCount });
  });
  // If too few bidirectional clusters, add densest depends_on neighborhoods
  clusters.sort((a, b) => b.edgeCount - a.edgeCount);
  const topClusters = clusters.slice(0, 10);

  // --- G. Layers ---
  const layerOut = {
    count: layers.length,
    list: layers.map((l) => ({ id: l.id, name: l.name, description: l.description })),
  };

  // --- H. Node summary index ---
  const nodeSummaryIndex = {};
  nodes.forEach((n) => {
    nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary || "" };
  });

  const result = {
    scriptCompleted: true,
    entryPointCandidates,
    fanInRanking,
    fanOutRanking,
    bfsTraversal,
    nonCodeFiles,
    clusters: topClusters,
    layers: layerOut,
    nodeSummaryIndex,
    totalNodes: nodes.length,
    totalEdges: edges.length,
  };

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log("Analysis complete. Nodes:", nodes.length, "Edges:", edges.length);
}

try {
  main();
} catch (e) {
  console.error("FATAL:", e && e.stack ? e.stack : e);
  process.exit(1);
}
