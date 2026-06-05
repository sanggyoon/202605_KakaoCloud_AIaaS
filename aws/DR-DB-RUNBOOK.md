# DR DB 런북 — 논리 복제(WireGuard) + 승격

서비스 DB(카카오 Supabase `data`)를 AWS DB EC2로 **논리 복제**하고, 장애 시 승격하는 절차.
인프라(EC2/EBS/SG/IAM)는 `aws/terraform/db.tf`로 이미 생성됨. 여기는 그 위 **운영 절차**.

- 카카오(publisher): K3s의 Supabase `data` Postgres (pgvector)
- AWS(subscriber): `peakly-db` EC2의 Postgres + PostgREST
- 채널: **WireGuard 터널** (vm1 ↔ AWS DB EC2) — Postgres를 공인망에 안 연다

> ⚠️ 논리 복제 한계: **DDL·함수·시퀀스·확장은 자동 복제 안 됨.** 스키마/pgvector/RPC는
> 레플리카에 1회 수동 생성하고, 스키마 변경 시 양쪽 반영. 데이터(행)만 복제된다.

---

## 5b. WireGuard 터널 (vm1 ↔ AWS DB EC2)

양쪽에 설치(이미 user_data/노드에 `wireguard-tools` 있음). 키 생성:
```bash
# 각 호스트에서
wg genkey | tee privatekey | wg pubkey > publickey
```

AWS DB EC2 `/etc/wireguard/wg0.conf` (터널망 예: 10.99.0.0/24):
```ini
[Interface]
Address = 10.99.0.2/24
ListenPort = 51820
PrivateKey = <AWS_PRIVATE_KEY>

[Peer]                       # 카카오 vm1
PublicKey = <VM1_PUBLIC_KEY>
Endpoint = 210.109.83.10:51820
AllowedIPs = 10.99.0.1/32
PersistentKeepalive = 25
```

카카오 vm1 `/etc/wireguard/wg0.conf`:
```ini
[Interface]
Address = 10.99.0.1/24
ListenPort = 51820
PrivateKey = <VM1_PRIVATE_KEY>

[Peer]                       # AWS DB EC2 (NAT 뒤 → endpoint 생략, keepalive로 유지)
PublicKey = <AWS_PUBLIC_KEY>
AllowedIPs = 10.99.0.2/32
```
> AWS DB EC2는 사설 서브넷(NAT 뒤)이라 vm1이 먼저 연결을 못 함 → **AWS쪽에 Endpoint+keepalive**를 둬서 AWS가 터널을 유지한다. db SG는 51820/udp를 `kakao_ip`에서 허용 중.

기동/확인:
```bash
systemctl enable --now wg-quick@wg0       # 양쪽
wg                                        # handshake 확인
ping 10.99.0.1                            # AWS→vm1 (또는 반대)
```

---

## 5c. 논리 복제 설정

### (1) 카카오 Postgres = publisher
Supabase Helm Postgres에 적용 (pod에 exec 또는 Helm values):
```sql
-- wal_level 등 (변경 후 Postgres 재시작 필요)
ALTER SYSTEM SET wal_level = logical;
ALTER SYSTEM SET max_replication_slots = 10;
ALTER SYSTEM SET max_wal_senders = 10;
-- 복제 전용 롤
CREATE ROLE repl WITH REPLICATION LOGIN PASSWORD '<강한비번>';
GRANT USAGE ON SCHEMA public TO repl;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO repl;
-- 서비스 테이블만 publication
CREATE PUBLICATION peakly_pub FOR TABLE public.movies, public.movie_vectors;
```
- `pg_hba.conf`에 WG 피어 허용: `host  all  repl  10.99.0.2/32  scram-sha-256`
- **vm1에서 Postgres 5432 노출**: data Postgres를 NodePort(예: 30432)로 띄워 AWS가
  `10.99.0.1:30432`로 접속하게 한다(공인 노출 X, WG 안에서만).
  ```bash
  kubectl -n data expose <postgres-svc/pod> --type=NodePort --port=5432 --name=pg-repl
  # 또는 기존 Service에 NodePort 추가. 할당된 NodePort 확인.
  ```

### (2) AWS 레플리카 = subscriber
DB EC2에서 Postgres(pgvector) + (나중에) PostgREST를 docker compose로:
```yaml
# /data/compose/docker-compose.yml
services:
  db:
    image: pgvector/pgvector:pg16        # 카카오와 호환되는 메이저 버전으로
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD: <로컬-superuser-비번>
    volumes:
      - /data/pgdata:/var/lib/postgresql/data
    ports: ["5432:5432"]
```
```bash
cd /data/compose && docker compose up -d
```

