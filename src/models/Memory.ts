import mongoose, { Schema, Document } from 'mongoose';

export interface IMemory extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: 'fact' | 'preference' | 'event' | 'person' | 'emotion' | 'task' | 'insight';
  content: string;
  importance: number; // 1-10 scale
  source: 'user' | 'mi' | 'ra' | 'visual' | 'inferred';
  tags: string[];
  relatedMemories: mongoose.Types.ObjectId[];
  emotions: {
    mi: string; // MI's emotional take
    ra: string; // RA's logical categorization
  };
  context: {
    conversationId?: mongoose.Types.ObjectId;
    timestamp: Date;
    visualContext?: string;
  };
  lastAccessed: Date;
  accessCount: number;
  isArchived: boolean;
  // Vector embedding for semantic search
  embedding?: number[];
}

const MemorySchema = new Schema<IMemory>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['fact', 'preference', 'event', 'person', 'emotion', 'task', 'insight'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    importance: {
      type: Number,
      min: 1,
      max: 10,
      default: 5,
    },
    source: {
      type: String,
      enum: ['user', 'mi', 'ra', 'visual', 'inferred'],
      required: true,
    },
    tags: [String],
    relatedMemories: [{
      type: Schema.Types.ObjectId,
      ref: 'Memory',
    }],
    emotions: {
      mi: String,
      ra: String,
    },
    context: {
      conversationId: {
        type: Schema.Types.ObjectId,
        ref: 'Conversation',
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
      visualContext: String,
    },
    lastAccessed: {
      type: Date,
      default: Date.now,
    },
    accessCount: {
      type: Number,
      default: 0,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    // Vector embedding for semantic search (1536 dimensions for text-embedding-3-small)
    embedding: {
      type: [Number],
      select: false, // Don't include in normal queries by default
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient memory retrieval
MemorySchema.index({ userId: 1, type: 1 });
MemorySchema.index({ userId: 1, importance: -1 });
MemorySchema.index({ userId: 1, tags: 1 });
MemorySchema.index({ userId: 1, lastAccessed: -1 });
MemorySchema.index({ content: 'text', tags: 'text' });

export default mongoose.models.Memory || mongoose.model<IMemory>('Memory', MemorySchema);
