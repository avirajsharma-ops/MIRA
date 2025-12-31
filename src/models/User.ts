import mongoose, { Schema, Document } from 'mongoose';

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
}

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
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
