import { defineBackground } from "#imports";

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 1. Prompt Refinement
    if (message.type === "REFINE_PROMPT") {
      fetch("http://localhost:8000/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: message.prompt }),
      })
        .then((res) => res.json())
        .then((data) =>
          sendResponse({
            success: true,
            optimized_prompt: data.optimized_prompt,
          }),
        )
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;
    }

    // 2. Memory Ingestion (Asynchronous background task)
    if (message.type === "INGEST_MEMORY") {
      fetch("http://localhost:8000/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_prompt: message.userPrompt,
          llm_response: message.llmResponse,
          source_url: sender.url || "web",
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          console.log("Memory ingested successfully:", data);
          sendResponse({ success: true, data });
        })
        .catch((err) => {
          console.error("Ingestion failed:", err);
          sendResponse({ success: false, error: String(err) });
        });
      return true;
    }
  });
});
