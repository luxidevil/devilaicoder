import mongoose from 'mongoose';

let connectPromise = null;

export async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connectPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI is not configured');
    }
    connectPromise = mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    }).catch((error) => {
      connectPromise = null;
      throw error;
    });
  }
  await connectPromise;
  return mongoose.connection;
}
