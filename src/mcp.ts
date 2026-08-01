#!/usr/bin/env node
import { resolveConfig } from "./config.js";
import { runMcpServer } from "./mcp/server.js";

const config = await resolveConfig();
await runMcpServer(config);
