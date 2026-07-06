import { WebWorkerEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerEngineHandler();
self.onmessage = (msg) => {
  handler.onmessage(msg);
};