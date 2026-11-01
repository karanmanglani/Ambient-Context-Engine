import { defineContentScript } from "#imports";
export default defineContentScript({
  // Only inject into the specific LLM websites
  matches: ["*://chatgpt.com/*", "*://claude.ai/*", "*://gemini.google.com/*"],

  main() {
    console.log("Ambient Context Engine: DOM Interceptor Injected.");

    // Listen for the hotkey anywhere on the page
    document.addEventListener("keydown", async (event) => {
      // Trigger on Alt + Enter (or Option + Enter on Mac)
      if (event.altKey && event.key === "Enter") {
        event.preventDefault(); // Stop native submission

        const activeElement = document.activeElement as HTMLElement;

        // Ensure we are inside a text input area
        if (
          activeElement &&
          (activeElement.tagName === "TEXTAREA" ||
            activeElement.tagName === "INPUT" ||
            activeElement.isContentEditable)
        ) {
          await handlePromptRefinement(activeElement);
        }
      }
    });
  },
});

async function handlePromptRefinement(element: HTMLElement) {
  // 1. Extract raw text based on element type
  let rawText = "";
  const isContentEditable = element.isContentEditable;

  if (isContentEditable) {
    rawText = element.innerText || element.textContent || "";
  } else {
    rawText = (element as HTMLInputElement | HTMLTextAreaElement).value;
  }

  if (!rawText.trim()) return;

  console.log("Raw intent captured:", rawText);

  // 2. SHOW LOADING STATE (Temporary visual feedback)
  const originalText = rawText;
  updateElementText(element, isContentEditable, "Optimizing prompt...");

  // 3. MOCK BACKEND CALL (We will connect the FastAPI backend here in Phase 3)
  // Simulating a 1-second network delay for the Groq/RAG pipeline
  const optimizedPrompt = await mockFastAPIResponse(originalText);

  // 4. INJECT OPTIMIZED PROMPT
  updateElementText(element, isContentEditable, optimizedPrompt);
}

// Helper function to handle React's synthetic events and DOM differences
function updateElementText(
  element: HTMLElement,
  isContentEditable: boolean,
  newText: string,
) {
  if (isContentEditable) {
    element.innerText = newText;
  } else {
    (element as HTMLInputElement | HTMLTextAreaElement).value = newText;
  }

  // Force React/Angular/Vue to recognize the DOM change
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function mockFastAPIResponse(rawIntent: string): Promise<string> {
  try {
    // Send the raw intent to the background worker
    const response = await browser.runtime.sendMessage({
      type: "REFINE_PROMPT",
      prompt: rawIntent,
    });

    if (response.success) {
      return response.optimized_prompt;
    } else {
      console.error("Refinement failed:", response.error);
      return `[Error connecting to Orchestrator]\n\n${rawIntent}`;
    }
  } catch (error) {
    console.error("Messaging failed:", error);
    return `[Error: Extension Messaging Failed]\n\n${rawIntent}`;
  }
}
