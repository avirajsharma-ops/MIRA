# MIRA - Dual AI Assistant

MIRA is an advanced AI assistant that combines two distinct AI personalities:

- **MI** (💜) - Female, emotional, empathetic AI agent
- **RA** (💙) - Male, logical, analytical AI agent

Together they form **MIRA** - providing balanced perspectives that combine emotional intelligence with logical analysis.

## 🚀 Quick Deploy (Ubuntu 24.04)

```bash
# Clone repository
git clone https://github.com/avirajsharma-ops/MIRA.git /var/www/mira
cd /var/www/mira

# Make script executable and deploy
chmod +x deploy-production.sh
sudo ./deploy-production.sh --fresh --ssl
```

**Requirements:**
- Ubuntu 24.04 LTS server
- Domain pointing to server (itsmira.cloud)
- Root/sudo access

The script will automatically:
- Install Docker & Docker Compose
- Configure UFW firewall
- Setup SSL with Let's Encrypt
- Build and deploy the application

## Features

### Dual AI Personalities
- MI offers emotional support and empathetic understanding
- RA provides logical analysis and practical solutions
- Watch them discuss and debate in real-time
- See when they reach consensus or present different viewpoints

### Voice Interaction
- Speak naturally with voice recognition
- Hear responses with distinct male (RA) and female (MI) voices
- Auto-pause recording when AI is speaking

### Visual Context
- Camera integration for face recognition
- Screen capture for contextual awareness
- AI can see and understand what you're looking at

### Memory & Context
- Persistent memory across conversations
- Remembers facts, preferences, and people you introduce
- Context-aware responses based on your history

### Face Recognition
- Introduce people to MIRA and it will remember them
- Automatic recognition when people appear on camera
- Personal context for each recognized individual

### Proactive Engagement
- AI can initiate conversations when appropriate
- Context-aware suggestions based on what it sees
- Respects your preferences for auto-initiation

## Getting Started

### Prerequisites

- Node.js 18+ (Node.js 20+ recommended)
- MongoDB (or use the provided MongoDB Atlas connection)
- OpenAI API key

### Installation

1. Navigate to the project directory:
\`\`\`bash
cd mira-app
\`\`\`

2. Install dependencies:
\`\`\`bash
npm install
\`\`\`

3. Run the development server:
\`\`\`bash
npm run dev
\`\`\`

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### First Time Setup
1. Create an account with your email and password
2. Grant camera and microphone permissions when prompted
3. Optionally enable screen sharing for context awareness

### Talking to MIRA
- Click the microphone button to speak
- Type in the text input for text-based chat
- Both MI and RA will hear your message and discuss

### Addressing Specific Agents
- Say "Hey MI" or "MI, what do you think..." to talk directly to MI
- Say "Hey RA" or "RA, can you help..." to talk directly to RA
- Otherwise, both agents will collaborate on responses

## Tech Stack

- **Frontend**: Next.js 14, React 18, TailwindCSS
- **Backend**: Next.js API Routes
- **Database**: MongoDB with Mongoose
- **AI**: OpenAI GPT-4o, Whisper, TTS
- **Authentication**: JWT

## License

MIT
