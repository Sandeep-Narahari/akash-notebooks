import os
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/api/ai", tags=["ai"])

class Message(BaseModel):
    role: str
    content: str

class CompletionRequest(BaseModel):
    messages: List[Message]
    max_tokens: int = 150
    temperature: float = 0.2

# @router.post("/completions")
# async def chat_completions(req: CompletionRequest):
#     api_key = os.getenv("AKASH_ML_API_KEY")
#     if not api_key:
#         raise HTTPException(status_code=500, detail="AKASH_ML_API_KEY is not set on the server")
    
#     url = "https://api.akashml.com/v1/chat/completions"
#     headers = {
#         "Content-Type": "application/json",
#         "Authorization": f"Bearer {api_key}"
#     }
    
#     payload = {
#         "model": "deepseek-ai/DeepSeek-V4-Flash",
#         "messages": [m.dict() for m in req.messages],
#         "max_tokens": req.max_tokens,
#         "temperature": req.temperature
#     }
    
#     async with httpx.AsyncClient() as client:
#         try:
#             resp = await client.post(url, headers=headers, json=payload, timeout=10.0)
#             resp.raise_for_status()
#             return resp.json()
#         except httpx.HTTPStatusError as e:
#             raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
#         except Exception as e:
#             raise HTTPException(status_code=500, detail=str(e))
