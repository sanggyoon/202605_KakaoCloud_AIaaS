#!/usr/bin/env node
'use strict';

const fs = require('fs');

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    console.error('Usage: node ua-arch-analyze.js <input.json> <output.json>');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const fileNodes = data.fileNodes || [];
  const importEdges = data.importEdges || [];
  const allEdges = data.allEdges || [];

  const byId = new Map();
  for (const n of fileNodes) byId.set(n.id, n);

  // ---- Common prefix ----
  const paths = fileNodes.map(n => n.filePath || '');
  function commonPrefixDir(ps) {
    if (ps.length === 0) return '';
    const split = ps.map(p => p.split('/'));
    let prefix = [];
    const first = split[0];
    for (let i = 0; i < first.length - 1; i++) { // never consume the filename
      const seg = first[i];
      if (split.every(s => s.length > i + 1 && s[i] === seg)) prefix.push(seg);
      else break;
    }
    return prefix.length ? prefix.join('/') + '/' : '';
  }
  const prefix = commonPrefixDir(paths);

  // ---- A. Directory grouping ----
  const directoryGroups = {};
  const fileToGroup = {};
  for (const n of fileNodes) {
    let p = n.filePath || '';
    let rel = prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p;
    const segs = rel.split('/');
    let group = segs.length > 1 ? segs[0] : 'root';
    if (!directoryGroups[group]) directoryGroups[group] = [];
    directoryGroups[group].push(n.id);
    fileToGroup[n.id] = group;
  }

  // ---- B. Node type grouping ----
  const nodeTypeGroups = {};
  for (const n of fileNodes) {
    if (!nodeTypeGroups[n.type]) nodeTypeGroups[n.type] = [];
    nodeTypeGroups[n.type].push(n.id);
  }

  // ---- C. Fan-in / fan-out (imports only) ----
  const fanIn = {}, fanOut = {};
  for (const n of fileNodes) { fanIn[n.id] = 0; fanOut[n.id] = 0; }
  for (const e of importEdges) {
    if (fanOut[e.source] !== undefined) fanOut[e.source]++;
    if (fanIn[e.target] !== undefined) fanIn[e.target]++;
  }

  // ---- D. Cross-category edges (allEdges by node type) ----
  const ccMap = new Map();
  for (const e of allEdges) {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (!s || !t) continue;
    if (s.type === 'file' && t.type === 'file') continue; // pure code import handled elsewhere
    const key = s.type + '|' + t.type + '|' + (e.type || 'unknown');
    ccMap.set(key, (ccMap.get(key) || 0) + 1);
  }
  const crossCategoryEdges = [];
  for (const [k, count] of ccMap) {
    const [fromType, toType, edgeType] = k.split('|');
    crossCategoryEdges.push({ fromType, toType, edgeType, count });
  }
  crossCategoryEdges.sort((a, b) => b.count - a.count);

  // ---- E. Inter-group import frequency ----
  const igMap = new Map();
  for (const e of importEdges) {
    const fg = fileToGroup[e.source], tg = fileToGroup[e.target];
    if (fg === undefined || tg === undefined || fg === tg) continue;
    const key = fg + '|' + tg;
    igMap.set(key, (igMap.get(key) || 0) + 1);
  }
  const interGroupImports = [];
  for (const [k, count] of igMap) {
    const [from, to] = k.split('|');
    interGroupImports.push({ from, to, count });
  }
  interGroupImports.sort((a, b) => b.count - a.count);

  // ---- F. Intra-group density (use allEdges for richer signal) ----
  const intraGroupDensity = {};
  for (const g of Object.keys(directoryGroups)) {
    intraGroupDensity[g] = { internalEdges: 0, totalEdges: 0, density: 0 };
  }
  for (const e of allEdges) {
    const fg = fileToGroup[e.source], tg = fileToGroup[e.target];
    if (fg !== undefined) {
      intraGroupDensity[fg].totalEdges++;
      if (fg === tg) intraGroupDensity[fg].internalEdges++;
    }
    if (tg !== undefined && tg !== fg) {
      intraGroupDensity[tg].totalEdges++;
    }
  }
  for (const g of Object.keys(intraGroupDensity)) {
    const d = intraGroupDensity[g];
    d.density = d.totalEdges ? +(d.internalEdges / d.totalEdges).toFixed(3) : 0;
  }

  // ---- G. Directory pattern matching ----
  const patternTable = [
    [['routes','api','controllers','endpoints','handlers','controller','routers','blueprints','serializers'], 'api'],
    [['services','core','lib','domain','logic','signals','composables','mailers','jobs','channels','internal'], 'service'],
    [['models','db','data','persistence','repository','entities','entity','migrations','sql','database'], 'data'],
    [['components','views','pages','ui','layouts','screens'], 'ui'],
    [['middleware','plugins','interceptors','guards'], 'middleware'],
    [['utils','helpers','common','shared','tools','templatetags','pkg'], 'utility'],
    [['config','constants','env','settings','management','commands'], 'config'],
    [['__tests__','test','tests','spec','specs'], 'test'],
    [['types','interfaces','schemas','contracts','dtos','dto','request','response'], 'types'],
    [['hooks'], 'hooks'],
    [['store','state','reducers','actions','slices'], 'state'],
    [['assets','static','public'], 'assets'],
    [['cmd','bin'], 'entry'],
    [['docs','documentation','wiki'], 'documentation'],
    [['deploy','deployment','infra','infrastructure'], 'infrastructure'],
    [['.github','.gitlab','.circleci'], 'ci-cd'],
    [['k8s','kubernetes','helm','charts'], 'infrastructure'],
    [['terraform','tf'], 'infrastructure'],
    [['docker'], 'infrastructure'],
  ];
  function matchDir(name) {
    const lower = name.toLowerCase();
    for (const [keys, label] of patternTable) {
      if (keys.includes(lower)) return label;
    }
    return null;
  }
  const patternMatches = {};
  for (const g of Object.keys(directoryGroups)) {
    const m = matchDir(g);
    if (m) patternMatches[g] = m;
  }

  // file-level pattern hints
  function filePattern(n) {
    const p = (n.filePath || '');
    const base = n.name || p.split('/').pop();
    if (/\.(test|spec)\.[a-z]+$/i.test(base) || /^test_.*\.py$/i.test(base) || /_test\.go$/i.test(base) || /Test\.java$/.test(base) || /_spec\.rb$/.test(base) || /Test\.php$/.test(base) || /Tests\.cs$/.test(base)) return 'test';
    if (/\.d\.ts$/.test(base)) return 'types';
    if (/^Dockerfile/i.test(base) || /^docker-compose/i.test(base)) return 'infrastructure';
    if (/\.tf$|\.tfvars$/.test(base)) return 'infrastructure';
    if (/Makefile$/.test(base)) return 'infrastructure';
    if (/Jenkinsfile$/.test(base) || /\.gitlab-ci\.yml$/.test(base) || /\.github\/workflows\//.test(p)) return 'ci-cd';
    if (/\.sql$/.test(base)) return 'data';
    if (/\.(graphql|gql|proto)$/.test(base)) return 'types';
    if (/\.(md|rst)$/i.test(base)) return 'documentation';
    return null;
  }
  const filePatternMatches = {};
  for (const n of fileNodes) {
    const m = filePattern(n);
    if (m) filePatternMatches[n.id] = m;
  }

  // ---- H. Deployment topology ----
  const infraFiles = [];
  let hasDockerfile = false, hasCompose = false, hasK8s = false, hasTerraform = false, hasCI = false;
  for (const n of fileNodes) {
    const p = n.filePath || '', base = n.name || '';
    if (/^Dockerfile/i.test(base)) { hasDockerfile = true; infraFiles.push(p); }
    else if (/^docker-compose/i.test(base)) { hasCompose = true; infraFiles.push(p); }
    else if (/\.tf$|\.tfvars$/.test(base)) { hasTerraform = true; infraFiles.push(p); }
    else if (/\.github\/workflows\//.test(p) || /Jenkinsfile$/.test(base) || /\.gitlab-ci\.yml$/.test(base)) { hasCI = true; infraFiles.push(p); }
    else if (/(deployment|kustomization|ingress|service|statefulset|daemonset)\.ya?ml$/i.test(base) || /manifests\//.test(p)) { hasK8s = true; }
  }
  const deploymentTopology = { hasDockerfile, hasCompose, hasK8s, hasTerraform, hasCI, infraFiles };

  // ---- I. Data pipeline ----
  const dataPipeline = { schemaFiles: [], migrationFiles: [], dataModelFiles: [], apiHandlerFiles: [] };
  for (const n of fileNodes) {
    const p = n.filePath || '', base = n.name || '';
    const tags = (n.tags || []).map(t => t.toLowerCase());
    if (/\.(graphql|gql|proto|prisma)$/.test(base) || /schema/i.test(base)) dataPipeline.schemaFiles.push(p);
    if (/migrations?\//.test(p) || /\.sql$/.test(base)) dataPipeline.migrationFiles.push(p);
    if (tags.includes('model') || /models?\//.test(p) || tags.includes('orm')) dataPipeline.dataModelFiles.push(p);
    if (tags.includes('api-handler') || tags.includes('endpoint') || n.type === 'endpoint' || /routes?\//.test(p)) dataPipeline.apiHandlerFiles.push(p);
  }

  // ---- J. Documentation coverage ----
  const docGroups = new Set();
  for (const n of fileNodes) {
    if (filePattern(n) === 'documentation') {
      docGroups.add(fileToGroup[n.id]);
    }
  }
  const totalGroups = Object.keys(directoryGroups).length;
  const undocumentedGroups = Object.keys(directoryGroups).filter(g => !docGroups.has(g));
  const docCoverage = {
    groupsWithDocs: docGroups.size,
    totalGroups,
    coverageRatio: totalGroups ? +(docGroups.size / totalGroups).toFixed(2) : 0,
    undocumentedGroups,
  };

  // ---- K. Dependency direction ----
  const pairDir = new Map();
  for (const e of importEdges) {
    const fg = fileToGroup[e.source], tg = fileToGroup[e.target];
    if (fg === undefined || tg === undefined || fg === tg) continue;
    const a = fg, b = tg;
    const key = [a, b].sort().join('|');
    if (!pairDir.has(key)) pairDir.set(key, {});
    const o = pairDir.get(key);
    o[a + '->' + b] = (o[a + '->' + b] || 0) + 1;
  }
  const dependencyDirection = [];
  for (const [key, counts] of pairDir) {
    const [g1, g2] = key.split('|');
    const f = counts[g1 + '->' + g2] || 0;
    const r = counts[g2 + '->' + g1] || 0;
    if (f >= r && f > 0) dependencyDirection.push({ dependent: g1, dependsOn: g2 });
    else if (r > f) dependencyDirection.push({ dependent: g2, dependsOn: g1 });
  }

  // ---- file stats ----
  const filesPerGroup = {};
  for (const g of Object.keys(directoryGroups)) filesPerGroup[g] = directoryGroups[g].length;
  const nodeTypeCounts = {};
  for (const t of Object.keys(nodeTypeGroups)) nodeTypeCounts[t] = nodeTypeGroups[t].length;

  const result = {
    scriptCompleted: true,
    commonPrefix: prefix,
    directoryGroups,
    nodeTypeGroups,
    crossCategoryEdges,
    interGroupImports,
    intraGroupDensity,
    patternMatches,
    filePatternMatches,
    deploymentTopology,
    dataPipeline,
    docCoverage,
    dependencyDirection,
    fileStats: { totalFileNodes: fileNodes.length, filesPerGroup, nodeTypeCounts },
    fileFanIn: fanIn,
    fileFanOut: fanOut,
  };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log('Wrote results to ' + outputPath);
  process.exit(0);
}

try { main(); } catch (err) { console.error(err && err.stack || err); process.exit(1); }
