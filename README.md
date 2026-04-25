# Akash Notebooks

Modal Labs-style interactive notebook platform running on Akash Network decentralized compute.

## How it works

1. Open the web app, enter your Akash Console API key
2. Create a notebook, pick compute resources (CPU or GPU)
3. Click **Connect** — deploys a Jupyter kernel to Akash Network
4. Write Python in cells, click ▶ to execute on Akash compute
5. Outputs (text, plots, errors) stream back in real-time
6. Click **Disconnect** to close the deployment and stop billing

## Architecture

```
Browser (Next.js)
  │
  ├── REST API ──────────► FastAPI backend
  │                             │
  └── WebSocket ─────────►  WS proxy
                               │
                          Jupyter kernel on Akash
                          (jupyter/scipy-notebook)
```

## Quick start

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

## Get an Akash API key

1. Go to [console.akash.network](https://console.akash.network)
2. Create a managed wallet
3. Generate an API key from Settings

## Compute presets

| Preset | vCPU | Memory | GPU |
|--------|------|--------|-----|
| CPU Small | 2 | 4 Gi | — |
| CPU Large | 8 | 16 Gi | — |
| GPU T4 | 4 | 16 Gi | 1× NVIDIA T4 |
| GPU A100 | 8 | 32 Gi | 1× NVIDIA A100 |

## Project structure

```
akash-notebooks/
├── backend/                 # FastAPI
│   ├── main.py
│   ├── models.py
│   ├── database.py
│   ├── routers/
│   │   ├── sessions.py      # Akash deployment lifecycle
│   │   ├── notebooks.py     # Notebook CRUD
│   │   └── proxy.py         # WebSocket proxy to Jupyter
│   └── services/
│       └── akash_service.py # Console API + deployment flow
├── frontend/                # Next.js 14
│   ├── app/
│   ├── components/
│   └── lib/
├── akash_notebooks/         # Python SDK (standalone)
└── sdl_templates/           # Pre-built Akash SDL files
```
# akash-notebooks
