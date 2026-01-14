// Voice Embedding Model - Store voice fingerprints for speaker identification
import mongoose, { Schema, Document } from 'mongoose';

export interface IVoiceEmbedding extends Document {
  userId: mongoose.Types.ObjectId;
  speakerId: string; // 'owner' for device owner, or person ID
  speakerName: string;
  embedding: number[]; // 128-dimensional voice vector
  mfccProfile: {
    mfccMeans: number[];
    mfccStds: number[];
    pitchMean: number;
    pitchStd: number;
    energyMean: number;
    energyStd: number;
    spectralCentroidMean: number;
    zeroCrossingRate: number;
  };
  isOwner: boolean;
  sampleCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const VoiceEmbeddingSchema = new Schema<IVoiceEmbedding>({
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true,
  },
  speakerId: { 
    type: String, 
    required: true,
    index: true,
  },
  speakerName: { 
    type: String, 
    required: true,
  },
  embedding: {
    type: [Number],
    required: true,
    validate: {
      validator: (v: number[]) => v.length === 128,
      message: 'Embedding must be 128-dimensional',
    },
  },
  mfccProfile: {
    mfccMeans: { type: [Number], required: true },
    mfccStds: { type: [Number], required: true },
    pitchMean: { type: Number, required: true },
    pitchStd: { type: Number, required: true },
    energyMean: { type: Number, required: true },
    energyStd: { type: Number, required: true },
    spectralCentroidMean: { type: Number, required: true },
    zeroCrossingRate: { type: Number, required: true },
  },
  isOwner: { 
    type: Boolean, 
    default: false,
    index: true,
  },
  sampleCount: { 
    type: Number, 
    default: 1,
  },
}, {
  timestamps: true,
});

// Compound index for efficient lookups
VoiceEmbeddingSchema.index({ userId: 1, speakerId: 1 }, { unique: true });
VoiceEmbeddingSchema.index({ userId: 1, isOwner: 1 });

// Static method to get owner embedding
VoiceEmbeddingSchema.statics.getOwnerEmbedding = async function(userId: mongoose.Types.ObjectId) {
  return this.findOne({ userId, isOwner: true });
};

// Static method to get all embeddings for a user
VoiceEmbeddingSchema.statics.getUserEmbeddings = async function(userId: mongoose.Types.ObjectId) {
  return this.find({ userId }).sort({ isOwner: -1, createdAt: -1 });
};

export default mongoose.models.VoiceEmbedding || mongoose.model<IVoiceEmbedding>('VoiceEmbedding', VoiceEmbeddingSchema);
