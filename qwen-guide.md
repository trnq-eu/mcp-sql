Certainly! Below is a **step-by-step guide** to help you build an **MCP (Model Context Protocol) server and client** using the **TypeScript SDK**, where the **client uses Google Gemini** to analyze your **SQL databases**.

This setup will:
- Expose your SQL database schema and sample data via an **MCP server**
- Use a **TypeScript MCP client** to connect to the server
- Leverage **Google Gemini (via Vertex AI or Gemini API)** to analyze and answer questions about the database

---

## ✅ Prerequisites

Before starting, ensure you have:

- **Node.js v18 or higher**
- **npm** or **yarn**
- A **Google Cloud account** with **Vertex AI API enabled** (or use Gemini API directly)
- A **SQL database** (e.g., SQLite, PostgreSQL, MySQL)
- `@modelcontextprotocol/sdk` installed
- Basic knowledge of TypeScript

---

# 🛠️ Step 1: Initialize Your Project

```bash
mkdir mcp-sql-gemini
cd mcp-sql-gemini
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript ts-node @types/node
npx tsc --init
```

Update `tsconfig.json` for ES modules and outDir:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

---

# 🌐 Step 2: Build the MCP Server (Expose SQL Database)

We'll create an MCP server that exposes:
- **Resource**: Database schema
- **Tool**: Run a SQL query (with safeguards)
- **Prompt**: Help Gemini ask good SQL questions

### 📁 Create `src/server/index.ts`

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createConnection } from "mysql2"; // or sqlite3, pg, etc.

// Connect to your SQL database
const db = createConnection({
  host: "localhost",
  user: "your_user",
  password: "your_password",
  database: "your_db",
});

// Create MCP server
const server = new McpServer({
  name: "sql-database-analyzer",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
    prompts: {},
  },
});

// 🔹 Resource: Expose database schema
server.registerResource("schema", async () => {
  const [rows] = await db.promise().query("SHOW TABLES");
  const tables = rows.map((r: any) => Object.values(r)[0]).join(", ");
  return {
    content: `Database has tables: ${tables}. Use 'DESCRIBE <table>' to see structure.`,
    mimeType: "text/plain",
  };
});

// 🔹 Tool: Safely query the database
server.registerTool(
  "query-sql",
  {
    title: "Query SQL Database",
    description: "Run a read-only SQL query",
    inputSchema: z.object({
      query: z.string().describe("SQL SELECT query only"),
    }),
  },
  async ({ query }) => {
    // Safety: only allow SELECT
    if (!/^SELECT/i.test(query.trim())) {
      return {
        error: {
          code: "INVALID_QUERY",
          message: "Only SELECT queries are allowed.",
        },
      };
    }

    try {
      const [results] = await db.promise().query(query);
      return {
        content: JSON.stringify(results, null, 2),
        mimeType: "application/json",
      };
    } catch (err: any) {
      return {
        error: {
          code: "QUERY_FAILED",
          message: err.message,
        },
      };
    }
  }
);

// 🔹 Prompt: Help Gemini reason about SQL
server.registerPrompt(
  "analyze-database",
  {
    description: "Help Gemini analyze the database structure and write queries",
  },
  async () => ({
    messages: [
      {
        role: "system",
        content:
          "You are a SQL expert. Use the 'query-sql' tool to explore the database. Always describe tables before querying. Never modify data.",
      },
    ],
  })
);

// 🔌 Start server via stdio
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("SQL MCP Server running on stdio...");
}

