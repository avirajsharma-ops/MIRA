import mongoose, { Schema, Document } from 'mongoose';

/**
 * UserInstruction Model
 * Stores user-specific instructions, customizations, speaking patterns,
 * preferences, and behavioral settings for MIRA.
 * 
 * This is CRITICAL for personalization - loaded on every session start
 * to give users a consistent, personalized experience across sessions.
 */

export interface IUserInstruction extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  
  // Instruction category for organization
  category: 
    | 'speaking_pattern'      // How user speaks, vocabulary, phrases they use
    | 'response_style'        // How MIRA should respond (formal/casual, length, etc.)
    | 'address_preference'    // How MIRA should address the user (name, nickname, etc.)
    | 'topic_preference'      // Topics user likes/dislikes, interests
    | 'behavior_rule'         // Specific rules for MIRA's behavior
    | 'personal_info'         // Personal information user shared
    | 'work_context'          // Work-related preferences and context
    | 'schedule_preference'   // Timing preferences (morning person, night owl, etc.)
    | 'communication_style'   // User's communication preferences
    | 'learning'              // Things MIRA learned about the user from conversations
    | 'explicit_instruction'  // Direct instructions user gave to MIRA
    | 'correction'            // Corrections user made to MIRA's behavior
    | 'other';
  
  // The actual instruction/preference content
  instruction: string;
  
  // Original context - what the user said that led to this instruction
  originalContext?: string;
  
  // How important is this instruction (1-10)
  priority: number;
  
  // Is this instruction currently active?
  isActive: boolean;
  
  // Source of instruction
  source: 
    | 'explicit'      // User directly told MIRA to do/remember this
    | 'inferred'      // MIRA inferred this from conversation patterns
    | 'correction'    // User corrected MIRA's behavior
    | 'preference'    // User expressed a preference
    | 'pattern';      // Detected from repeated patterns
  
  // Confidence level for inferred instructions (0-1)
  confidence: number;
  
  // Tags for quick filtering
  tags: string[];
  
  // How many times this instruction has been applied
  appliedCount: number;
  
  // Last time this instruction was used
  lastApplied?: Date;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  
  // Optional: conversation ID where this was captured
  conversationId?: mongoose.Types.ObjectId;
  
  // Embedding for semantic search of instructions
  embedding?: number[];
}

const UserInstructionSchema = new Schema<IUserInstruction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: [
        'speaking_pattern',
        'response_style',
        'address_preference',
        'topic_preference',
        'behavior_rule',
        'personal_info',
        'work_context',
        'schedule_preference',
        'communication_style',
        'learning',
        'explicit_instruction',
        'correction',
        'other',
      ],
      required: true,
      index: true,
    },
    instruction: {
      type: String,
      required: true,
    },
    originalContext: {
      type: String,
    },
    priority: {
      type: Number,
      min: 1,
      max: 10,
      default: 5,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['explicit', 'inferred', 'correction', 'preference', 'pattern'],
      required: true,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 1,
    },
    tags: [{
      type: String,
      index: true,
    }],
    appliedCount: {
      type: Number,
      default: 0,
    },
    lastApplied: {
      type: Date,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
    },
    embedding: {
      type: [Number],
      select: false, // Don't include by default in queries
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient queries
UserInstructionSchema.index({ userId: 1, isActive: 1, category: 1 });
UserInstructionSchema.index({ userId: 1, isActive: 1, priority: -1 });
UserInstructionSchema.index({ userId: 1, createdAt: -1 });
UserInstructionSchema.index({ userId: 1, tags: 1 });

// Text index for searching instructions
UserInstructionSchema.index({ instruction: 'text', originalContext: 'text' });

// Static method to get all active instructions for a user
UserInstructionSchema.statics.getActiveInstructions = async function(
  userId: mongoose.Types.ObjectId,
  options: {
    category?: string;
    limit?: number;
    minPriority?: number;
  } = {}
) {
  const query: Record<string, unknown> = {
    userId,
    isActive: true,
  };
  
  if (options.category) {
    query.category = options.category;
  }
  
  if (options.minPriority) {
    query.priority = { $gte: options.minPriority };
  }
  
  return this.find(query)
    .sort({ priority: -1, createdAt: -1 })
    .limit(options.limit || 100)
    .lean();
};

// Static method to format instructions for MIRA's context
UserInstructionSchema.statics.getFormattedInstructions = async function(
  userId: mongoose.Types.ObjectId
): Promise<string> {
  const instructions = await this.find({
    userId,
    isActive: true,
  })
    .sort({ priority: -1, category: 1 })
    .lean();
  
  if (instructions.length === 0) {
    return '';
  }
  
  // Group by category
  const grouped: Record<string, IUserInstruction[]> = {};
  for (const inst of instructions) {
    const cat = inst.category;
    if (!grouped[cat]) {
      grouped[cat] = [];
    }
    grouped[cat].push(inst);
  }
  
  // Format for MIRA
  let formatted = '\n=== USER CUSTOMIZATIONS & INSTRUCTIONS (CRITICAL - FOLLOW STRICTLY) ===\n';
  
  const categoryLabels: Record<string, string> = {
    'explicit_instruction': '📌 DIRECT INSTRUCTIONS',
    'address_preference': '👤 HOW TO ADDRESS USER',
    'response_style': '💬 RESPONSE STYLE',
    'communication_style': '🗣️ COMMUNICATION PREFERENCES',
    'behavior_rule': '⚙️ BEHAVIOR RULES',
    'speaking_pattern': '🎯 USER\'S SPEAKING PATTERNS',
    'topic_preference': '💡 TOPIC PREFERENCES',
    'personal_info': '📋 PERSONAL INFO',
    'work_context': '💼 WORK CONTEXT',
    'schedule_preference': '⏰ SCHEDULE PREFERENCES',
    'learning': '🧠 LEARNED FROM CONVERSATIONS',
    'correction': '✏️ CORRECTIONS',
    'other': '📝 OTHER',
  };
  
  // Priority order for categories
  const categoryOrder = [
    'explicit_instruction',
    'address_preference',
    'response_style',
    'behavior_rule',
    'communication_style',
    'correction',
    'topic_preference',
    'personal_info',
    'work_context',
    'schedule_preference',
    'speaking_pattern',
    'learning',
    'other',
  ];
  
  for (const cat of categoryOrder) {
    if (grouped[cat] && grouped[cat].length > 0) {
      formatted += `\n${categoryLabels[cat] || cat}:\n`;
      for (const inst of grouped[cat]) {
        const priorityIndicator = inst.priority >= 8 ? '⚠️ ' : '';
        formatted += `${priorityIndicator}• ${inst.instruction}\n`;
      }
    }
  }
  
  formatted += '\n=== END USER CUSTOMIZATIONS ===\n';
  
  return formatted;
};

// Method to mark instruction as applied
UserInstructionSchema.methods.markApplied = async function() {
  this.appliedCount += 1;
  this.lastApplied = new Date();
  await this.save();
};

// Check if model exists before creating
const UserInstruction = mongoose.models.UserInstruction || 
  mongoose.model<IUserInstruction>('UserInstruction', UserInstructionSchema);

export default UserInstruction;
