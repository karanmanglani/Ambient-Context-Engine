import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Ambient Context Engine",
    description: "In-Situ Prompt Optimization & Cross-LLM Memory",
    version: "1.0.0",
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: [
      "*://chatgpt.com/*",
      "*://claude.ai/*",
      "*://gemini.google.com/*",
    ],
  },
});