레플리카에 **스키마·확장·함수 1회 생성** (논리복제가 안 가져옴):
```sql
CREATE EXTENSION IF NOT EXISTS vector;
-- movies / movie_vectors 테이블 DDL (카카오와 동일하게)
-- RPC: find_similar_movies, find_preferred_movies 함수 정의
--   → 카카오에서 pg_dump --schema-only 로 뽑아 그대로 적용 권장:
--   pg_dump --schema-only -t movies -t movie_vectors -n public <카카오> > schema.sql
```

subscription 생성(WG 너머 publisher로):
```sql
CREATE SUBSCRIPTION peakly_sub
  CONNECTION 'host=10.99.0.1 port=30432 dbname=postgres user=repl password=<강한비번> sslmode=disable'
  PUBLICATION peakly_pub;
-- WG가 이미 암호화하므로 sslmode=disable 허용. (공인망이면 verify-full 필수)
```

확인:
```sql
SELECT * FROM pg_stat_subscription;             -- 복제 상태
SELECT count(*) FROM movies;                    -- 카카오와 행 수 비교
```

---

## 5d. AWS PostgREST + data.peakly.art failover

레플리카 앞에 PostgREST를 띄운다. **JWT secret은 카카오 Supabase와 동일**해야 anon/service 키가 검증됨(SSM `/peakly/dr/db/JWT_SECRET`).
```yaml
  postgrest:
    image: postgrest/postgrest:v12.2.3
    restart: unless-stopped
    environment:
      PGRST_DB_URI: "postgres://authenticator@db:5432/postgres"
      PGRST_DB_SCHEMAS: "public"
      PGRST_DB_ANON_ROLE: "anon"
      PGRST_JWT_SECRET: "<카카오와 동일한 JWT secret>"
    ports: ["3000:3000"]
    depends_on: [db]
```
> 레플리카에 `anon`/`authenticator`/`service_role` 롤 + 권한도 생성해야 PostgREST가 동작(카카오 스키마에서 함께 덤프).

Terraform(다음 단계)에서 추가할 것:
- ALB HTTPS 리스너에 **host = data.peakly.art → PostgREST TG(DB EC2:3000)** 규칙 (ACM `*.peakly.art`가 이미 커버)
- `data.peakly.art` **failover 레코드**: primary=카카오 Kong, secondary=AWS ALB(host data)
  - primary 헬스체크는 카카오 `data` 엔드포인트(`/rest/v1/`)용으로 별도 권장

---

## 5e. 승격(수동) + 역동기화

### 장애(DR) 발생 시 — 승격
논리 레플리카는 **이미 쓰기 가능**하므로 "승격"은 가벼움:
```sql
-- 1) 구독 중지 (죽은 카카오로의 연결 정리 + 충돌 방지)
ALTER SUBSCRIPTION peakly_sub DISABLE;
-- 2) 시퀀스 전진 (논리복제는 시퀀스 미동기 → PK 충돌 방지)
SELECT setval('movies_id_seq', (SELECT max(id) FROM movies));
-- (다른 시퀀스도 동일하게)
```
이제 앱은 `data.peakly.art`(→AWS PostgREST→레플리카)로 **읽기·쓰기**. App ASG는 이미 자동 기동됨.

### 카카오 복구 후 — 역동기화 (가장 신중하게)
AWS에서 쌓인 변경을 카카오로 되돌려야 함. 데이터량/시간에 따라:
- **소규모/짧은 장애**: AWS에서 변경분만 `pg_dump`로 떠 카카오에 머지(UPSERT).
- **확실히**: AWS→카카오 방향으로 **임시 논리복제**를 거꾸로 걸어 동기화 후, 컷오버 시점에
  앱을 다시 카카오로(Route53 primary 자동 복귀). 동기화 끝나면 임시 구독 제거.
- 그 후 원래 방향(카카오→AWS) subscription 재활성화:
  ```sql
  ALTER SUBSCRIPTION peakly_sub ENABLE;
  ```

> 역동기화는 split-brain 위험이 가장 큰 구간 → **쓰기 동결(짧은 점검창)** 후 진행 권장.

---

## 체크리스트
- [ ] WireGuard handshake + ping OK
- [ ] 카카오 publication + repl 롤 + NodePort 노출
- [ ] 레플리카 스키마/pgvector/RPC/롤 생성
- [ ] subscription LIVE, 행 수 일치, lag 낮음
- [ ] PostgREST(JWT 동일) 응답 200
- [ ] data.peakly.art failover 레코드(Terraform 5d)
- [ ] 승격/역동기화 1회 리허설(Game Day)
