# Tasks App : application trois niveaux sur k3s (Mini-projet 2)

Application de gestion de tâches (CRUD) déployée sur un cluster **k3s** (3 VMs) avec configuration externalisée, secrets protégés, données persistantes, sauvegardes automatiques, quotas, RBAC, durcissement des Pods et NetworkPolicies.

- **Auteur** : Narjess (GitHub : `Narjess805`)
- **Cours** : Orchestration de conteneurs avec Kubernetes (k3s), Mini-projet 2
- **Namespace Kubernetes** : `tasks`

---

## 1. Architecture

```
                      Utilisateur
                          |
                  Ingress (Traefik)
                    app.k3s.local
                          |
                  Service frontend-svc
                          |
              Deployment frontend (nginx-unprivileged :8080)
                  /api/ -> api-svc:3000
                          |
                   Service api-svc
                          |
                Deployment api (2 réplicas, Node.js :3000)
                          |
                    Service db (headless)
                          |
             StatefulSet db (PostgreSQL 16) <--- PVC data (1 Gi)
                          ^
                          |
        CronJob db-backup ---> PVC backup-pvc

   Namespace tasks : ResourceQuota + LimitRange + RBAC + NetworkPolicies
```

Choix d'architecture :

- Seul le **frontend** est exposé par l'Ingress. Le frontend relaie `/api/` vers l'API **à l'intérieur** du cluster.
- La base n'est joignable que par l'**API** et le **job de sauvegarde**.

| Composant | Technologie | Port | Image |
|---|---|---|---|
| Frontend | HTML/JS + nginx (`nginxinc/nginx-unprivileged`) | 8080 | `narjessdabbech/tasks-front:1.0.0` |
| API REST | Node.js / Express | 3000 | `narjessdabbech/tasks-api:1.0.0` |
| Base de données | PostgreSQL 16 (alpine) | 5432 | `postgres:16-alpine` |

L'API expose :

- `GET /health` : le processus répond (toujours 200) ;
- `GET /ready` : 200 uniquement si la connexion à la base fonctionne.

---

## 2. Structure du dépôt

```
.
├── app/ (ou api/, frontend/, db/)   # code et Dockerfile des composants
│   ├── api/
│   ├── frontend/
│   └── db/
├── docker-compose.yml               # test local (phase 0)
├── .env                             # local uniquement (ignoré par Git)
├── .gitignore
├── k8s/
│   ├── 00-namespace/                # namespace, ResourceQuota, LimitRange
│   ├── 10-config/                   # ConfigMap, secret.example.yaml
│   ├── 20-db/                       # Service headless, StatefulSet, backup (PVC + CronJob)
│   ├── 30-app/                      # Deployments api/frontend, Services, ConfigMap nginx, Ingress
│   └── 40-security/                 # ServiceAccounts, RBAC, NetworkPolicies
└── README.md
```

> Le vrai `k8s/10-config/secret.yaml` n'est **jamais** versionné (voir `.gitignore`). Seul `secret.example.yaml` (fausses valeurs) est dans Git.

---

## 3. Prérequis

