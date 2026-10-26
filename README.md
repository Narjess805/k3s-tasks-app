# 🚀 TP6 — Infrastructure as Code avec Terraform

**Étudiante :** Narjess Dabbech — Master DevOps & Cloud (M2) — 2026

---

## 📑 Sommaire
1. [Objectifs](#1--objectifs)
2. [Installation de Terraform](#2--installation-de-terraform)
3. [Docker local](#3--docker-local)
4. [Docker distant](#4--docker-distant)
5. [Intégration CV One Page](#5--intégration-cv-one-page)
6. [Structure du dépôt](#6--structure-du-dépôt)

---

## 1. 🎯 Objectifs
- Installer Terraform et utiliser son cycle `init → plan → apply → destroy`.
- Piloter Docker (local puis distant via SSH) avec le provider `kreuzwerker/docker`.
- Déployer un conteneur CV One Page avec Terraform sur deux machines.

## 2. 💻 Installation de Terraform

```bash
sudo apt update
sudo apt install -y gnupg software-properties-common wget
wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update
sudo apt install -y terraform
terraform version
```

## 3. 🌐 Docker local

Le fichier `docker-nginx/main.tf` déploie un conteneur Nginx sur le port **8001** de `devsecops-vm`.

**Commandes :**
```bash
cd ~/terraform/docker-nginx
terraform init
terraform plan
terraform apply -auto-approve
curl http://localhost:8001
```

### Terraform Plan
![Terraform plan](captures/terraform-plan.png)

### Terraform Apply
![Terraform apply](captures/terraform-apply.png)

## 4. 🔗 Docker distant

Terraform pilote le démon Docker de `master-2` à travers une connexion SSH. Extrait de `cv-vm2/main.tf` :

```hcl
provider "docker" {
  host = "ssh://master-2@192.168.56.20:22"
}
```

La connexion repose sur l'authentification par clé SSH mise en place au TP4.

### Terraform sur l'hôte distant
![Terraform remote](captures/terraform-remote.png)

## 5. 🌐 Intégration CV One Page

Le CV est déployé sur deux machines :

| Machine | IP | Port |
| :--- | :--- | :--- |
| `devsecops-vm` | `192.168.56.10` | `8001` |
| `master-2` | `192.168.56.20` | `8002` |

**Dockerfile du CV :**
```dockerfile
FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
```

### CV sur devsecops-vm
![CV sur devsecops-vm](captures/integration1-cv.png)

### CV sur master-2
![CV sur master-2](captures/integration2-cv.png)

## 6. 📁 Structure du dépôt

```text
terraform/
├── docker-nginx/
│   └── main.tf
├── cv-vm2/
│   └── main.tf
├── captures/
│   ├── terraform-plan.png
│   ├── terraform-apply.png
│   ├── terraform-remote.png
│   ├── integration1-cv.png
│   └── integration2-cv.png
├── .gitignore
└── README.md
```

---

## 👤 Auteur
**Narjess Dabbech** — Master DevOps & Cloud — 2026
GitHub : [@Narjess805](https://github.com/Narjess805)
