import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage {
  role: 'user' | 'mi' | 'ra' | 'mira' | 'system';
  content: string;
  timestamp: Date;
  audioUrl?: string;
  emotion?: string;
  isDebate?: boolean; // Marks messages that are part of MI-RA discussion
  replyTo?: string; // For tracking debate flow
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
    miMessages: number;
    raMessages: number;
    userMessages: number;
    debateCount: number;
    consensusReached: number;
  };
}

const MessageSchema = new Schema<IMessage>(
  {
    role: {
      type: String,
      enum: ['user', 'mi', 'ra', 'mira', 'system'],
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
    isDebate: {
      type: Boolean,
      default: false,
    },
    replyTo: String,
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
      miMessages: { type: Number, default: 0 },
      raMessages: { type: Number, default: 0 },
      userMessages: { type: Number, default: 0 },
      debateCount: { type: Number, default: 0 },
      consensusReached: { type: Number, default: 0 },
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