- Un cluster **k3s** fonctionnel (1 control-plane + 2 workers) et `kubectl` configuré sur le poste (`kubectl get nodes` → 3 nœuds `Ready`).
- Traefik actif (installé par défaut avec k3s) et StorageClass `local-path`.
- Docker Desktop (ou Podman) pour construire les images en local.
- Un compte Docker Hub avec des dépôts **publics** (les nœuds k3s n'ont pas d'identifiants).
- Accès Internet depuis les VMs (pull des images).
- Ressources conseillées pour le control-plane : **4 Go de RAM** (2 Go provoquent des OOM et des timeouts de l'API server).

---

## 4. Test en local (phase 0)

```powershell
cd <dossier du projet>
docker compose up --build -d
docker compose ps
curl.exe -s http://localhost:8080/api/health
curl.exe -s http://localhost:8080/api/ready
```

Ouvrir `http://localhost:8080` et tester le CRUD (créer, lire, modifier, supprimer). Arrêt :

```powershell
docker compose down
```

Variables d'environnement lues par l'API : `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `API_PORT`. Aucune valeur n'est codée en dur.

---

## 5. Construction et publication des images (phase 1)

```powershell
docker build -t narjessdabbech/tasks-api:1.0.0 ./api
docker build -t narjessdabbech/tasks-front:1.0.0 ./frontend
docker login
docker push narjessdabbech/tasks-api:1.0.0
docker push narjessdabbech/tasks-front:1.0.0
```

Les tags sont versionnés (jamais `latest`). Vérification :

```powershell
kubectl run test --image=narjessdabbech/tasks-api:1.0.0 --restart=Never
kubectl get pod test
kubectl delete pod test
```

(Le Pod `test` finit en `Error` car il n'a pas de base : c'est normal, seul `ImagePullBackOff` serait un problème.)

---

## 6. Ordre de déploiement

Toutes les commandes se lancent depuis la racine du dépôt.

### 6.1 Namespace, quota, LimitRange (E2)

```powershell
kubectl apply -f k8s/00-namespace/namespace.yaml
kubectl apply -f k8s/00-namespace/
kubectl describe quota -n tasks
kubectl describe limitrange -n tasks
```

> Si `limitrange` échoue avec « namespace not found » au premier `apply`, relancer la commande : le namespace n'existait pas encore.

### 6.2 Configuration et secrets (E3, E4)

ConfigMap (paramètres non sensibles) :

```powershell
kubectl apply -f k8s/10-config/configmap.yaml
```

Secret (identifiants de la base). **Ne jamais committer ce fichier.** Le générer à partir du modèle `secret.example.yaml` :

```powershell
kubectl create secret generic db-credentials -n tasks `
  --from-literal=POSTGRES_USER=<utilisateur> `
  --from-literal=POSTGRES_PASSWORD=<mot_de_passe> `
  --dry-run=client -o yaml | Out-File -Encoding ascii k8s\10-config\secret.yaml
kubectl apply -f k8s/10-config/secret.yaml
kubectl get configmap,secret -n tasks
```

Contenu de l'espace de configuration :

| Objet | Clés |
|---|---|
| ConfigMap `app-config` | `DB_HOST=db`, `DB_PORT=5432`, `DB_NAME=appdb`, `API_PORT=3000` |
| Secret `db-credentials` | `POSTGRES_USER`, `POSTGRES_PASSWORD` |

L'API reçoit `DB_USER` et `DB_PASSWORD` via `secretKeyRef` (mapping dans le Deployment), ce qui évite de modifier le code.

### 6.3 Base de données (E5, E6)

```powershell
kubectl apply -f k8s/20-db/
kubectl get pods,pvc -n tasks
kubectl rollout status statefulset/db -n tasks
```

Ordre à respecter : Service headless `db` → StatefulSet `db` (avec `volumeClaimTemplates`, `PGDATA=/var/lib/postgresql/data/pgdata`, readiness `pg_isready`).

Connexion de contrôle :

```powershell
kubectl exec -it db-0 -n tasks -- psql -U <utilisateur> -d appdb -c "\dt"
```

### 6.4 ServiceAccounts (E12)

À appliquer **avant** les Deployments, qui les référencent :

```powershell
kubectl apply -f k8s/40-security/serviceaccounts.yaml
```

### 6.5 API et frontend (E7, E8, E9)

```powershell
kubectl apply -f k8s/30-app/
kubectl get pods -n tasks
kubectl logs deploy/api -n tasks
```

- L'API (2 réplicas) attend la base via un init container.
- Readiness probe `/ready`, liveness probe `/health`.
- Chaque conteneur définit `requests` et `limits`.
- La configuration nginx du frontend est dans un ConfigMap monté avec `subPath` sur `/etc/nginx/conf.d/default.conf`. Après modification : `kubectl rollout restart deploy/frontend -n tasks`.

### 6.6 Ingress (E10)

L'Ingress `app.k3s.local` pointe vers `frontend-svc`. Sur le poste Windows, ajouter dans `C:\Windows\System32\drivers\etc\hosts` (en administrateur) :

```
192.168.56.20   app.k3s.local
```

Puis ouvrir `http://app.k3s.local`.

### 6.7 Sauvegarde (E11)

```powershell
kubectl apply -f k8s/20-db/backup-pvc.yaml
kubectl apply -f k8s/20-db/backup-cronjob.yaml
kubectl create job --from=cronjob/db-backup test-backup -n tasks
kubectl logs job/test-backup -n tasks
```

Le CronJob `db-backup` s'exécute toutes les 5 minutes (démonstration ; en production : `0 2 * * *`). Il écrit des fichiers `dump-AAAAMMJJ-HHMM.sql` dans `backup-pvc`. Le dump utilise `--clean --if-exists` pour permettre une restauration sur une base déjà peuplée.

### 6.8 RBAC et durcissement (E12, E13)

```powershell
kubectl apply -f k8s/40-security/rbac.yaml
kubectl auth can-i list pods   -n tasks --as=system:serviceaccount:tasks:dev-viewer   # yes
kubectl auth can-i delete pods -n tasks --as=system:serviceaccount:tasks:dev-viewer   # no
kubectl auth can-i get secrets -n tasks --as=system:serviceaccount:tasks:dev-viewer   # no

kubectl label ns tasks pod-security.kubernetes.io/enforce=baseline --overwrite
```

### 6.9 NetworkPolicies (E14)

Appliquer d'abord le « deny all », puis les autorisations :

```powershell
kubectl apply -f k8s/40-security/netpol-default-deny.yaml
kubectl apply -f k8s/40-security/
```

Matrice de flux :

| Source | Destination | Autorisé |
|---|---|---|
| Traefik (namespace `kube-system`) | frontend | Oui |
| frontend | api | Oui |
| api | db (5432) | Oui |
| job de sauvegarde | db (5432) | Oui |
| frontend | db | Non |
| tout autre Pod | api, db | Non |

Tests de blocage :

```powershell
# Pod de test sans label tier: api -> doit échouer (timeout)
kubectl run nettest -n tasks --rm -it --restart=Never --image=busybox:1.36 -- nc -zv -w 3 db 5432

# Depuis un Pod de l'API -> doit réussir
kubectl exec -n tasks deploy/api -- nc -zv -w 3 db 5432
```

---

## 7. Vérification de la persistance (E6)

```powershell
# 1. Saisir des données dans l'application
# 2. Supprimer le Pod de la base
kubectl delete pod db-0 -n tasks
kubectl get pods -n tasks -w
# 3. Rouvrir l'application : les données sont toujours présentes
```

Les données se trouvent sur un volume `local-path` situé **sur le disque du nœud** qui héberge `db-0`. Si ce nœud tombe, la base est indisponible jusqu'à son retour.

Résilience de l'API :

```powershell
kubectl delete pod -l tier=api -n tasks --wait=false
kubectl get pods -n tasks -w
```

---

## 8. Procédure de restauration

1. **Lister les sauvegardes** avec un Pod temporaire qui monte `backup-pvc` :

   ```powershell
   kubectl apply -f k8s/20-db/restore-pod.yaml
   kubectl exec -n tasks restore -- ls -l /backup
   ```

   Exemple de `restore-pod.yaml` (étiquette `tier: backup` pour passer la NetworkPolicy vers la base) :

   ```yaml
   apiVersion: v1
   kind: Pod
   metadata:
     name: restore
     namespace: tasks
     labels: { app: tasks, tier: backup }
   spec:
     restartPolicy: Never
     containers:
       - name: restore
         image: postgres:16-alpine
         command: ["sleep", "3600"]
         env:
           - name: PGPASSWORD
             valueFrom:
               secretKeyRef: { name: db-credentials, key: POSTGRES_PASSWORD }
           - name: POSTGRES_USER
             valueFrom:
               secretKeyRef: { name: db-credentials, key: POSTGRES_USER }
           - name: POSTGRES_DB
             valueFrom:
               configMapKeyRef: { name: app-config, key: DB_NAME }
         volumeMounts:
           - { name: backup, mountPath: /backup }
     volumes:
       - name: backup
         persistentVolumeClaim:
           claimName: backup-pvc
   ```

2. **Simuler une perte** : supprimer une donnée depuis l'application ou avec `psql`.

3. **Restaurer** le dump choisi :

   ```powershell
   kubectl exec -n tasks restore -- sh -c 'psql -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /backup/<fichier>.sql'
   ```

4. **Vérifier** dans l'application que la donnée est revenue, puis nettoyer :

   ```powershell
   kubectl delete pod restore -n tasks
   ```

> Limite : la sauvegarde est stockée sur le même nœud que la base (`local-path`). Elle ne protège pas d'une panne de ce nœud. Amélioration : stockage réseau (NFS, Longhorn) ou copie des dumps vers un stockage externe (S3/MinIO).

---

## 9. Exigences couvertes

| N° | Exigence | Où |
|---|---|---|
| E1 | Images versionnées, accessibles aux nœuds | §5 |
| E2 | Namespace + ResourceQuota + LimitRange | `k8s/00-namespace/` |
| E3 | ConfigMap + Secret | `k8s/10-config/` |
| E4 | Aucun secret dans Git | `.gitignore`, `secret.example.yaml` |
| E5 | StatefulSet + PVC + Service headless | `k8s/20-db/` |
| E6 | Persistance prouvée | §7 |
| E7 | L'API attend la base | init container |
| E8 | requests et limits | `k8s/20-db/`, `k8s/30-app/` |
| E9 | Probes `/ready` et `/health` | `k8s/30-app/` |
| E10 | Ingress sur le frontend seul | `k8s/30-app/` |
| E11 | CronJob de sauvegarde + restauration | §6.7, §8 |
| E12 | ServiceAccounts sans jeton, `dev-viewer` | `k8s/40-security/` |
| E13 | Durcissement des Pods | `k8s/30-app/`, `k8s/20-db/` |
| E14 | NetworkPolicies | `k8s/40-security/` |
| E15 | Dépôt structuré + README | ce fichier |

---

## 10. Durcissement : exceptions justifiées

| Composant | Exception | Justification |
|---|---|---|
| Base PostgreSQL | pas de `readOnlyRootFilesystem` | PostgreSQL écrit dans son répertoire de données et ses fichiers temporaires. |
| Base PostgreSQL | utilisateur imposé par l'image (UID 70, alpine) | L'image gère ses droits sur le volume. Le Pod reste non-root et sans escalade de privilèges. |
| Frontend | `emptyDir` sur `/tmp` et le cache nginx | nginx a besoin d'écrire ses fichiers temporaires avec un système de fichiers en lecture seule. |

À compléter selon les essais avec `pod-security.kubernetes.io/enforce=restricted`.

---

## 11. Dépannage

| Symptôme | Pistes |
|---|---|
| `kubectl` : `TLS handshake timeout` | Le control-plane manque de RAM/CPU (`free -h`, `uptime` sur le master), redémarrer `k3s` ou augmenter la RAM de la VM. |
| `ImagePullBackOff` | Tag erroné, dépôt Docker Hub privé, pas d'Internet sur les VMs. |
| API en `CrashLoopBackOff` | `kubectl logs` : variable manquante, base injoignable (`ECONNREFUSED`). |
| API jamais `Ready` | Vérifier `/ready`, le nom du Service `db` et le port 5432. |
| PVC en `Pending` | StorageClass `local-path` absente ou quota de PVC atteint. |
| Base en `CrashLoopBackOff` | `PGDATA` doit être un sous-dossier du point de montage. |
| Frontend en 502 | `proxy_pass` vers un mauvais nom/port de Service (`api-svc:3000`). |
| Tout est bloqué après les NetworkPolicies | Flux oublié (Traefik, job de sauvegarde, DNS si egress filtré). |
| Pod refusé à la création | Quota dépassé ou règle Pod Security non respectée (`kubectl describe rs`). |

---

## 12. Nettoyage

```powershell
kubectl delete namespace tasks
```

Supprime tous les objets du projet, y compris les PVC et les sauvegardes.
