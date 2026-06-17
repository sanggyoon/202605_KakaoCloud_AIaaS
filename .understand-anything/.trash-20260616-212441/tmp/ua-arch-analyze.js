#!/usr/bin/env node
'use strict';
const fs = require('fs');

function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) {
    console.error('usage: node ua-arch-analyze.js <input.json> <output.json>');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const fileNodes = data.fileNodes || [];
  const importEdges = data.importEdges || [];
  const allEdges = data.allEdges || [];

  const idToNode = {};
  for (const n of fileNodes) idToNode[n.id] = n;

  // ---- Common prefix ----
  const paths = fileNodes.map(n => n.filePath || '').filter(Boolean);
  function commonPrefixDir(ps) {
    if (ps.length === 0) return '';
    const split = ps.map(p => p.split('/'));
    let prefix = [];
    const first = split[0];
    for (let i = 0; i < first.length - 1; i++) {
      const seg = first[i];
      if (split.every(s => s.length > i + 1 && s[i] === seg)) prefix.push(seg);
      else break;
    }
    return prefix.length ? prefix.join('/') + '/' : '';
  }
  const prefix = commonPrefixDir(paths);

  // ---- A. Directory grouping ----
  function groupOf(fp) {
    let rel = fp;
    if (prefix && rel.startsWith(prefix)) rel = rel.slice(prefix.length);
    const parts = rel.split('/');
    if (parts.length === 1) return '(root)';
    return parts[0];
  }
  const directoryGroups = {};
  const nodeGroup = {};
  for (const n of fileNodes) {
    const g = groupOf(n.filePath || '');
    nodeGroup[n.id] = g;
    (directoryGroups[g] = directoryGroups[g] || []).push(n.id);
  }

  // ---- B. Node type grouping ----
  const nodeTypeGroups = {};
  for (const n of fileNodes) {
    (nodeTypeGroups[n.type] = nodeTypeGroups[n.type] || []).push(n.id);
  }

  // ---- C. Import adjacency: fan-in / fan-out ----
  const fanOut = {}, fanIn = {};
  for (const n of fileNodes) { fanOut[n.id] = 0; fanIn[n.id] = 0; }
  for (const e of importEdges) {
    if (fanOut[e.source] !== undefined) fanOut[e.source]++;
    if (fanIn[e.target] !== undefined) fanIn[e.target]++;
  }

  // ---- D. Cross-category edges ----
  const crossMap = {};
  for (const e of allEdges) {
    const s = idToNode[e.source], t = idToNode[e.target];
    if (!s || !t) continue;
    if (s.type === t.type) continue;
    const key = s.type + '|' + t.type + '|' + e.type;
    crossMap[key] = (crossMap[key] || 0) + 1;
  }
  const crossCategoryEdges = Object.entries(crossMap).map(([k, count]) => {
    const [fromType, toType, edgeType] = k.split('|');
    return { fromType, toType, edgeType, count };
  }).sort((a, b) => b.count - a.count);

  // ---- E. Inter-group import frequency ----
  const interMap = {};
  for (const e of importEdges) {
    const gs = nodeGroup[e.source], gt = nodeGroup[e.target];
    if (gs === undefined || gt === undefined) continue;
    if (gs === gt) continue;
    const key = gs + '|' + gt;
    interMap[key] = (interMap[key] || 0) + 1;
  }
  const interGroupImports = Object.entries(interMap).map(([k, count]) => {
    const [from, to] = k.split('|');
    return { from, to, count };
  }).sort((a, b) => b.count - a.count);

  // ---- F. Intra-group density ----
  const intraGroupDensity = {};
  const groupTotalEdges = {}, groupInternalEdges = {};
  for (const g of Object.keys(directoryGroups)) { groupTotalEdges[g] = 0; groupInternalEdges[g] = 0; }
  for (const e of importEdges) {
    const gs = nodeGroup[e.source], gt = nodeGroup[e.target];
    if (gs !== undefined) groupTotalEdges[gs]++;
    if (gt !== undefined && gt !== gs) groupTotalEdges[gt]++;
    if (gs !== undefined && gs === gt) { groupInternalEdges[gs]++; groupTotalEdges[gs]++; }
  }
  for (const g of Object.keys(directoryGroups)) {
    const tot = groupTotalEdges[g];
    intraGroupDensity[g] = {
      internalEdges: groupInternalEdges[g],
      totalEdges: tot,
      density: tot > 0 ? +(groupInternalEdges[g] / tot).toFixed(3) : 0
    };
  }

  // ---- G. Pattern matching ----
  const dirPatterns = [
    [['routes','api','controllers','endpoints','handlers'], 'api'],
    [['services','core','lib','domain','logic'], 'service'],
    [['models','db','data','persistence','repository','entities'], 'data'],
    [['components','views','pages','ui','layouts','screens'], 'ui'],
    [['middleware','plugins','interceptors','guards'], 'middleware'],
    [['utils','helpers','common','shared','tools'], 'utility'],
    [['config','constants','env','settings'], 'config'],
    [['__tests__','test','tests','spec','specs'], 'test'],
    [['types','interfaces','schemas','contracts','dtos'], 'types'],
    [['hooks'], 'hooks'],
    [['store','state','reducers','actions','slices'], 'state'],
    [['assets','static','public'], 'assets'],
    [['migrations'], 'data'],
    [['management','commands'], 'config'],
    [['templatetags'], 'utility'],
    [['signals'], 'service'],
    [['serializers'], 'api'],
    [['cmd'], 'entry'],
    [['internal'], 'service'],
    [['pkg'], 'utility'],
    [['dto','request','response'], 'types'],
    [['entity'], 'data'],
    [['controller'], 'api'],
    [['routers'], 'api'],
    [['composables'], 'service'],
    [['blueprints'], 'api'],
    [['mailers','jobs','channels'], 'service'],
    [['bin'], 'entry'],
    [['docs','documentation','wiki'], 'documentation'],
    [['deploy','deployment','infra','infrastructure'], 'infrastructure'],
    [['.github','.gitlab','.circleci'], 'ci-cd'],
    [['k8s','kubernetes','helm','charts'], 'infrastructure'],
    [['terraform','tf'], 'infrastructure'],
    [['docker'], 'infrastructure'],
    [['sql','database'], 'data'],
  ];
  function matchDir(name) {
    const low = name.toLowerCase();
    for (const [keys, label] of dirPatterns) {
      if (keys.includes(low)) return label;
    }
    return null;
  }
  const patternMatches = {};
  for (const g of Object.keys(directoryGroups)) {
    const m = matchDir(g);
    if (m) patternMatches[g] = m;
  }

  // file-level pattern helpers
  function fileLabel(fp, name) {
    const base = name || fp.split('/').pop();
    if (/(\.test\.|\.spec\.)/.test(base) || /^test_.*\.py$/.test(base) || /_test\.go$/.test(base) || /Test\.java$/.test(base) || /_spec\.rb$/.test(base) || /Test\.php$/.test(base) || /Tests\.cs$/.test(base)) return 'test';
    if (/\.d\.ts$/.test(base)) return 'types';
    if (base === 'manage.py') return 'entry';
    if (base === 'wsgi.py' || base === 'asgi.py') return 'config';
    if (base === 'main.rs' || base === 'lib.rs') return 'entry';
    if (base === 'Application.java' || base === 'Program.cs') return 'entry';
    if (base === 'config.ru') return 'entry';
    if (['Cargo.toml','go.mod','Gemfile','pom.xml','build.gradle','composer.json'].includes(base)) return 'config';
    if (base === 'Dockerfile' || /^docker-compose.*\.(ya?ml)$/.test(base) || /^Dockerfile/.test(base)) return 'infrastructure';
    if (/\.tf$/.test(base) || /\.tfvars$/.test(base)) return 'infrastructure';
    if (base === '.gitlab-ci.yml' || base === 'Jenkinsfile') return 'ci-cd';
    if (/\.sql$/.test(base)) return 'data';
    if (/\.(graphql|gql|proto)$/.test(base)) return 'types';
    if (/\.(md|rst)$/.test(base)) return 'documentation';
    if (base === 'Makefile') return 'infrastructure';
    if (fp.includes('.github/workflows/')) return 'ci-cd';
    return null;
  }
  const fileLabels = {};
  for (const n of fileNodes) {
    const lbl = fileLabel(n.filePath || '', n.name);
    if (lbl) fileLabels[n.id] = lbl;
  }

  // ---- H. Deployment topology ----
  const infraFiles = [];
  let hasDockerfile = false, hasCompose = false, hasK8s = false, hasTerraform = false, hasCI = false;
  for (const n of fileNodes) {
    const fp = n.filePath || '', base = n.name || fp.split('/').pop();
    if (base === 'Dockerfile' || /^Dockerfile/.test(base)) { hasDockerfile = true; infraFiles.push(fp); }
    else if (/^docker-compose.*\.(ya?ml)$/.test(base)) { hasCompose = true; infraFiles.push(fp); }
    else if (/\.tf$/.test(base) || /\.tfvars$/.test(base)) { hasTerraform = true; infraFiles.push(fp); }
    else if (fp.includes('.github/workflows/') || base === '.gitlab-ci.yml' || base === 'Jenkinsfile') { hasCI = true; infraFiles.push(fp); }
    if (/(k8s|kubernetes|helm|chart|manifest)/i.test(fp) || n.type === 'resource') { hasK8s = true; }
  }
  const deploymentTopology = { hasDockerfile, hasCompose, hasK8s, hasTerraform, hasCI, infraFiles };

  // ---- I. Data pipeline ----
  const schemaFiles = [], migrationFiles = [], dataModelFiles = [], apiHandlerFiles = [];
  for (const n of fileNodes) {
    const fp = n.filePath || '', base = n.name || '';
    if (/\.(sql|graphql|gql|proto|prisma)$/.test(base) || n.type === 'schema' || n.type === 'table') schemaFiles.push(fp);
    if (/migration/i.test(fp) || n.type === 'table') migrationFiles.push(fp);
    if (/(models?|entities|entity)/i.test(fp)) dataModelFiles.push(fp);
    if (/(routes?|api|controllers?|handlers?|endpoints?)/i.test(fp) || n.type === 'endpoint') apiHandlerFiles.push(fp);
  }
  const dataPipeline = { schemaFiles, migrationFiles, dataModelFiles, apiHandlerFiles };

  // ---- J. Documentation coverage ----
  const groupsWithDocs = new Set();
  for (const n of fileNodes) {
    if (n.type === 'document' || /\.(md|rst)$/.test(n.name || '')) {
      groupsWithDocs.add(nodeGroup[n.id]);
    }
  }
  const allGroups = Object.keys(directoryGroups);
  const undocumentedGroups = allGroups.filter(g => !groupsWithDocs.has(g));
  const docCoverage = {
    groupsWithDocs: groupsWithDocs.size,
    totalGroups: allGroups.length,
    coverageRatio: allGroups.length ? +(groupsWithDocs.size / allGroups.length).toFixed(2) : 0,
    undocumentedGroups
  };

  // ---- K. Dependency direction ----
  const pairCount = {};
  for (const { from, to, count } of interGroupImports) {
    pairCount[from + '|' + to] = count;
  }
  const seen = new Set();
  const dependencyDirection = [];
  for (const { from, to } of interGroupImports) {
    const a = from, b = to;
    const key = [a, b].sort().join('||');
    if (seen.has(key)) continue;
    seen.add(key);
    const ab = pairCount[a + '|' + b] || 0;
    const ba = pairCount[b + '|' + a] || 0;
    if (ab >= ba) dependencyDirection.push({ dependent: a, dependsOn: b });
    else dependencyDirection.push({ dependent: b, dependsOn: a });
  }

  // ---- File stats ----
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
    fileLabels,
    deploymentTopology,
    dataPipeline,
    docCoverage,
    dependencyDirection,
    fileStats: {
      totalFileNodes: fileNodes.length,
      filesPerGroup,
      nodeTypeCounts
    },
    fileFanIn: fanIn,
    fileFanOut: fanOut
  };
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log('OK: wrote', outPath);
}

try { main(); } catch (e) { console.error(e && e.stack ? e.stack : String(e)); process.exit(1); }
