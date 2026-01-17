import mongoose, { Schema, Document } from 'mongoose';

export interface IPerson extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  aliases?: string[]; // Alternative names/nicknames
  description: string;
  relationship?: string; // e.g., "friend", "colleague", "family"
  tags: string[];
  voiceEmbeddingId?: mongoose.Types.ObjectId; // Link to voice embedding if enrolled
  faceDescriptor?: number[]; // Face recognition data (migrated from facedata)
  mentionCount: number; // Track how often this person is mentioned
  lastMentionedAt?: Date;
  isFullyAccounted: boolean; // Whether user has provided complete info
  source: 'manual' | 'detected' | 'migrated'; // How this person was added
  createdAt: Date;
  updatedAt: Date;
}

const PersonSchema = new Schema<IPerson>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    aliases: [{
      type: String,
      trim: true,
    }],
    description: {
      type: String,
      required: true,
    },
    relationship: {
      type: String,
      trim: true,
    },
    tags: [{
      type: String,
      trim: true,
    }],
    voiceEmbeddingId: {
      type: Schema.Types.ObjectId,
      ref: 'VoiceEmbedding',
    },
    faceDescriptor: {
      type: [Number],
      select: false, // Don't include in normal queries
    },
    mentionCount: {
      type: Number,
      default: 1,
    },
    lastMentionedAt: {
      type: Date,
    },
    isFullyAccounted: {
      type: Boolean,
      default: true, // Manual entries are fully accounted
    },
    source: {
      type: String,
      enum: ['manual', 'detected', 'migrated'],
      default: 'manual',
    },
  },
  {
    timestamps: true,
  }
);

// Index for searching people by name
PersonSchema.index({ userId: 1, name: 1 });
PersonSchema.index({ name: 'text', description: 'text', tags: 'text', aliases: 'text' });
PersonSchema.index({ userId: 1, mentionCount: -1 });

export default mongoose.models.Person || mongoose.model<IPerson>('Person', PersonSchema);
