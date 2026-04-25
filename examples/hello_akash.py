"""
Quickstart: deploy a Jupyter notebook server to Akash Network.

    export AKASH_API_KEY=your_key
    python examples/hello_akash.py
"""
import os
from akash_notebooks import AkashApp, Image, Resources

app = AkashApp(
    name="hello-akash",
    deposit_usd=5.0,
)

app.service(
    image=Image.jupyter_scipy(),
    resources=Resources(cpu=2000, memory="4Gi", storage="20Gi"),
    ports=[{"port": 8888}],
    name="jupyter",
)

if __name__ == "__main__":
    with app.run() as deployment:
        url = deployment.wait_ready("jupyter", 8888)
        print(f"\nJupyter Lab running at: {url}?token=akash\n")
        input("Press Enter to shut down...")
