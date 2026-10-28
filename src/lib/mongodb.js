import "server-only";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "suvilla_bookings";

if (!uri) {
  throw new Error("Please add MONGODB_URI to your .env.local file");
}

const options = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 8000,
  retryWrites: true,
};

const globalMongo = globalThis;

let client;
let clientPromise;

if (!globalMongo._mongoClientPromise) {
  client = new MongoClient(uri, options);
  globalMongo._mongoClientPromise = client.connect();
}

clientPromise = globalMongo._mongoClientPromise;

// Collection definitions
const collectionDefinitions = [
  {
    name: "room_availabilty",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["date", "booked_rooms"],
        properties: {
          date: {
            bsonType: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Date in YYYY-MM-DD format",
          },
          booked_rooms: {
            bsonType: "array",
            items: {
              bsonType: "string",
            },
          },
          blocked_rooms: {
            bsonType: "array",
            items: {
              bsonType: "string",
            },
          },
          temporary_holds: {
            bsonType: "array",
            items: {
              bsonType: "object",
              required: ["TempID", "roomId", "expiresAt"],
              properties: {
                TempID: { bsonType: "string" },
                roomId: { bsonType: "string" },
                expiresAt: { bsonType: "date" },
              },
            },
          },
        },
      },
    },
  },
  {
    name: "bookings_data",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "booking_id",
          "personal_info",
          "dinner",
          "driver",
          "terms_conditions",
          "paid_amount",
          "status",
        ],
        properties: {
          booking_id: { bsonType: "string" },
          personal_info: {
            bsonType: "object",
            required: [
              "name",
              "email",
              "phone_number",
              "aadhar_number",
              "address",
              "pin_code",
              "city",
              "special_request",
            ],
            properties: {
              name: { bsonType: "string" },
              email: { bsonType: "string" },
              phone_number: { bsonType: "string" },
              aadhar_number: { bsonType: "string" },
              address: { bsonType: "string" },
              pin_code: { bsonType: "string" },
              city: { bsonType: "string" },
              special_request: { bsonType: "string" },
            },
          },
          dinner: {
            bsonType: ["int", "long", "double"],
            minimum: 0,
          },
          driver: {
            bsonType: "object",
            required: ["accommodation", "dinner"],
            properties: {
              accommodation: { enum: ["yes", "no"] },
              dinner: { enum: ["yes", "no"] },
            },
          },
          terms_conditions: {
            enum: ["yes", "no"],
          },
          paid_amount: {
            bsonType: ["int", "long", "double", "decimal"],
            minimum: 0,
          },
          status: {
            bsonType: "string",
          },
        },
      },
    },
  },
  { name: "temp_books" },
  { name: "payment_orders" },
  { name: "room_nights" },
  { name: "promo_codes" },
  { name: "rate_limits" },
  { name: "webhook_events" },
  { name: "admin_sessions" },
  { name: "admin_audit" },
];

// Indexes that enforce correctness at the database level.
const indexDefinitions = [
  ["bookings_data", { booking_id: 1 }, { unique: true }],
  [
    "bookings_data",
    { "payment.payment_id": 1 },
    { unique: true, partialFilterExpression: { "payment.payment_id": { $type: "string" } } },
  ],
  ["payment_orders", { razorpay_order_id: 1 }, { unique: true }],
  ["payment_orders", { booking_id: 1 }, { unique: true }],
  ["room_availabilty", { date: 1 }, { unique: true }],
  ["temp_books", { roomId: 1, expiresAt: 1 }, {}],
  ["temp_books", { TempID: 1 }, {}],
  ["temp_books", { ip: 1, expiresAt: 1 }, {}],
  // Expired holds are removed automatically one hour after expiry.
  ["temp_books", { expiresAt: 1 }, { expireAfterSeconds: 3600, name: "temp_books_ttl" }],
  ["promo_codes", { code: 1 }, { unique: true }],
  ["rate_limits", { expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ["webhook_events", { receivedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }],
  ["admin_sessions", { expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ["admin_audit", { at: -1 }, {}],
  ["bookings_data", { created_at: -1 }, {}],
  ["bookings_data", { status: 1, check_in: 1, check_out: 1 }, {}],
  ["room_nights", { booking_id: 1 }, {}],
];

// Create missing collections only.
async function ensureCollections(db) {
  const existingCollections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();

  const existingNames = new Set(
    existingCollections.map((collection) => collection.name)
  );

  for (const definition of collectionDefinitions) {
    if (existingNames.has(definition.name)) {
      continue;
    }

    const collectionOptions = definition.validator
      ? { validator: definition.validator }
      : {};

    try {
      await db.createCollection(definition.name, collectionOptions);
    } catch (error) {
      // Another request may have created the collection concurrently.
      if (error.code !== 48) {
        throw error;
      }
    }
  }
}

async function ensureIndexes(db) {
  for (const [collection, keys, opts] of indexDefinitions) {
    try {
      await db.collection(collection).createIndex(keys, opts);
    } catch (error) {
      // Usually means duplicate legacy data — fix it, the index matters.
      console.error(`Index creation failed on ${collection}:`, error.message);
    }
  }
}

// Run schema setup once per server instance, not on every request.
async function setup(db) {
  await ensureCollections(db);
  await ensureIndexes(db);
}

// Get the database and ensure required collections exist.
export async function getDb() {
  const connectedClient = await clientPromise;
  const db = connectedClient.db(dbName);

  if (!globalMongo._mongoSetupPromise) {
    globalMongo._mongoSetupPromise = setup(db).catch((error) => {
      globalMongo._mongoSetupPromise = null;
      throw error;
    });
  }
  await globalMongo._mongoSetupPromise;

  return db;
}

export { clientPromise };
