"""
Deploy Ollama LLM server to Akash GPU compute.

    export AKASH_API_KEY=your_key
    python examples/ollama_llm.py
"""
import requests
from akash_notebooks import AkashApp, Image, Resources

app = AkashApp(name="ollama-akash", deposit_usd=10.0)

app.service(
    image=Image.ollama(),
    resources=Resources(cpu=4000, memory="16Gi", storage="50Gi", gpu=1),
    ports=[{"port": 11434}],
    name="ollama",
)

if __name__ == "__main__":
    with app.run() as deployment:
        url = deployment.wait_ready("ollama", 11434)
        print(f"Ollama running at: {url}")

        # Pull and run a model
        print("Pulling llama3...")
        requests.post(f"{url}/api/pull", json={"name": "llama3"}, stream=True)

        resp = requests.post(f"{url}/api/generate", json={
            "model": "llama3",
            "prompt": "Explain Akash Network in one sentence.",
            "stream": False,
        })
        print("Response:", resp.json()["response"])
        input("Press Enter to shut down...")
