'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Speaker {
  id: string;
  name: string;
  type: 'user' | 'mira' | 'other';
  isKnown: boolean;
}

interface TranscriptEntry {
  timestamp: string;
  speaker: Speaker;
  content: string;
  isDirectedAtMira: boolean;
  detectedLanguage?: string;
}

interface Transcript {
  _id: string;
  sessionId: string;
  date: string;
  entries: TranscriptEntry[];
  metadata: {
    totalEntries: number;
    userMessages: number;
    miraMessages: number;
    otherPeopleMessages: number;
    uniqueSpeakers: string[];
    summary?: string;
  };
}

export default function ConversationsPage() {
  const router = useRouter();
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [selectedTranscript, setSelectedTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<string>('');

  // Check auth
  useEffect(() => {
    const token = localStorage.getItem('mira_token');
    if (!token) {
      router.push('/login');
    }
  }, [router]);

  // Fetch transcripts
  const fetchTranscripts = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('mira_token');
      
      let url = '/api/transcripts?limit=50';
      if (dateFilter) {
        const date = new Date(dateFilter);
        url += `&startDate=${date.toISOString()}&endDate=${new Date(date.getTime() + 86400000).toISOString()}`;
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setTranscripts(data.transcripts);
      } else {
        setError('Failed to load conversations');
      }
    } catch (err) {
      setError('Error loading conversations');
    } finally {
      setLoading(false);
    }
  }, [dateFilter]);

  useEffect(() => {
    fetchTranscripts();
  }, [fetchTranscripts]);

  // Fetch single transcript details
  const fetchTranscriptDetails = async (id: string) => {
    try {
      const token = localStorage.getItem('mira_token');
      const response = await fetch(`/api/transcripts?id=${id}&summary=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedTranscript(data.transcript);
      }
    } catch (err) {
      console.error('Error fetching transcript details:', err);
    }
  };

  // Get speaker color based on type
  const getSpeakerColor = (speaker: Speaker): string => {
    if (speaker.type === 'user') return 'bg-blue-500/20 border-blue-500/50';
    if (speaker.type === 'mira') return 'bg-purple-500/20 border-purple-500/50';
    return 'bg-gray-500/20 border-gray-500/50'; // Other people
  };

  const getSpeakerTextColor = (speaker: Speaker): string => {
    if (speaker.type === 'user') return 'text-blue-400';
    if (speaker.type === 'mira') return 'text-purple-400';
    return 'text-gray-400';
  };

  // Format time
  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-lg border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 text-white/70 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to MIRA
          </button>
          <h1 className="text-xl font-semibold bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text text-transparent">
            Conversation History
          </h1>
          <div className="w-24" /> {/* Spacer for centering */}
        </div>
      </header>

      <main className="pt-20 pb-8 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Filter */}
          <div className="mb-6 flex items-center gap-4">
            <label className="text-white/70">Filter by date:</label>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
            />
            {dateFilter && (
              <button
                onClick={() => setDateFilter('')}
                className="text-sm text-purple-400 hover:text-purple-300"
              >
                Clear filter
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Transcript List */}
            <div className="lg:col-span-1 space-y-3 max-h-[calc(100vh-180px)] overflow-y-auto pr-2">
              {loading ? (
                <div className="text-center py-8 text-white/50">Loading conversations...</div>
              ) : error ? (
                <div className="text-center py-8 text-red-400">{error}</div>
              ) : transcripts.length === 0 ? (
                <div className="text-center py-8 text-white/50">
                  <p>No conversations found</p>
                  <p className="text-sm mt-2">Start talking with MIRA to see your history here</p>
                </div>
              ) : (
                transcripts.map((transcript) => (
                  <button
                    key={transcript._id}
                    onClick={() => fetchTranscriptDetails(transcript._id)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      selectedTranscript?._id === transcript._id
                        ? 'bg-purple-500/20 border-purple-500/50'
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="text-sm text-white/50 mb-1">
                      {formatDate(transcript.date)}
                    </div>
                    <div className="text-white font-medium">
                      {transcript.metadata.totalEntries} messages
                    </div>
                    <div className="text-xs text-white/40 mt-1 flex gap-2">
                      <span className="text-blue-400">{transcript.metadata.userMessages} you</span>
                      <span className="text-purple-400">{transcript.metadata.miraMessages} MIRA</span>
                      {transcript.metadata.otherPeopleMessages > 0 && (
                        <span className="text-gray-400">{transcript.metadata.otherPeopleMessages} others</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Transcript Details */}
            <div className="lg:col-span-2 bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
              {selectedTranscript ? (
                <div className="h-[calc(100vh-180px)] flex flex-col">
                  {/* Header */}
                  <div className="p-4 border-b border-white/10">
                    <h2 className="text-lg font-semibold">{formatDate(selectedTranscript.date)}</h2>
                    {selectedTranscript.metadata.summary && (
                      <p className="text-sm text-white/60 mt-1">{selectedTranscript.metadata.summary}</p>
                    )}
                    <div className="flex gap-4 mt-2 text-xs text-white/40">
                      <span>Speakers: {selectedTranscript.metadata.uniqueSpeakers.length}</span>
                      <span>Total: {selectedTranscript.metadata.totalEntries} messages</span>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {selectedTranscript.entries.map((entry, index) => (
                      <div
                        key={index}
                        className={`flex ${entry.speaker.type === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] p-3 rounded-2xl border ${getSpeakerColor(entry.speaker)} ${
                            entry.speaker.type === 'user' ? 'rounded-br-md' : 'rounded-bl-md'
                          }`}
                        >
                          <div className={`text-xs mb-1 flex items-center gap-2 ${getSpeakerTextColor(entry.speaker)}`}>
                            <span className="font-medium">{entry.speaker.name}</span>
                            <span className="text-white/30">{formatTime(entry.timestamp)}</span>
                            {entry.isDirectedAtMira && entry.speaker.type !== 'mira' && (
                              <span className="text-purple-400 text-[10px]">→ MIRA</span>
                            )}
                          </div>
                          <p className="text-white/90">{entry.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-[calc(100vh-180px)] flex items-center justify-center text-white/40">
                  <div className="text-center">
                    <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p>Select a conversation to view details</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
