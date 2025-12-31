// Transcript Model - Stores all conversations (user, others, MIRA)
import mongoose, { Document, Schema } from 'mongoose';

export interface ISpeaker {
  id: string; // 'user', 'mira', 'person_1', 'person_2', or personId from FaceData
  name: string; // 'User', 'MIRA', 'MI', 'RA', 'Person 1', 'John' (if recognized)
  type: 'user' | 'mira' | 'other'; // Category of speaker
  isKnown: boolean; // true if face was recognized
  faceDataId?: string; // Reference to FaceData if recognized
}

export interface ITranscriptEntry {
  timestamp: Date;
  speaker: ISpeaker;
  content: string;
  isDirectedAtMira: boolean; // Was this message addressed to MIRA?
  confidence?: number; // Speech recognition confidence
  detectedLanguage?: string;
  visualContext?: {
    speakerLookingAtCamera: boolean;
    otherPeopleInFrame: number;
  };
}

export interface ITranscript extends Document {
  userId: mongoose.Types.ObjectId;
  sessionId: string; // Group entries by session
  date: Date; // Day of the transcript
  entries: ITranscriptEntry[];
  metadata: {
    totalEntries: number;
    userMessages: number;
    miraMessages: number;
    otherPeopleMessages: number;
    uniqueSpeakers: string[]; // List of unique speaker IDs
    topics?: string[]; // AI-detected topics
    summary?: string; // AI-generated summary of the conversation
  };
  createdAt: Date;
  updatedAt: Date;
}

const SpeakerSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['user', 'mira', 'other'], required: true },
  isKnown: { type: Boolean, default: false },
  faceDataId: { type: String },
}, { _id: false });

const TranscriptEntrySchema = new Schema({
  timestamp: { type: Date, default: Date.now },
  speaker: { type: SpeakerSchema, required: true },
  content: { type: String, required: true },
  isDirectedAtMira: { type: Boolean, default: false },
  confidence: { type: Number },
  detectedLanguage: { type: String },
  visualContext: {
    speakerLookingAtCamera: { type: Boolean },
    otherPeopleInFrame: { type: Number },
  },
}, { _id: false });

const TranscriptSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId: { type: String, required: true, index: true },
  date: { type: Date, required: true, index: true },
  entries: [TranscriptEntrySchema],
  metadata: {
    totalEntries: { type: Number, default: 0 },
    userMessages: { type: Number, default: 0 },
    miraMessages: { type: Number, default: 0 },
    otherPeopleMessages: { type: Number, default: 0 },
    uniqueSpeakers: [{ type: String }],
    topics: [{ type: String }],
    summary: { type: String },
  },
}, { timestamps: true });

// Compound index for efficient queries
TranscriptSchema.index({ userId: 1, date: -1 });
TranscriptSchema.index({ userId: 1, sessionId: 1 });

export default mongoose.models.Transcript || mongoose.model<ITranscript>('Transcript', TranscriptSchema);
