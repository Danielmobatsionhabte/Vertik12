import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Document store abstraction — unstructured payloads (assignment submission
 * bodies, generated documents) live OUTSIDE the relational database:
 *
 *   DOCUMENT_STORE=local     JSON files on disk (zero-config default for dev)
 *   DOCUMENT_STORE=mongodb   MongoDB      (MONGODB_URI, MONGODB_DB)
 *   DOCUMENT_STORE=dynamodb  AWS DynamoDB (DYNAMODB_TABLE, AWS_REGION + IAM creds;
 *                            documents over ~350 KB spill to S3 via DOCUMENTS_BUCKET)
 *
 * SQL rows keep only a `contentRef` key. The mongodb / @aws-sdk packages are
 * loaded lazily so dev installs never pay for drivers they don't use.
 */
export interface DocumentStore {
  readonly name: string;
  put(collection: string, doc: Record<string, unknown>): Promise<string>; // returns key
  get(collection: string, key: string): Promise<Record<string, unknown> | null>;
  /**
   * Write a document under a KNOWN key — used by backup restore so the refs
   * stored in SQL rows keep pointing at the right files. Overwrites any
   * existing document with that key. Callers must validate the key shape
   * (backup files are uploads, not server-generated values).
   */
  restore(collection: string, key: string, doc: Record<string, unknown>): Promise<void>;
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

  async restore(collection: string, key: string, doc: Record<string, unknown>) {
    await fs.promises.mkdir(path.join(this.dir, collection), { recursive: true });
    await fs.promises.writeFile(this.file(collection, key), JSON.stringify(doc, null, 2), "utf8");
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

  async restore(collection: string, key: string, doc: Record<string, unknown>) {
    const db = await this.db();
    await db.collection(collection).replaceOne({ _key: key }, { _key: key, ...doc }, { upsert: true });
  }
}

// ---------- DynamoDB (single-table: pk = collection#key) ----------
// DynamoDB caps items at 400 KB, but stored documents (photos, assignment
// submissions) can be several MB of base64. Documents above SPILL_BYTES are
// therefore written as JSON objects to S3 (DOCUMENTS_BUCKET) with a small
// pointer item in DynamoDB; callers never see the difference.
class DynamoDocumentStore implements DocumentStore {
  readonly name = "dynamodb";
  private clientPromise: Promise<any> | null = null;
  private s3Promise: Promise<any> | null = null;
  private table = process.env.DYNAMODB_TABLE ?? "vertik12-documents";
  private bucket = process.env.DOCUMENTS_BUCKET; // required for documents > SPILL_BYTES
  private static readonly SPILL_BYTES = 350_000; // headroom under the 400 KB item limit

  private async client() {
    this.clientPromise ??= (async () => {
      const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb" as string);
      const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb" as string);
      return DynamoDBDocumentClient.from(new DynamoDBClient({}));
    })();
    return this.clientPromise;
  }

  private async s3() {
    this.s3Promise ??= (async () => {
      const { S3Client } = await import("@aws-sdk/client-s3" as string);
      return new S3Client({});
    })();
    return this.s3Promise;
  }

  async put(collection: string, doc: Record<string, unknown>): Promise<string> {
    const key = crypto.randomUUID();
    const { PutCommand } = await import("@aws-sdk/lib-dynamodb" as string);
    const client = await this.client();
    const json = JSON.stringify(doc);
    if (Buffer.byteLength(json, "utf8") > DynamoDocumentStore.SPILL_BYTES) {
      if (!this.bucket) {
        throw new Error("Document exceeds the DynamoDB item size limit and DOCUMENTS_BUCKET is not configured");
      }
      const s3Key = `${collection}/${key}.json`;
      const { PutObjectCommand } = await import("@aws-sdk/client-s3" as string);
      await (await this.s3()).send(
        new PutObjectCommand({ Bucket: this.bucket, Key: s3Key, Body: json, ContentType: "application/json" }),
      );
      await client.send(new PutCommand({ TableName: this.table, Item: { pk: `${collection}#${key}`, s3Key } }));
    } else {
      await client.send(new PutCommand({ TableName: this.table, Item: { pk: `${collection}#${key}`, ...doc } }));
    }
    return key;
  }

  async get(collection: string, key: string) {
    const { GetCommand } = await import("@aws-sdk/lib-dynamodb" as string);
    const client = await this.client();
    const result = await client.send(new GetCommand({ TableName: this.table, Key: { pk: `${collection}#${key}` } }));
    const item = result.Item as Record<string, unknown> | undefined;
    if (!item) return null;
    if (typeof item.s3Key === "string" && this.bucket) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3" as string);
      const res = await (await this.s3()).send(new GetObjectCommand({ Bucket: this.bucket, Key: item.s3Key }));
      return JSON.parse(await res.Body.transformToString()) as Record<string, unknown>;
    }
    return item;
  }

  /**
   * Restore under a known key. Same spill-to-S3 rule as `put` — a restored
   * document is the same size it was when written, so a large one must land
   * in the bucket rather than blow the 400 KB item limit.
   */
  async restore(collection: string, key: string, doc: Record<string, unknown>) {
    const { PutCommand } = await import("@aws-sdk/lib-dynamodb" as string);
    const client = await this.client();
    const json = JSON.stringify(doc);
    if (Buffer.byteLength(json, "utf8") > DynamoDocumentStore.SPILL_BYTES) {
      if (!this.bucket) {
        throw new Error("Document exceeds the DynamoDB item size limit and DOCUMENTS_BUCKET is not configured");
      }
      const s3Key = `${collection}/${key}.json`;
      const { PutObjectCommand } = await import("@aws-sdk/client-s3" as string);
      await (await this.s3()).send(
        new PutObjectCommand({ Bucket: this.bucket, Key: s3Key, Body: json, ContentType: "application/json" }),
      );
      await client.send(new PutCommand({ TableName: this.table, Item: { pk: `${collection}#${key}`, s3Key } }));
      return;
    }
    // PutCommand overwrites the whole item, so a document that previously
    // spilled to S3 correctly loses its stale s3Key pointer here.
    await client.send(new PutCommand({ TableName: this.table, Item: { pk: `${collection}#${key}`, ...doc } }));
  }
}

const driver = process.env.DOCUMENT_STORE ?? "local";
export const documentStore: DocumentStore =
  driver === "mongodb" ? new MongoDocumentStore()
  : driver === "dynamodb" ? new DynamoDocumentStore()
  : new LocalDocumentStore();
