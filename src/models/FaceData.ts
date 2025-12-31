import mongoose, { Schema, Document } from 'mongoose';

export interface IFaceData extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  personName: string;
  relationship: string; // e.g., "self", "friend", "colleague", "family"
  faceDescriptor: number[]; // 128-dimensional face descriptor (optional - from face-api.js)
  geminiDescription: string; // Detailed description from Gemini for matching
  distinctiveFeatures: string[]; // Hair color, glasses, beard, etc.
  photos: {
    url: string;
    uploadedAt: Date;
    isPrimary: boolean;
  }[];
  metadata: {
    firstSeen: Date;
    lastSeen: Date;
    seenCount: number;
    notes: string;
    context: string; // User-provided context about this person
    learnedInfo: string[]; // Info MIRA learned from conversations
  };
  isOwner: boolean; // Is this the user themselves
}

const FaceDataSchema = new Schema<IFaceData>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    personName: {
      type: String,
      required: true,
    },
    relationship: {
      type: String,
      default: 'unknown',
    },
    faceDescriptor: {
      type: [Number],
      default: [],
    },
    geminiDescription: {
      type: String,
      default: '',
    },
    distinctiveFeatures: {
      type: [String],
      default: [],
    },
    photos: [{
      url: String,
      uploadedAt: {
        type: Date,
        default: Date.now,
      },
      isPrimary: {
        type: Boolean,
        default: false,
      },
    }],
    metadata: {
      firstSeen: {
        type: Date,
        default: Date.now,
      },
      lastSeen: {
        type: Date,
        default: Date.now,
      },
      seenCount: {
        type: Number,
        default: 1,
      },
      notes: {
        type: String,
        default: '',
      },
      context: {
        type: String,
        default: '',
      },
      learnedInfo: {
        type: [String],
        default: [],
      },
    },
    isOwner: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient face lookup
FaceDataSchema.index({ userId: 1, personName: 1 });
FaceDataSchema.index({ userId: 1, isOwner: 1 });

export default mongoose.models.FaceData || mongoose.model<IFaceData>('FaceData', FaceDataSchema);
