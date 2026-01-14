import mongoose, { Schema, Document } from 'mongoose';

export interface IPhoneCall extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  detectedAt: Date;
  status: 'ringing' | 'answered' | 'dropped' | 'ended' | 'missed';
  duration?: number; // in seconds
  conversationHeard: boolean;
  conversationSummary?: string;
  callerInfo?: string;
  followUpCreated: boolean;
  followUpReminderId?: mongoose.Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PhoneCallSchema = new Schema<IPhoneCall>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    detectedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['ringing', 'answered', 'dropped', 'ended', 'missed'],
      default: 'ringing',
    },
    duration: {
      type: Number,
    },
    conversationHeard: {
      type: Boolean,
      default: false,
    },
    conversationSummary: {
      type: String,
    },
    callerInfo: {
      type: String,
    },
    followUpCreated: {
      type: Boolean,
      default: false,
    },
    followUpReminderId: {
      type: Schema.Types.ObjectId,
      ref: 'Reminder',
    },
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
PhoneCallSchema.index({ userId: 1, detectedAt: -1 });
PhoneCallSchema.index({ userId: 1, status: 1 });

export default mongoose.models.PhoneCall || mongoose.model<IPhoneCall>('PhoneCall', PhoneCallSchema);
