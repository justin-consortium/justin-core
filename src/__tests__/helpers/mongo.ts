import { MongoMemoryReplSet } from 'mongodb-memory-server';

export async function startMongo() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URI = mongo.getUri();
  return mongo;
}
