import mongoose, { Schema, Document } from 'mongoose';

export interface IUnknownPerson extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string; // The name as mentioned
  mentionCount: number; // How many times this person was mentioned
  firstMentionedAt: Date;
  lastMentionedAt: Date;
  contexts: string[]; // Snippets of conversation where this person was mentioned
  askedCount: number; // How many times MIRA asked about this person
  lastAskedAt?: Date;
  status: 'unknown' | 'pending' | 'identified'; // Status of identification
  linkedPersonId?: mongoose.Types.ObjectId; // If identified, link to Person
  possibleRelationships: string[]; // Guessed relationships from context
  createdAt: Date;
  updatedAt: Date;
}

const UnknownPersonSchema = new Schema<IUnknownPerson>(
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
    mentionCount: {
      type: Number,
      default: 1,
    },
    firstMentionedAt: {
      type: Date,
      default: Date.now,
    },
    lastMentionedAt: {
      type: Date,
      default: Date.now,
    },
    contexts: [{
      type: String,
    }],
    askedCount: {
      type: Number,
      default: 0,
    },
    lastAskedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['unknown', 'pending', 'identified'],
      default: 'unknown',
    },
    linkedPersonId: {
      type: Schema.Types.ObjectId,
      ref: 'Person',
    },
    possibleRelationships: [{
      type: String,
    }],
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient lookup
UnknownPersonSchema.index({ userId: 1, name: 1 }, { unique: true });
UnknownPersonSchema.index({ userId: 1, status: 1, lastAskedAt: 1 });
UnknownPersonSchema.index({ userId: 1, mentionCount: -1 });

export default mongoose.models.UnknownPerson || mongoose.model<IUnknownPerson>('UnknownPerson', UnknownPersonSchema);
