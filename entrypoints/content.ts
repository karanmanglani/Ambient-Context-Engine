import { defineContentScript } from "#imports";

export default defineContentScript({
  matches: [
    "*://chatgpt.com/*",
    "*://*.chatgpt.com/*",
    "*://claude.ai/*",
    "*://*.claude.ai/*",
    "*://gemini.google.com/*",
  ],

  main() {
    console.log("Ambient Context Engine: DOM Interceptor & Observer Active.");

    let lastSubmittedPrompt = "";

    // 1. Hotkey Interception (Alt + Enter)
    document.addEventListener("keydown", async (event) => {
      if (event.altKey && event.key === "Enter") {
        event.preventDefault();

        const activeElement = document.activeElement as HTMLElement;
        if (
          activeElement &&
          (activeElement.tagName === "TEXTAREA" ||
            activeElement.tagName === "INPUT" ||
            activeElement.isContentEditable)
        ) {
          lastSubmittedPrompt = await handlePromptRefinement(activeElement);
        }
      }
    });

    // 2. DOM MutationObserver: Watch for completion of LLM response
    setupResponseObserver(() => lastSubmittedPrompt);
  },
});

async function handlePromptRefinement(element: HTMLElement): Promise<string> {
  const isContentEditable = element.isContentEditable;
  const rawText = isContentEditable
    ? element.innerText || element.textContent || ""
    : (element as HTMLInputElement | HTMLTextAreaElement).value;

  if (!rawText.trim()) return "";

  updateElementText(
    element,
    isContentEditable,
    "Optimizing prompt with memory...",
  );

  try {
    const response = await browser.runtime.sendMessage({
      type: "REFINE_PROMPT",
      prompt: rawText,
    });

    const optimized = response.success ? response.optimized_prompt : rawText;
    updateElementText(element, isContentEditable, optimized);
    return optimized;
  } catch (error) {
    updateElementText(element, isContentEditable, rawText);
    return rawText;
  }
}

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
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setupResponseObserver(getLastPrompt: () => string) {
  let isGenerating = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    // Detect stop buttons or streaming indicators across platforms
    const stopButton = document.querySelector(
      'button[aria-label*="Stop"], button[data-testid*="stop"], [aria-label="Stop generating"]',
    );

    if (stopButton && !isGenerating) {
      isGenerating = true;
      console.log("LLM generation stream started...");
    }

    // When the stop button disappears, streaming is complete
    if (!stopButton && isGenerating) {
      isGenerating = false;
      console.log("LLM generation completed. Queuing extraction...");

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        captureLatestResponse(getLastPrompt());
      }, 1500); // 1.5s debounce to allow DOM nodes to settle
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function captureLatestResponse(promptText: string) {
  console.log("Attempting to capture response text...");

  // Using the new data-assistant-markdown-root selector for ChatGPT
  const assistantNodes = document.querySelectorAll(
    '[data-assistant-markdown-root], [data-message-author-role="assistant"], .font-claude-message, message-content',
  );

  console.log(`Found ${assistantNodes.length} possible response nodes.`);

  if (assistantNodes.length === 0) {
    console.error(
      "Extraction failed: Could not find the AI's response in the DOM.",
    );
    return;
  }

  // Grab the very last response container on the page
  const latestNode = assistantNodes[assistantNodes.length - 1] as HTMLElement;
  const replyText = latestNode.innerText || latestNode.textContent || "";

  if (!replyText.trim()) {
    console.error("Extraction failed: Found the node, but the text was empty.");
    return;
  }

  console.log(
    "Sending response payload to background for ingestion:\n",
    replyText.substring(0, 100) + "...",
  );

  browser.runtime.sendMessage({
    type: "INGEST_MEMORY",
    userPrompt: promptText,
    llmResponse: replyText,
  });
}
