import json
from collections import defaultdict

g = json.load(open('.understand-anything/intermediate/assembled-graph.json'))
nodes = g['nodes']
edges = g['edges']
assign = json.load(open('.understand-anything/tmp/ua-layer-assign.json'))

nodeById = {n['id']: n for n in nodes}
subfile_types = {'function', 'class', 'step'}

parent = {}
for e in edges:
    if e['type'] == 'contains':
        parent[e['target']] = e['source']

for n in nodes:
    if n['id'] in assign:
        continue
    if n['type'] in subfile_types:
        p = parent.get(n['id'])
        layer = None
        seen = set()
        while p and p not in seen:
            seen.add(p)
            if p in assign:
                layer = assign[p]
                break
            p = parent.get(p)
        if layer is None:
            fp = n.get('filePath')
            for cand_id, lay in assign.items():
                cn = nodeById.get(cand_id, {})
                if cn.get('filePath') == fp and cn.get('type') in ('file', 'config', 'schema', 'table'):
                    layer = lay
                    break
        assign[n['id']] = layer or 'documentation'

missing = [n['id'] for n in nodes if n['id'] not in assign]
print('missing:', len(missing))
for m in missing[:10]:
    print('  ', m, nodeById[m]['type'])

layer_meta = {
    'frontend': ('frontend', 'Frontend UI 레이어', 'Next.js 16 App Router 기반 영화/climax-graph 공개 UI, 매니저 대시보드, Supabase/BE로 프록시하는 내부 API route handler 및 FE 유틸리티(lib).'),
    'backend': ('backend', 'Backend API 레이어', 'FastAPI 백엔드 — TMDB ingestion, 자막 수집, stats/visitor/active-model/reprocess 엔드포인트 및 배경 job 처리.'),
    'ml-pipeline': ('ml-pipeline', 'ML Pipeline 레이어', '자막 파싱 → roberta-va arousal/valence 장면 스코어링 → z-score+savgol 벡터 생성, KServe serving, train/score/vector 워크플로 및 라벨링 코드.'),
    'data': ('data', 'Data 레이어', 'DB schema, migration, RPC 정의 및 table 노드 — 4K_ML/db, 4K_BE/DB_SCRIPTS의 SQL 스키마와 seed/apply 스크립트.'),
    'infrastructure': ('infrastructure', 'Infrastructure 레이어', 'Ansible k3s 프로비저닝/Helm values, Argo·KServe·K8s manifests, ArgoCD GitOps, AWS Terraform DR failover, docker-compose, Dockerfile 등 배포 인프라.'),
    'ci-cd': ('ci-cd', 'CI/CD 레이어', 'GitHub Actions workflow 및 빌드/배포 파이프라인 정의.'),
    'test': ('test', 'Test 레이어', '4K_ML 신호처리·파이프라인 pytest 및 4K_BE 백엔드 테스트 스위트.'),
    'documentation': ('documentation', 'Documentation 레이어', '설계/스펙/런북 markdown 문서 및 프로젝트 README, requirements 명세.'),
}

order = ['frontend', 'backend', 'ml-pipeline', 'data', 'infrastructure', 'ci-cd', 'test', 'documentation']
buckets = defaultdict(list)
for n in nodes:
    buckets[assign[n['id']]].append(n['id'])

layers = []
for key in order:
    lid, name, desc = layer_meta[key]
    if not buckets[key]:
        continue
    layers.append({'id': 'layer:' + lid, 'name': name, 'description': desc, 'nodeIds': buckets[key]})

total = sum(len(l['nodeIds']) for l in layers)
print('total assigned:', total, 'of', len(nodes))
print('num layers:', len(layers))
for l in layers:
    print('  ', l['name'], len(l['nodeIds']))

# integrity: every node exactly once
seen = set()
dup = 0
for l in layers:
    for nid in l['nodeIds']:
        if nid in seen:
            dup += 1
        seen.add(nid)
print('duplicates:', dup, 'unique:', len(seen))

g['layers'] = layers
json.dump(g, open('.understand-anything/intermediate/assembled-graph.json', 'w'), ensure_ascii=False, indent=2)
print('WROTE assembled-graph.json')
