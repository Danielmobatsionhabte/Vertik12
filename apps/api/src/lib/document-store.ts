import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Document store abstraction — unstructured payloads (assignment submission
 * bodies, generated documents) live OUTSIDE the relational database:
 *
 *   DOCUMENT_STORE=local     JSON files on disk (zero-config default for dev)
 *   DOCUMENT_STORE=mongodb   MongoDB      (MONGODB_URI, MONGODB_DB)
 *   DOCUMENT_STORE=dynamodb  AWS DynamoDB (DYNAMODB_TABLE, AWS_REGION + IAM creds)
 *
 * SQL rows keep only a `contentRef` key. The mongodb / @aws-sdk packages are
 * loaded lazily so dev installs never pay for drivers they don't use.
 */
export interface DocumentStore {
  readonly name: string;
  put(collection: string, doc: Record<string, unknown>): Promise<string>; // returns key
  get(collection: string, key: string): Promise<Record<string, unknown> | null>;
}

// ---------- local (dev default): JSON files under apps/api/.docstore ----------
class LocalDocumentStore implements DocumentStore {
  readonly name = "local";
  private dir = path.resolve(process.cwd(), ".docstore");

  private file(collection: string, key: string) {
    return path.join(this.dir, collection, `${key}.json`);
  }

  async put(collection: string, doc: Record<string, unknown>): Promise<string> {
    const key = crypto.randomUUID();
    await fs.promises.mkdir(path.join(this.dir, collection), { recursive: true });
    await fs.promises.writeFile(this.file(collection, key), JSON.stringify(doc, null, 2), "utf8");
    return key;
  }

  async get(collection: string, key: string) {
    try {
      // key is always a server-generated UUID, never user input — no traversal risk.
      const raw = await fs.promises.readFile(this.file(collection, key), "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

// ---------- MongoDB ----------
class MongoDocumentStore implements DocumentStore {
  readonly name = "mongodb";
  // Lazily initialised client; typed loosely so `mongodb` stays an optional dependency.
  private clientPromise: Promise<any> | null = null;

  private async db() {
    this.clientPromise ??= (async () => {
      const { MongoClient } = await import("mongodb" as string);
      const client = new MongoClient(process.env.MONGODB_URI ?? "mongodb://localhost:27017");
      await client.connect();
      return client;
    })();
    const client = await this.clientPromise;
    return client.db(process.env.MONGODB_DB ?? "vertik12");
  }

  async put(collection: string, doc: Record<string, unknown>): Promise<string> {
    const key = crypto.randomUUID();
    const db = await this.db();
    await db.collection(collection).insertOne({ _key: key, ...doc });
    return key;
  }

  async get(collection: string, key: string) {
    const db = await this.db();
    const doc = await db.collection(collection).findOne({ _key: key });
    return doc ? (doc as Record<string, unknown>) : null;
  }
}

// ---------- DynamoDB (single-table: pk = collection#key) ----------
class DynamoDocumentStore implements DocumentStore {
  readonly name = "dynamodb";
  private clientPromise: Promise<any> | null = null;
  private table = process.env.DYNAMODB_TABLE ?? "vertik12-documents";

  private async client() {
    this.clientPromise ??= (async () => {
      const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb" as string);
      const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb" as string);
      return DynamoDBDocumentClient.from(new DynamoDBClient({}));
    })();
    return this.clientPromise;
  }

  async put(collection: string, doc: Record<string, unknown>): Promise<string> {
    const key = crypto.randomUUID();
    const { PutCommand } = await import("@aws-sdk/lib-dynamodb" as string);
    const client = await this.client();
    await client.send(new PutCommand({ TableName: this.table, Item: { pk: `${collection}#${key}`, ...doc } }));
    return key;
  }

  async get(collection: string, key: string) {
    const { GetCommand } = await import("@aws-sdk/lib-dynamodb" as string);
    const client = await this.client();
    const result = await client.send(new GetCommand({ TableName: this.table, Key: { pk: `${collection}#${key}` } }));
    return (result.Item as Record<string, unknown>) ?? null;
  }
}

const driver = process.env.DOCUMENT_STORE ?? "local";
export const documentStore: DocumentStore =
  driver === "mongodb" ? new MongoDocumentStore()
  : driver === "dynamodb" ? new DynamoDocumentStore()
  : new LocalDocumentStore();
