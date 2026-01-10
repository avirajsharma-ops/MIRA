import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage {
  role: 'user' | 'mira' | 'system';
  content: string;
  timestamp: Date;
  audioUrl?: string;
  emotion?: string;
  visualContext?: {
    hasCamera: boolean;
    hasScreen: boolean;
    detectedFaces: string[];
    screenDescription?: string;
  };
}

export interface IConversation extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  title: string;
  messages: IMessage[];
  summary: string; // AI-generated summary of conversation
  topics: string[]; // Main topics discussed
  isActive: boolean;
  startedAt: Date;
  endedAt?: Date;
  metadata: {
    totalMessages: number;
    miraMessages: number;
    userMessages: number;
  };
}

const MessageSchema = new Schema<IMessage>(
  {
    role: {
      type: String,
      enum: ['user', 'mira', 'system'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    audioUrl: String,
    emotion: String,
    visualContext: {
      hasCamera: Boolean,
      hasScreen: Boolean,
      detectedFaces: [String],
      screenDescription: String,
    },
  },
  { _id: false }
);

const ConversationSchema = new Schema<IConversation>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: 'New Conversation',
    },
    messages: [MessageSchema],
    summary: {
      type: String,
      default: '',
    },
    topics: [String],
    isActive: {
      type: Boolean,
      default: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: Date,
    metadata: {
      totalMessages: { type: Number, default: 0 },
      miraMessages: { type: Number, default: 0 },
      userMessages: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
ConversationSchema.index({ userId: 1, isActive: 1 });
ConversationSchema.index({ userId: 1, startedAt: -1 });

export default mongoose.models.Conversation || mongoose.model<IConversation>('Conversation', ConversationSchema);
