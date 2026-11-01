import { defineBackground } from "#imports";

export default defineBackground(() => {
  // Listen for messages from the content script
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "REFINE_PROMPT") {
      // Execute the fetch request to your local FastAPI backend
      fetch("http://localhost:8000/refine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: message.prompt }),
      })
        .then((response) => response.json())
        .then((data) => {
          sendResponse({
            success: true,
            optimized_prompt: data.optimized_prompt,
          });
        })
        .catch((error) => {
          console.error("Backend connection failed:", error);
          sendResponse({ success: false, error: String(error) });
        });

      // Return true to indicate we will send the response asynchronously
      return true;
    }
  });
});
