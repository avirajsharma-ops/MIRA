import mongoose, { Schema, Document } from 'mongoose';

export interface ITalioIntegration {
  enabled: boolean;
  tenantId: string;
  userId: string;
  employeeId?: string;
  role: 'admin' | 'manager' | 'employee' | 'dept_head';
  department?: string;
  lastSync: Date;
}

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  password: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  preferences: {
    miPersonality: number; // 0-100 scale for MI preference
    raPersonality: number; // 0-100 scale for RA preference
    voiceEnabled: boolean;
    autoInitiate: boolean;
  };
  lastActive: Date;
  talioIntegration?: ITalioIntegration;
}

const TalioIntegrationSchema = new Schema<ITalioIntegration>(
  {
    enabled: { type: Boolean, default: false },
    tenantId: { type: String },
    userId: { type: String },
    employeeId: { type: String },
    role: { type: String, enum: ['admin', 'manager', 'employee', 'dept_head'], default: 'employee' },
    department: { type: String },
    lastSync: { type: Date },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    preferences: {
      miPersonality: { type: Number, default: 50 },
      raPersonality: { type: Number, default: 50 },
      voiceEnabled: { type: Boolean, default: true },
      autoInitiate: { type: Boolean, default: true },
    },
    lastActive: {
      type: Date,
      default: Date.now,
    },
    talioIntegration: {
      type: TalioIntegrationSchema,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
