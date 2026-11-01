import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chromadb
from chromadb.utils import embedding_functions
import json
import uuid

# For Groq inference (ultra-fast)
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate

load_dotenv()

app = FastAPI(title="Ambient Context Engine - Orchestrator")

# Enable CORS so the browser extension can call this endpoint
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows requests from chrome-extension:// origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- Vector Memory Setup (ChromaDB) -----------------
# Local persistent database stored on disk inside ./chroma_db
chroma_client = chromadb.PersistentClient(path="./chroma_db")

# Uses default all-MiniLM-L6-v2 embeddings locally (no API key needed for embedding!)
emb_fn = embedding_functions.DefaultEmbeddingFunction()

memory_collection = chroma_client.get_or_create_collection(
    name="cross_llm_memory",
    embedding_function=emb_fn
)

# Seed with some dummy context if empty (e.g. past decisions from Claude/ChatGPT)
if memory_collection.count() == 0:
    memory_collection.add(
        documents=[
            "Project tech stack: Frontend uses React with TypeScript and Vite. Backend is FastAPI.",
            "Database choice: We use ChromaDB for local vector memory and PostgreSQL for relational user profiles.",
            "Coding preference: Prefer clean, modular functional code with explicit type annotations. Avoid unnecessary classes.",
            "Testing library: We chose Playwright for end-to-end browser testing rather than Cypress."
        ],
        metadatas=[
            {"source": "claude.ai", "category": "tech_stack"},
            {"source": "chatgpt.com", "category": "architecture"},
            {"source": "chatgpt.com", "category": "coding_style"},
            {"source": "claude.ai", "category": "decision"}
        ],
        ids=["mem_1", "mem_2", "mem_3", "mem_4"]
    )
    print("Seeded default memory into ChromaDB.")

# ----------------- LLM Setup -----------------
# Groq handles sub-second prompt refinement
llm = ChatGroq(
    model="qwen/qwen3.8-27b",
    temperature=0.3,
    api_key=os.getenv("GROQ_API_KEY")
)

REWRITE_PROMPT_TEMPLATE = """You are an ambient prompt compilation engine.
Your job is to take a user's raw, informal prompt and augment it with relevant technical context retrieved from their cross-platform memory.

Context from previous conversations:
{context}

User's Raw Prompt:
"{raw_prompt}"

Instructions:
1. Seamlessly integrate the relevant context (tech stack, preferences, constraints) into the prompt.
2. Transform the raw prompt into a clear, high-signal, professional prompt ready for an advanced LLM.
3. DO NOT answer the prompt. ONLY output the rewritten, optimized prompt text.
4. Do NOT include markdown meta-commentary like "Here is your refined prompt:". Output ONLY the final text.
"""

prompt_template = ChatPromptTemplate.from_template(REWRITE_PROMPT_TEMPLATE)
chain = prompt_template | llm

# ----------------- API Endpoints -----------------
class RefineRequest(BaseModel):
    prompt: str

class RefineResponse(BaseModel):
    optimized_prompt: str
    retrieved_context: list[str]

@app.post("/refine", response_model=RefineResponse)
async def refine_prompt(req: RefineRequest):
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    try:
        # 1. Semantic Search: Query ChromaDB for top-2 most relevant memories
        results = memory_collection.query(
            query_texts=[req.prompt],
            n_results=2
        )
        
        retrieved_docs = results["documents"][0] if results["documents"] else []
        context_str = "\n".join([f"- {doc}" for doc in retrieved_docs]) if retrieved_docs else "No specific past context found."

        # 2. Fast Compilation with Groq
        response = chain.invoke({
            "context": context_str,
            "raw_prompt": req.prompt
        })

        return RefineResponse(
            optimized_prompt=response.content.strip(),
            retrieved_context=retrieved_docs
        )

    except Exception as e:
        print(f"Error during refinement: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    return {"status": "ok", "total_memories": memory_collection.count()}

# Extraction template that discards conversational churn and keeps only technical facts
INGEST_PROMPT_TEMPLATE = """You are a technical context extraction engine.
Analyze the following conversation turn between a developer and an LLM.

User Prompt:
"{user_prompt}"

LLM Response:
"{llm_response}"

Instructions:
1. Extract ONLY key architectural decisions, libraries chosen, tech stack details, constraints, or coding patterns.
2. Discard all conversational filler, greetings, and generic explanations.
3. If no actionable architectural facts or technical choices are present, return an empty list: [].
4. Return ONLY valid JSON in this exact structure:
{{"facts": ["fact 1", "fact 2"]}}
"""

ingest_prompt_template = ChatPromptTemplate.from_template(INGEST_PROMPT_TEMPLATE)
ingest_chain = ingest_prompt_template | llm

class IngestRequest(BaseModel):
    user_prompt: str
    llm_response: str
    source_url: str

class IngestResponse(BaseModel):
    facts_stored: list[str]
    status: str

@app.post("/ingest", response_model=IngestResponse)
async def ingest_conversation(req: IngestRequest):
    if not req.llm_response.strip():
        return IngestResponse(facts_stored=[], status="ignored_empty")

    try:
        # Run asynchronous extraction
        extraction_result = ingest_chain.invoke({
            "user_prompt": req.user_prompt,
            "llm_response": req.llm_response[:3000]  # truncate to prevent context blowout
        })
        
        # Clean response and parse JSON
        content = extraction_result.content.strip()
        # Strip potential markdown formatting
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        
        parsed = json.loads(content.strip())
        facts = parsed.get("facts", [])

        if not facts:
            return IngestResponse(facts_stored=[], status="no_high_value_facts")

        # Save extracted facts into ChromaDB
        doc_ids = [f"mem_{uuid.uuid4().hex[:8]}" for _ in facts]
        metadatas = [{"source": req.source_url, "category": "extracted_memory"} for _ in facts]

        memory_collection.add(
            documents=facts,
            metadatas=metadatas,
            ids=doc_ids
        )

        return IngestResponse(facts_stored=facts, status="success")

    except Exception as e:
        print(f"Error during ingestion: {e}")
        return IngestResponse(facts_stored=[], status=f"error: {str(e)}")