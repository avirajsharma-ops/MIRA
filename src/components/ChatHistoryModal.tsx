'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';

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

interface ChatHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChatHistoryModal({ isOpen, onClose }: ChatHistoryModalProps) {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [selectedTranscript, setSelectedTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<string>('');

  // Fetch transcripts
  const fetchTranscripts = useCallback(async () => {
    if (!isOpen) return;
    
    try {
      setLoading(true);
      setError(null);
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
        setTranscripts(data.transcripts || []);
      } else {
        setError('Failed to load conversations');
      }
    } catch (err) {
      setError('Error loading conversations');
    } finally {
      setLoading(false);
    }
  }, [isOpen, dateFilter]);

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
    return 'bg-gray-500/20 border-gray-500/50';
  };

  const getSpeakerTextColor = (speaker: Speaker): string => {
    if (speaker.type === 'user') return 'text-blue-400';
    if (speaker.type === 'mira') return 'text-purple-400';
    return 'text-gray-400';
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateLong = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Chat History" size="xl">
      <div className="flex flex-col md:flex-row gap-4 min-h-[350px] md:min-h-[450px]">
        {/* Transcript List */}
        <div className="w-full md:w-1/3 md:border-r border-white/10 md:pr-4">
          {/* Filter */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="flex-1 bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
              />
              {dateFilter && (
                <button
                  onClick={() => setDateFilter('')}
                  className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  title="Clear filter"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <span className="text-xs text-white/40">{transcripts.length} conversations</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-400 text-sm">{error}</div>
          ) : transcripts.length === 0 ? (
            <div className="text-center py-12 text-white/40">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-sm">No conversations yet</p>
              <p className="text-xs mt-1 text-white/30">Start chatting with MIRA!</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[200px] md:max-h-[380px] overflow-y-auto">
              {transcripts.map((transcript) => (
                <button
                  key={transcript._id}
                  onClick={() => fetchTranscriptDetails(transcript._id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedTranscript?._id === transcript._id
                      ? 'bg-purple-500/20 border border-purple-500/50'
                      : 'bg-white/5 hover:bg-white/10 border border-transparent'
                  }`}
                >
                  <div className="text-xs text-white/50 mb-1">
                    {formatDate(transcript.date)}
                  </div>
                  <div className="text-white font-medium text-sm">
                    {transcript.metadata.totalEntries} messages
                  </div>
                  <div className="text-xs text-white/40 mt-1 flex flex-wrap gap-1.5">
                    <span className="text-blue-400">{transcript.metadata.userMessages} you</span>
                    <span className="text-purple-400">{transcript.metadata.miraMessages} MIRA</span>
                    {transcript.metadata.otherPeopleMessages > 0 && (
                      <span className="text-gray-400">{transcript.metadata.otherPeopleMessages} others</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Transcript Details */}
        <div className="w-full md:w-2/3 flex flex-col">
          {selectedTranscript ? (
            <>
              {/* Header */}
              <div className="pb-3 mb-3 border-b border-white/10">
                <h3 className="text-base md:text-lg font-semibold text-white">{formatDateLong(selectedTranscript.date)}</h3>
                {selectedTranscript.metadata.summary && (
                  <p className="text-sm text-white/50 mt-1">{selectedTranscript.metadata.summary}</p>
                )}
                <div className="flex gap-3 mt-2 text-xs text-white/40">
                  <span>👥 {selectedTranscript.metadata.uniqueSpeakers.length} speakers</span>
                  <span>💬 {selectedTranscript.metadata.totalEntries} messages</span>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto space-y-2 max-h-[200px] md:max-h-[350px] pr-2">
                {selectedTranscript.entries.map((entry, index) => (
                  <div
                    key={index}
                    className={`flex ${entry.speaker.type === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] p-3 rounded-xl border ${getSpeakerColor(entry.speaker)} ${
                        entry.speaker.type === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'
                      }`}
                    >
                      <div className={`text-xs mb-1 flex items-center gap-2 ${getSpeakerTextColor(entry.speaker)}`}>
                        <span className="font-medium">{entry.speaker.name}</span>
                        <span className="text-white/30">{formatTime(entry.timestamp)}</span>
                        {entry.isDirectedAtMira && entry.speaker.type !== 'mira' && (
                          <span className="text-purple-400 text-[10px]">→ MIRA</span>
                        )}
                      </div>
                      <p className="text-white/90 text-sm">{entry.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-white/40">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-14 h-14 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-sm">Select a conversation</p>
              <p className="text-xs mt-1 text-white/30">View past chats with MIRA</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
