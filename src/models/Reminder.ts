import mongoose, { Schema, Document } from 'mongoose';

export interface IReminder extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  dueDate: Date;
  reminderTime?: Date; // Optional separate reminder time before due date
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in-progress' | 'completed' | 'overdue' | 'snoozed';
  category?: string;
  tags: string[];
  source: 'user' | 'mira' | 'phone_call' | 'detected';
  relatedContext?: {
    conversationId?: mongoose.Types.ObjectId;
    phoneCallId?: string;
    detectedFrom?: string;
  };
  notifications: {
    enabled: boolean;
    notifiedAt?: Date[];
    snoozeCount: number;
    lastSnoozed?: Date;
  };
  recurrence?: {
    type: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval: number;
    endDate?: Date;
  };
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReminderSchema = new Schema<IReminder>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    dueDate: {
      type: Date,
      required: true,
      index: true,
    },
    reminderTime: {
      type: Date,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'overdue', 'snoozed'],
      default: 'pending',
    },
    category: {
      type: String,
      trim: true,
    },
    tags: [{
      type: String,
      trim: true,
    }],
    source: {
      type: String,
      enum: ['user', 'mira', 'phone_call', 'detected'],
      default: 'user',
    },
    relatedContext: {
      conversationId: {
        type: Schema.Types.ObjectId,
        ref: 'Conversation',
      },
      phoneCallId: String,
      detectedFrom: String,
    },
    notifications: {
      enabled: {
        type: Boolean,
        default: true,
      },
      notifiedAt: [Date],
      snoozeCount: {
        type: Number,
        default: 0,
      },
      lastSnoozed: Date,
    },
    recurrence: {
      type: {
        type: String,
        enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'],
        default: 'none',
      },
      interval: {
        type: Number,
        default: 1,
      },
      endDate: Date,
    },
    completedAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
ReminderSchema.index({ userId: 1, status: 1 });
ReminderSchema.index({ userId: 1, dueDate: 1 });
ReminderSchema.index({ userId: 1, priority: 1 });

export default mongoose.models.Reminder || mongoose.model<IReminder>('Reminder', ReminderSchema);
