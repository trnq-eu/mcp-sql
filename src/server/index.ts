import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createConnection } from "mysql2/promise"; // or sqlite3, pg, etc.
import type { RowDataPacket } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config(); // .env variables

const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_DATABASE = process.env.DB_DATABASE;

if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_DATABASE) {
  throw new Error("Missing required database environment variables in .env file.");
}

const db = await createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_DATABASE,
});

// create the MCP server
const server = new McpServer({
    name: "sql-database-analyzer",
    version: "1.0.0",
},
{
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
}
);

// ✅ Register schema as a static resource
server.registerResource(
  "database-schema",           // name
  "db://schema",               // URI
  {                            // metadata
    title: "Database Schema",
    description: `Schema for ${DB_DATABASE}`,
    mimeType: "text/plain",
  },
  async () => {                // read callback
    const [rows] = await db.execute<RowDataPacket[]>("SHOW TABLES");
    const tables = rows.map(r => Object.values(r)[0]).join(", ");

    return {
      contents: [
        {
          uri: "db://schema",
          text: `Database has tables: ${tables}. Use 'DESCRIBE <table>' to see structure.`,
        },
      ],
    };
  }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log("MCP Server running via stdio...");
}

main().catch(console.error);