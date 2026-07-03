import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