main().catch(console.error);
```

> 💡 Replace database connection logic with your DB (e.g., `sqlite3`, `pg`).

---

# 🚀 Step 3: Build the MCP Client (Gemini-Powered Analyzer)

This client will:
- Connect to your MCP server
- Use **Gemini API** to generate SQL questions and analyze results

### 🔑 Get Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Get your **API key**
3. Install Gemini SDK:

```bash
npm install @google/generative-ai
```

### 📁 Create `src/client/index.ts`

```ts
import { McpClient } from "@modelcontextprotocol/sdk/client/mcp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function main() {
  // 🔌 Connect to MCP server (e.g., your SQL server)
  const transport = new StdioClientTransport({
    command: "node",
    args: ["build/server/index.js"], // compiled server
  });

  const client = new McpClient({
    name: "gemini-sql-analyzer",
    version: "1.0.0",
  });

  await client.connect(transport);
  console.log("Connected to MCP server");

  // 🧠 Initialize Gemini
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  // 📚 Fetch schema first
  const schemaResource = await client.sendRequest("resource/read", {
    resourceId: "schema",
  });

  console.log("Schema:", schemaResource.content);

  // 💬 Ask Gemini to analyze
  const prompt = `
    The database schema is: ${schemaResource.content}.
    Suggest 3 insightful questions to analyze user behavior.
  `;

  const result = await model.generateContent(prompt);
  const questions = result.response.text();
  console.log("Gemini suggests:", questions);

  // 🔍 Let Gemini ask a question and use MCP tool
  const toolUsePrompt = `
    Based on the schema, write a SQL query to answer: "What are the top 5 most purchased products?"
    Use the 'query-sql' tool.
  `;

  // Simulate tool calling (in real agent loop, this would be dynamic)
  const toolQuery = "SELECT product_name, COUNT(*) as purchases FROM orders GROUP BY product_name ORDER BY purchases DESC LIMIT 5";

  const toolResult = await client.sendRequest("tool/call", {
    toolId: "query-sql",
    arguments: { query: toolQuery },
  });

  if (toolResult.content) {
    const analysisPrompt = `
      Here are the query results:
      ${toolResult.content}
      Summarize the findings in simple terms.
    `;
    const finalResult = await model.generateContent(analysisPrompt);
    console.log("Gemini Analysis:", finalResult.response.text());
  }

  await client.close();
}

main().catch(console.error);
```

---

# ⚙️ Step 4: Build & Run

Update `package.json` scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "server": "node build/server/index.js",
    "client": "node build/client/index.js"
  }
}
```

### Run the Server (in one terminal)

```bash
npm run build
npm run server
```

> This starts the MCP server over `stdio`.

### Run the Client (in another terminal)

```bash
GEMINI_API_KEY=your_api_key_here npm run client
```

> The client will:
> 1. Connect to the SQL MCP server
> 2. Fetch schema
> 3. Use Gemini to suggest and run queries
> 4. Analyze results and return insights

---

# 🧩 Optional: Use with a Real Agent Framework

For a more advanced setup, integrate with an agent framework like:
- [SpinAI](https://spinai.dev) (TypeScript-native)
- [LangChain](https://js.langchain.com) + MCP
- [Genkit](https://github.com/firebase/genkit) with `genkitx-mcp`

These can automate tool calling, reasoning, and loops.

---

# 🔐 Security Considerations

- ✅ Only allow `SELECT` queries
- ✅ Sanitize inputs
- ✅ Use connection pooling and timeouts
- ✅ Run server in isolated environment
- ✅ Never expose write operations unless absolutely necessary

---

# 📚 Summary

| Component        | Description |
|------------------|-----------|
| **MCP Server**   | Exposes SQL schema, safe query tool, and prompts |
| **MCP Client**   | Connects via stdio, fetches data, calls tools |
| **Gemini**       | Acts as the reasoning engine to generate and interpret SQL |
| **TypeScript SDK** | Handles MCP protocol, transport, and message routing |

---

# 🚀 Next Steps

- Add support for **sampling** or **prompts with examples**
- Use **SSE transport** for streaming logs/notifications
- Deploy server remotely and connect via **Claude**, **TypingMind**, or **Memex**
- Add **authentication** (OAuth 2.0) for production
- Visualize results using a dashboard

---

# 📎 References

- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Gemini API: https://aistudio.google.com
- MCP Specification: https://modelcontextprotocol.io/specification/latest
- Example Servers: https://github.com/modelcontextprotocol/servers

---

Let me know if you'd like a **GitHub repo template**, **Docker setup**, or **SQLite example**!