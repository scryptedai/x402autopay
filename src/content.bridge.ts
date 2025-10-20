const pendingRequests = new Map<
  string,
  {
    abort(): void;
  }
>();

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as
    | {
        source: "x402-runtime-request";
        requestId: string;
        payload: unknown;
      }
    | undefined;
  if (!data || data.source !== "x402-runtime-request" || typeof data.requestId !== "string") {
    return;
  }

  const controller = new AbortController();
  pendingRequests.set(data.requestId, {
    abort: () => controller.abort(),
  });

  (async () => {
    try {
      if (!chrome.runtime?.sendMessage) {
        throw new Error("chrome.runtime.sendMessage unavailable");
      }
      const result = await chrome.runtime.sendMessage(data.payload);
      if (controller.signal.aborted) return;
      window.postMessage(
        {
          source: "x402-runtime-response",
          requestId: data.requestId,
          result,
        },
        "*",
      );
      // delivered
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("x402-autopay: bridge sendMessage failed", error);
      window.postMessage(
        {
          source: "x402-runtime-response",
          requestId: data.requestId,
          error: error instanceof Error ? error.message : String(error),
        },
        "*",
      );
    } finally {
      pendingRequests.delete(data.requestId);
    }
  })();
});

chrome.runtime?.onDisconnect?.addListener(() => {
  for (const [, entry] of pendingRequests) {
    entry.abort();
  }
  pendingRequests.clear();
});

chrome.runtime?.onMessage?.addListener((message) => {
  if (!message || typeof message !== "object") return;
  const typed = message as { type?: string };
  if (typeof typed.type !== "string" || !typed.type.startsWith("x402:")) {
    return;
  }
  window.postMessage(
    {
      source: "x402-runtime-broadcast",
      message,
    },
    "*",
  );
});
